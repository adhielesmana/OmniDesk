import { storage } from "./storage";
import { whatsappService } from "./whatsapp";
import type { BlastRecipient, BlastCampaign, Contact } from "@shared/schema";

let isProcessing = false;
let workerInterval: NodeJS.Timeout | null = null;

// Track next allowed send time for each campaign to enforce randomized intervals
const campaignNextSendTime: Map<string, number> = new Map();

async function getOpenAIKey(): Promise<string | null> {
  const setting = await storage.getAppSetting("openai_api_key");
  return setting?.value || process.env.OPENAI_API_KEY || null;
}

async function generatePersonalizedMessage(apiKey: string, prompt: string, contact: Contact): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const systemPrompt = `You are a helpful assistant that generates personalized WhatsApp messages. 
Generate a unique, natural-sounding message based on the user's prompt.
Make the message feel personal and human, avoiding robotic or templated language.
Keep the message concise and appropriate for WhatsApp.
Do not include any greeting like "Hi" or the contact's name at the start - just the message content.
Vary your writing style, sentence structure, and vocabulary to make each message unique.`;

    const userPrompt = `Generate a personalized message for this contact:
Name: ${contact.name || "Unknown"}
Phone: ${contact.phoneNumber || "Unknown"}

User's prompt/instructions: ${prompt}

Generate a unique message that follows these instructions while sounding natural and human.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 500,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "OpenAI API error");
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Message generation timed out");
    }
    throw error;
  }
}

function getRandomInterval(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processNextRecipient(campaign: BlastCampaign): Promise<boolean> {
  const recipient = await storage.getNextPendingRecipient(campaign.id);
  if (!recipient) {
    return false;
  }

  const contact = await storage.getContact(recipient.contactId);
  if (!contact) {
    await storage.updateBlastRecipient(recipient.id, {
      status: "failed",
      errorMessage: "Contact not found",
    });
    await storage.incrementBlastCampaignFailedCount(campaign.id);
    return true;
  }

  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    await storage.updateBlastRecipient(recipient.id, {
      status: "failed",
      errorMessage: "OpenAI API key not configured",
    });
    await storage.incrementBlastCampaignFailedCount(campaign.id);
    return true;
  }

  try {
    await storage.updateBlastRecipient(recipient.id, { status: "generating" });

    const message = await generatePersonalizedMessage(apiKey, campaign.prompt, contact);
    
    await storage.updateBlastRecipient(recipient.id, {
      status: "queued",
      generatedMessage: message,
      scheduledAt: new Date(),
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await storage.updateBlastRecipient(recipient.id, {
      status: "failed",
      errorMessage,
    });
    await storage.incrementBlastCampaignFailedCount(campaign.id);
    return true;
  }
}

async function sendQueuedMessage(recipient: BlastRecipient & { contact: Contact; campaign: BlastCampaign }): Promise<void> {
  if (!recipient.generatedMessage) {
    await storage.updateBlastRecipient(recipient.id, {
      status: "failed",
      errorMessage: "No generated message",
    });
    await storage.incrementBlastCampaignFailedCount(recipient.campaignId);
    return;
  }

  const waStatus = whatsappService.getConnectionState();
  if (waStatus !== "connected") {
    console.log("WhatsApp not connected, skipping message send");
    return;
  }

  try {
    await storage.updateBlastRecipient(recipient.id, { status: "sending" });

    const phoneNumber = recipient.contact.platformId || recipient.contact.phoneNumber;
    if (!phoneNumber) {
      throw new Error("No phone number for contact");
    }

    const jid = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
    
    await whatsappService.sendMessage(jid, recipient.generatedMessage);

    await storage.updateBlastRecipient(recipient.id, {
      status: "sent",
      sentAt: new Date(),
    });
    await storage.incrementBlastCampaignSentCount(recipient.campaignId);

    console.log(`Blast message sent to ${recipient.contact.name || phoneNumber}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const retryCount = (recipient.retryCount || 0) + 1;

    if (retryCount >= 3) {
      await storage.updateBlastRecipient(recipient.id, {
        status: "failed",
        errorMessage,
        retryCount,
      });
      await storage.incrementBlastCampaignFailedCount(recipient.campaignId);
    } else {
      await storage.updateBlastRecipient(recipient.id, {
        status: "queued",
        errorMessage,
        retryCount,
        scheduledAt: new Date(Date.now() + 60000 * retryCount),
      });
    }
  }
}

async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const campaign = await storage.getBlastCampaign(campaignId);
  if (!campaign || campaign.status !== "running") return;

  const recipients = await storage.getBlastRecipients(campaignId);
  const pending = recipients.filter(r => 
    r.status === "pending" || r.status === "generating" || r.status === "queued" || r.status === "sending"
  );

  if (pending.length === 0) {
    await storage.updateBlastCampaignStatus(campaignId, "completed");
    console.log(`Campaign ${campaign.name} completed!`);
  }
}

async function processBlastWorker(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const campaigns = await storage.getBlastCampaigns();
    const runningCampaigns = campaigns.filter(c => c.status === "running");
    const now = Date.now();

    for (const campaign of runningCampaigns) {
      // Check if enough time has passed since last message for this campaign
      const nextAllowedTime = campaignNextSendTime.get(campaign.id) || 0;
      
      if (now < nextAllowedTime) {
        // Not yet time to send for this campaign, just generate messages
        await processNextRecipient(campaign);
        continue;
      }

      // Generate next message if needed
      await processNextRecipient(campaign);

      // Find a queued message ready to send
      const dueRecipients = await storage.getDueRecipients(1);
      const campaignRecipient = dueRecipients.find(r => r.campaignId === campaign.id);
      
      if (campaignRecipient) {
        await sendQueuedMessage(campaignRecipient);

        // Set next allowed send time with randomized interval
        const minInterval = campaign.minIntervalSeconds || 120;
        const maxInterval = campaign.maxIntervalSeconds || 180;
        const waitTime = getRandomInterval(minInterval, maxInterval) * 1000;
        
        campaignNextSendTime.set(campaign.id, now + waitTime);
        console.log(`Next message for campaign "${campaign.name}" in ${waitTime / 1000}s`);
      }

      await checkCampaignCompletion(campaign.id);
    }
  } catch (error) {
    console.error("Blast worker error:", error);
  } finally {
    isProcessing = false;
  }
}

export function startBlastWorker(): void {
  if (workerInterval) {
    console.log("Blast worker already running");
    return;
  }

  console.log("Starting blast worker...");
  
  workerInterval = setInterval(async () => {
    await processBlastWorker();
  }, 10000);

  processBlastWorker();
}

export function stopBlastWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log("Blast worker stopped");
  }
}

// Clear campaign timing when paused or cancelled so it starts fresh when resumed
export function clearCampaignTiming(campaignId: string): void {
  campaignNextSendTime.delete(campaignId);
}
