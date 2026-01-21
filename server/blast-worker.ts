import { storage } from "./storage";
import { whatsappService } from "./whatsapp";
import { shortenUrlsInText } from "./url-shortener";
import type { BlastRecipient, BlastCampaign, Contact } from "@shared/schema";

let isProcessing = false;
let workerInterval: NodeJS.Timeout | null = null;
let generationInterval: NodeJS.Timeout | null = null;

// Track next allowed send time for each campaign to enforce randomized intervals
const campaignNextSendTime: Map<string, number> = new Map();

// Configuration for staged message generation
const QUEUE_BUFFER_SIZE = 5; // Number of messages to keep in awaiting_review/approved queue
const GENERATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between generation batches

// Default timezone for Indonesia (WIB)
const DEFAULT_TIMEZONE = "Asia/Jakarta";

// Get current date/time info in the configured timezone
function getLocalDateTime(timezone: string = DEFAULT_TIMEZONE): { 
  hour: number; 
  formattedDate: string; 
  formattedTime: string;
  dayName: string;
} {
  const now = new Date();
  
  // Get hour in the specified timezone
  const hourString = now.toLocaleString("en-US", { 
    timeZone: timezone, 
    hour: "numeric", 
    hour12: false 
  });
  const hour = parseInt(hourString, 10);
  
  // Get formatted date and time for AI context
  const formattedDate = now.toLocaleDateString("id-ID", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  
  const formattedTime = now.toLocaleTimeString("id-ID", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
  
  const dayName = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  
  return { hour, formattedDate, formattedTime, dayName };
}

async function getOpenAIKey(): Promise<string | null> {
  const setting = await storage.getAppSetting("openai_api_key");
  return setting?.value || process.env.OPENAI_API_KEY || null;
}

async function generatePersonalizedMessage(apiKey: string, prompt: string, contact: Contact): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  // Get current date/time context for the AI
  const { formattedDate, formattedTime, dayName } = getLocalDateTime(DEFAULT_TIMEZONE);

  try {
    const systemPrompt = `You are a helpful assistant that generates personalized WhatsApp messages. 
Generate a unique, natural-sounding message based on the user's prompt.
Make the message feel personal and human, avoiding robotic or templated language.
Keep the message concise and appropriate for WhatsApp.
Do not include any greeting like "Hi" or the contact's name at the start - just the message content.
Vary your writing style, sentence structure, and vocabulary to make each message unique.

CRITICAL: NEVER use marketing or promotional language. Avoid these words completely:
- English: promotion, promo, discount, sale, offer, deal, limited time, special price, buy now, order now, exclusive, free, bonus, cashback, voucher, coupon
- Indonesian: promosi, promo, diskon, potongan harga, penawaran, gratis, bonus, cashback, voucher, kupon, harga spesial, terbatas, beli sekarang, pesan sekarang

Instead, use conversational and friendly language. If the user's prompt mentions promotions or discounts, rephrase it in a more personal, non-marketing way.

Current date and time context (Indonesia timezone - WIB):
- Date: ${formattedDate}
- Time: ${formattedTime}
- Day: ${dayName}

Use appropriate greetings based on the time of day if relevant (e.g., "Selamat pagi" for morning, "Selamat siang" for afternoon, "Selamat sore" for evening).`;

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

// Calculate similarity between two strings (Jaccard similarity on words)
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  
  let intersectionCount = 0;
  words1.forEach(w => { if (set2.has(w)) intersectionCount++; });
  
  const unionSet = new Set(words1.concat(words2));
  
  return intersectionCount / unionSet.size;
}

// Check if message is too similar to any previously sent message in the campaign
async function isDuplicateMessage(campaignId: string, newMessage: string, threshold: number = 0.7): Promise<boolean> {
  const recipients = await storage.getBlastRecipients(campaignId);
  const sentMessages = recipients
    .filter(r => r.status === "sent" && r.generatedMessage)
    .map(r => r.generatedMessage as string);
  
  for (const sentMessage of sentMessages) {
    const similarity = calculateSimilarity(newMessage, sentMessage);
    if (similarity >= threshold) {
      console.log(`Duplicate detected! Similarity: ${(similarity * 100).toFixed(1)}% - regenerating...`);
      return true;
    }
  }
  
  return false;
}

// Generate a unique message with duplicate checking and retries
async function generateUniqueMessage(
  apiKey: string, 
  prompt: string, 
  contact: Contact, 
  campaignId: string,
  maxRetries: number = 3
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const message = await generatePersonalizedMessage(apiKey, prompt, contact);
    
    // Check for duplicates
    const isDuplicate = await isDuplicateMessage(campaignId, message);
    
    if (!isDuplicate) {
      return message;
    }
    
    console.log(`Attempt ${attempt + 1}/${maxRetries}: Message was too similar, regenerating...`);
  }
  
  // If all retries failed, generate one more with modified prompt to force uniqueness
  const modifiedPrompt = `${prompt}\n\n[IMPORTANT: Generate a completely different and unique message. Be creative and vary your style significantly.]`;
  return generatePersonalizedMessage(apiKey, modifiedPrompt, contact);
}

async function processNextRecipient(campaign: BlastCampaign): Promise<boolean> {
  // For running campaigns, messages should already be pre-generated
  // Just check if there are any pending recipients that need generation
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

  // Check if message is already generated (pre-generation flow)
  const fullRecipient = await storage.getBlastRecipient(recipient.id);
  if (fullRecipient?.generatedMessage) {
    // Message already generated, mark as approved for sending
    await storage.updateBlastRecipient(recipient.id, {
      status: "approved",
      scheduledAt: new Date(),
    });
    return true;
  }

  // Fallback: generate message if not pre-generated
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

    // Use duplicate-checked message generation
    const message = await generateUniqueMessage(apiKey, campaign.prompt, contact, campaign.id);
    
    // Mark as approved (ready to send)
    await storage.updateBlastRecipient(recipient.id, {
      status: "approved",
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

async function sendApprovedMessage(recipient: BlastRecipient & { contact: Contact; campaign: BlastCampaign }): Promise<void> {
  // Use reviewedMessage if available (admin-edited), otherwise use generatedMessage
  const messageToSend = recipient.reviewedMessage || recipient.generatedMessage;
  
  if (!messageToSend) {
    await storage.updateBlastRecipient(recipient.id, {
      status: "failed",
      errorMessage: "No message to send",
    });
    await storage.incrementBlastCampaignFailedCount(recipient.campaignId);
    return;
  }

  // Check if Twilio is available (preferred for blast)
  const { isTwilioConfigured, sendWhatsAppMessage: twilioSend } = await import("./twilio");
  const twilioAvailable = await isTwilioConfigured();

  // If Twilio not available, check Baileys connection
  if (!twilioAvailable) {
    const waStatus = whatsappService.getConnectionState();
    if (waStatus !== "connected") {
      console.log("Neither Twilio nor WhatsApp Baileys connected, skipping message send");
      return;
    }
  }

  try {
    await storage.updateBlastRecipient(recipient.id, { status: "sending" });

    const phoneNumber = recipient.contact.platformId || recipient.contact.phoneNumber;
    if (!phoneNumber) {
      throw new Error("No phone number for contact");
    }

    // Shorten any URLs in the message to avoid WhatsApp detection
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.APP_URL || "https://omnidesk.maxnetplus.id";
    let shortenedMessage = await shortenUrlsInText(messageToSend, baseUrl);

    let sendResult: { success: boolean; messageId?: string; rateLimited?: boolean; waitMs?: number; error?: string };

    if (twilioAvailable) {
      // Use Twilio (official API) for blast messages
      // Check if campaign has a template assigned (required for Twilio business-initiated messages)
      const { sendWhatsAppTemplate } = await import("./twilio");
      
      let template = null;
      if (recipient.campaign.templateId) {
        template = await storage.getMessageTemplateById(recipient.campaign.templateId);
      }
      
      const hasApprovedTemplate = template?.twilioContentSid && 
        template?.twilioApprovalStatus === "approved";
      
      if (hasApprovedTemplate) {
        // Use approved template with variable mappings
        const recipientName = recipient.contact.name || "Pelanggan";
        const recipientPhone = recipient.contact.phoneNumber || "";
        const contentVariables: Record<string, string> = {};
        
        // First check campaign-level variableMappings, then fall back to template-level
        let mappings: Array<{ placeholder: string; type: string; customValue?: string }> | null = null;
        
        // Try campaign-level variableMappings first (stored as JSON string)
        if (recipient.campaign.variableMappings) {
          try {
            mappings = JSON.parse(recipient.campaign.variableMappings as string);
          } catch (e) {
            console.log("Failed to parse campaign variableMappings, falling back to template");
          }
        }
        
        // Fall back to template-level variableMappings
        if (!mappings || mappings.length === 0) {
          mappings = template!.variableMappings as Array<{ placeholder: string; type: string; customValue?: string }> | null;
        }
        
        if (mappings && mappings.length > 0) {
          // Use defined mappings
          mappings.forEach(mapping => {
            switch (mapping.type) {
              case "recipient_name":
                contentVariables[mapping.placeholder] = recipientName;
                break;
              case "ai_prompt":
                contentVariables[mapping.placeholder] = shortenedMessage;
                break;
              case "phone_number":
                contentVariables[mapping.placeholder] = recipientPhone;
                break;
              case "custom":
                contentVariables[mapping.placeholder] = mapping.customValue || "";
                break;
              default:
                contentVariables[mapping.placeholder] = "";
            }
          });
        } else {
          // No mappings defined - extract all placeholders from template content
          // and apply default logic based on placeholder number
          const templateText = template!.content || "";
          const placeholderRegex = /\{\{(\d+)\}\}/g;
          const placeholders = new Set<string>();
          let match;
          while ((match = placeholderRegex.exec(templateText)) !== null) {
            placeholders.add(match[1]);
          }
          
          // Apply default mappings for each found placeholder
          placeholders.forEach(placeholder => {
            switch (placeholder) {
              case "1":
                // {{1}} is typically recipient name
                contentVariables["1"] = recipientName;
                break;
              case "2":
                // {{2}} is typically the main message/AI content
                contentVariables["2"] = shortenedMessage;
                break;
              default:
                // For other placeholders ({{3}}, {{4}}, etc.), leave empty
                // These should ideally be configured in variableMappings
                contentVariables[placeholder] = "";
                console.log(`Blast: Warning - placeholder {{${placeholder}}} has no mapping, using empty string`);
                break;
            }
          });
          
          // Fallback if no placeholders found - at minimum set 1 and 2
          if (placeholders.size === 0) {
            contentVariables["1"] = recipientName;
            contentVariables["2"] = shortenedMessage;
          }
        }
        
        console.log(`Blast: Sending via Twilio template "${template!.name}" to ${recipientName}`);
        console.log(`Blast: Content variables being sent:`, JSON.stringify(contentVariables));
        console.log(`Blast: Template content: "${template!.content?.substring(0, 100)}..."`);
        
        // Reconstruct the full message from template for storage/display
        // Replace {{1}}, {{2}}, {{3}} etc. with actual values
        let fullRenderedMessage = template!.content || "";
        Object.entries(contentVariables).forEach(([placeholder, value]) => {
          const regex = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
          fullRenderedMessage = fullRenderedMessage.replace(regex, value);
        });
        
        // Override shortenedMessage with full rendered message for storage
        shortenedMessage = fullRenderedMessage;
        console.log(`Blast: Full rendered message for storage: "${fullRenderedMessage.substring(0, 100)}..."`);
        
        const twilioResult = await sendWhatsAppTemplate(
          phoneNumber.replace(/\D/g, ""),
          template!.twilioContentSid!,
          contentVariables,
          template!.content
        );
        sendResult = {
          success: twilioResult.success,
          messageId: twilioResult.messageId,
          error: twilioResult.error
        };
      } else {
        // No approved template - try free-form (will fail for business-initiated)
        console.log(`Blast: No approved template, trying free-form to ${recipient.contact.name || phoneNumber}`);
        const twilioResult = await twilioSend(phoneNumber.replace(/\D/g, ""), shortenedMessage);
        sendResult = {
          success: twilioResult.success,
          messageId: twilioResult.messageId,
          error: twilioResult.error
        };
        
        if (!sendResult.success && sendResult.error?.includes("template")) {
          sendResult.error = "Twilio requires an approved template for blast messages. Please assign a template to this campaign.";
        }
      }
    } else {
      // Fallback to Baileys (unofficial)
      const jid = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`;
      console.log(`Blast: Sending via Baileys to ${recipient.contact.name || phoneNumber}`);
      sendResult = await whatsappService.sendMessage(jid, shortenedMessage);
    }

    // Check for rate limiting - set back to approved to retry (message already generated)
    if (sendResult.rateLimited) {
      console.log(`Blast message rate limited for ${recipient.contact.name || phoneNumber}. Will retry later...`);
      await storage.updateBlastRecipient(recipient.id, {
        status: "approved", // Keep as approved so getApprovedRecipients picks it up again
        errorMessage: "Rate limited - will retry later",
        scheduledAt: new Date(Date.now() + (sendResult.waitMs || 60000)),
      });
      return;
    }

    // Check for failure
    if (!sendResult.success) {
      throw new Error(sendResult.error || "WhatsApp send failed");
    }

    // Create or update conversation and message for inbox visibility
    try {
      // Find or create conversation for this contact
      let conversation = await storage.getConversationByContactId(recipient.contact.id);
      
      if (!conversation) {
        // Create new conversation for this contact
        conversation = await storage.createConversation({
          platform: "whatsapp",
          contactId: recipient.contact.id,
          lastMessageAt: new Date(),
          lastMessagePreview: shortenedMessage.slice(0, 100),
          unreadCount: 0,
          isArchived: false,
        });
        console.log(`Created new conversation for blast recipient ${recipient.contact.name || phoneNumber}`);
      }
      
      // Create message record in conversation
      await storage.createMessage({
        conversationId: conversation.id,
        externalId: sendResult.messageId || undefined,
        direction: "outbound",
        content: shortenedMessage,
        status: "sent",
        timestamp: new Date(),
        metadata: JSON.stringify({
          source: "blast_campaign",
          campaignId: recipient.campaignId,
          campaignName: recipient.campaign.name,
        }),
      });
      
      // Update conversation with latest message info
      await storage.updateConversation(conversation.id, {
        lastMessageAt: new Date(),
        lastMessagePreview: shortenedMessage.slice(0, 100),
      });
      
      console.log(`Created inbox message for blast recipient ${recipient.contact.name || phoneNumber}`);
    } catch (inboxError) {
      // Log error but don't fail the blast - message was still sent
      console.error(`Failed to create inbox record for blast message:`, inboxError);
    }

    await storage.updateBlastRecipient(recipient.id, {
      status: "sent",
      sentAt: new Date(),
    });
    await storage.incrementBlastCampaignSentCount(recipient.campaignId);

    console.log(`Blast message sent to ${recipient.contact.name || phoneNumber} via ${twilioAvailable ? 'Twilio' : 'Baileys'}`);
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
      // Set back to approved to retry later
      await storage.updateBlastRecipient(recipient.id, {
        status: "approved",
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
    r.status === "pending" || r.status === "generating" || 
    r.status === "awaiting_review" || r.status === "approved" || r.status === "sending"
  );

  if (pending.length === 0) {
    await storage.updateBlastCampaignStatus(campaignId, "completed");
    console.log(`Campaign ${campaign.name} completed!`);
  }
}

// Check if current time is within allowed sending hours (7 AM - 9 PM in configured timezone)
function isWithinSendingHours(): boolean {
  const { hour } = getLocalDateTime(DEFAULT_TIMEZONE);
  // Allow sending between 7 AM (7) and 9 PM (21) in local timezone
  return hour >= 7 && hour < 21;
}

async function processBlastWorker(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const campaigns = await storage.getBlastCampaigns();
    const runningCampaigns = campaigns.filter(c => c.status === "running");
    const now = Date.now();

    // Check if we're within allowed sending hours
    if (!isWithinSendingHours()) {
      // Outside sending hours - don't send any messages, just log occasionally
      if (runningCampaigns.length > 0) {
        console.log("Outside sending hours (7 AM - 9 PM). Blast messages paused until morning.");
      }
      isProcessing = false;
      return;
    }

    for (const campaign of runningCampaigns) {
      // Check if enough time has passed since last message for this campaign
      const nextAllowedTime = campaignNextSendTime.get(campaign.id) || 0;
      
      if (now < nextAllowedTime) {
        // Not yet time to send for this campaign
        continue;
      }

      // Find an APPROVED message ready to send (admin has reviewed and approved)
      const approvedRecipients = await storage.getApprovedRecipients(campaign.id, 1);
      
      if (approvedRecipients.length > 0) {
        const recipient = approvedRecipients[0];
        
        // Double-check we're within sending hours at send time
        if (!isWithinSendingHours()) {
          console.log(`Outside sending hours - skipping send for campaign "${campaign.name}"`);
          continue;
        }
        
        // Send the approved message
        await sendApprovedMessage({
          ...recipient,
          campaign,
        });

        // Set next allowed send time with randomized interval
        const minInterval = campaign.minIntervalSeconds || 600;
        const maxInterval = campaign.maxIntervalSeconds || 1800;
        const waitTime = getRandomInterval(minInterval, maxInterval) * 1000;
        
        campaignNextSendTime.set(campaign.id, now + waitTime);
        console.log(`Next message for campaign "${campaign.name}" in ${Math.round(waitTime / 60000)} minutes`);
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
  
  // Main sending loop - runs every 10 seconds
  workerInterval = setInterval(async () => {
    await processBlastWorker();
  }, 10000);

  // Generation loop - runs every 10 minutes to replenish queues
  generationInterval = setInterval(async () => {
    await processMessageGeneration();
  }, GENERATION_INTERVAL_MS);

  processBlastWorker();
  // Also run generation on startup
  processMessageGeneration();
}

export function stopBlastWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  if (generationInterval) {
    clearInterval(generationInterval);
    generationInterval = null;
  }
  console.log("Blast worker stopped");
}

// Clear campaign timing when paused or cancelled so it starts fresh when resumed
export function clearCampaignTiming(campaignId: string): void {
  campaignNextSendTime.delete(campaignId);
}

// Process message generation for all running/draft campaigns with low queues
async function processMessageGeneration(): Promise<void> {
  try {
    const campaigns = await storage.getBlastCampaigns();
    // Generate messages for both draft and running campaigns
    const activeCampaigns = campaigns.filter(c => c.status === "draft" || c.status === "running");

    for (const campaign of activeCampaigns) {
      await generateCampaignMessageBatch(campaign.id);
    }
  } catch (error) {
    console.error("Message generation loop error:", error);
  }
}

// Generate a batch of messages for a campaign (up to QUEUE_BUFFER_SIZE)
export async function generateCampaignMessageBatch(campaignId: string): Promise<{ generated: number; total: number }> {
  const campaign = await storage.getBlastCampaign(campaignId);
  if (!campaign) {
    return { generated: 0, total: 0 };
  }

  // Don't generate if campaign is cancelled or completed
  if (campaign.status === "cancelled" || campaign.status === "completed") {
    return { generated: 0, total: 0 };
  }

  // Check current queue counts
  const counts = await storage.getRecipientQueueCounts(campaignId);
  const currentQueueSize = counts.awaitingReview + counts.approved;
  
  // If queue is full, skip generation
  if (currentQueueSize >= QUEUE_BUFFER_SIZE) {
    return { generated: 0, total: counts.pending };
  }

  // Calculate how many messages to generate
  const toGenerate = Math.min(QUEUE_BUFFER_SIZE - currentQueueSize, counts.pending);
  
  if (toGenerate <= 0) {
    return { generated: 0, total: counts.pending };
  }

  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    console.error("OpenAI API key not configured for message generation");
    return { generated: 0, total: counts.pending };
  }

  // Lock the campaign during generation
  if (campaign.isGenerating) {
    return { generated: 0, total: counts.pending };
  }
  
  await storage.setBlastCampaignGenerating(campaignId, true);
  let generated = 0;

  try {
    const pendingRecipients = await storage.getPendingGenerationRecipients(campaignId, toGenerate);
    
    console.log(`Generating ${pendingRecipients.length} messages for campaign "${campaign.name}"...`);

    for (const recipient of pendingRecipients) {
      // Check if campaign was cancelled
      const currentCampaign = await storage.getBlastCampaign(campaignId);
      if (!currentCampaign || currentCampaign.status === "cancelled") {
        console.log(`Campaign ${campaignId} cancelled, stopping generation`);
        break;
      }

      try {
        await storage.updateBlastRecipient(recipient.id, { status: "generating" });
        
        // Generate unique message with duplicate checking
        const message = await generateUniqueMessage(apiKey, campaign.prompt, recipient.contact, campaignId);
        
        // Update recipient with generated message - directly approved and ready to send
        await storage.updateBlastRecipient(recipient.id, {
          generatedMessage: message,
          generatedAt: new Date(),
          approvedAt: new Date(),
          status: "approved", // Directly ready to send, admin can review/delete if needed
        });
        
        await storage.incrementBlastCampaignGeneratedCount(campaignId);
        generated++;
        console.log(`Generated message for ${recipient.contact.name || recipient.contact.phoneNumber}`);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to generate message for recipient ${recipient.id}:`, errorMessage);
        
        await storage.updateBlastRecipient(recipient.id, {
          status: "failed",
          errorMessage: `Generation failed: ${errorMessage}`,
        });
        await storage.incrementBlastCampaignGenerationFailedCount(campaignId);
      }
    }

    console.log(`Generated ${generated} messages for campaign "${campaign.name}"`);
  } catch (error) {
    console.error(`Error during message generation for campaign ${campaignId}:`, error);
  } finally {
    await storage.setBlastCampaignGenerating(campaignId, false);
  }

  return { generated, total: counts.pending - generated };
}

// Trigger immediate generation for a campaign (called when campaign is created or needs replenishment)
export async function triggerImmediateGeneration(campaignId: string): Promise<void> {
  await generateCampaignMessageBatch(campaignId);
}

// ============= EXTERNAL API MESSAGE QUEUE PROCESSING =============

// Track next allowed send time for API queue (shared across all API messages)
let apiQueueNextSendTime: number = 0;
let apiQueueInterval: NodeJS.Timeout | null = null;
let isApiQueueProcessing = false;

// Configuration for API queue sending (randomized intervals to appear more human-like)
const API_QUEUE_MIN_INTERVAL_SECONDS = 60; // 1 minute minimum between messages
const API_QUEUE_MAX_INTERVAL_SECONDS = 300; // 5 minutes maximum between messages
const API_QUEUE_BATCH_SIZE = 5; // Process up to 5 messages per batch

async function processApiMessageQueue(): Promise<void> {
  if (isApiQueueProcessing) return;
  isApiQueueProcessing = true;

  try {
    // Check if we're within sending hours (7 AM - 9 PM)
    if (!isWithinSendingHours()) {
      isApiQueueProcessing = false;
      return;
    }

    const now = Date.now();
    
    // Check if enough time has passed since last message
    if (now < apiQueueNextSendTime) {
      isApiQueueProcessing = false;
      return;
    }

    // Get queued messages to process
    const queuedMessages = await storage.getQueuedApiMessages(1);
    
    if (queuedMessages.length === 0) {
      isApiQueueProcessing = false;
      return;
    }

    const message = queuedMessages[0];

    // Mark as processing
    await storage.updateApiMessageStatus(message.id, "processing");

    try {
      // Double-check we're within sending hours before sending
      if (!isWithinSendingHours()) {
        console.log("Outside sending hours - requeuing API message");
        await storage.updateApiMessageStatus(message.id, "queued");
        isApiQueueProcessing = false;
        return;
      }

      // Try to find or create contact and conversation
      let contactId = message.contactId;
      let conversationId = message.conversationId;

      // If no contact linked, try to find by phone number
      if (!contactId) {
        const existingContact = await storage.getContactByPhoneNumber(message.phoneNumber);
        if (existingContact) {
          contactId = existingContact.id;
          
          // Find existing conversation
          const existingConversation = await storage.getConversationByContactId(existingContact.id);
          if (existingConversation) {
            conversationId = existingConversation.id;
          }
        }
      }

      // Send the message via WhatsApp
      await storage.updateApiMessageStatus(message.id, "sending");
      
      // Shorten any URLs in the message to avoid WhatsApp detection
      const baseUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.APP_URL || "https://omnidesk.maxnetplus.id";
      const shortenedMessage = await shortenUrlsInText(message.message, baseUrl, message.clientId);
      
      // Try Twilio first (official API), then fall back to Baileys (unofficial)
      const { isTwilioConfigured, sendWhatsAppMessage: twilioSend, sendWhatsAppTemplate } = await import("./twilio");
      const twilioAvailable = await isTwilioConfigured();
      
      let result: { messageId?: string; success: boolean; rateLimited?: boolean; waitMs?: number; error?: string };
      
      if (twilioAvailable) {
        // Get the template that was selected when the message was queued
        let template = null;
        if (message.templateId) {
          template = await storage.getMessageTemplateById(message.templateId);
        }
        
        const hasApprovedTemplate = template?.twilioContentSid && 
          template?.twilioApprovalStatus === "approved";
        
        if (hasApprovedTemplate && message.metadata) {
          // Use approved template with content variables
          // Extract variables from metadata (set by external API)
          const metadata = typeof message.metadata === 'string' 
            ? JSON.parse(message.metadata) 
            : message.metadata;
          
          // Get the API client to check for variable mappings
          const apiClient = await storage.getApiClient(message.clientId);
          const clientVariableMappings = apiClient?.variableMappings || [];
          
          const contentVariables: Record<string, string> = {};
          
          // Generate messageType text (for legacy support)
          const messageTypeValue = metadata.messageType || metadata.message_type || "";
          const messageTypeText = messageTypeValue === "new_invoice"
            ? "Tagihan internet Anda telah terbit:"
            : messageTypeValue === "reminder"
            ? "Pengingat pembayaran untuk:"
            : messageTypeValue === "overdue"
            ? "Tagihan Anda telah melewati jatuh tempo:"
            : messageTypeValue === "payment_confirmation"
            ? "Terima kasih! Pembayaran Anda telah kami terima untuk:"
            : "Informasi tagihan internet Anda:";
          
          // Format grand_total with thousand separators (for legacy support)
          const grandTotalRaw = metadata.grand_total || "";
          const grandTotalFormatted = grandTotalRaw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
          
          // Check if API client has variable mappings configured
          if (clientVariableMappings.length > 0) {
            // Use API client's variable mappings: maps payload field names to template placeholders
            // e.g., [{ placeholder: "1", payloadField: "recipient_name" }, { placeholder: "2", payloadField: "invoice_number" }]
            console.log(`API queue: Using client variable mappings:`, JSON.stringify(clientVariableMappings));
            
            clientVariableMappings.forEach((mapping) => {
              const { placeholder, payloadField } = mapping;
              let value = "";
              
              // Special handling for certain field names
              if (payloadField === "recipient_name") {
                value = message.recipientName || metadata.recipient_name || metadata[payloadField] || "Pelanggan";
              } else if (payloadField === "grand_total") {
                const raw = metadata.grand_total || metadata[payloadField] || "";
                value = raw.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
              } else if (payloadField === "invoice_url") {
                // Use shortened URL if available
                value = shortenedMessage || metadata.invoice_url || metadata[payloadField] || "";
              } else if (payloadField === "message_type") {
                value = messageTypeText;
              } else {
                // Get value from metadata using the payload field name
                value = metadata[payloadField] || "";
              }
              
              contentVariables[placeholder] = value;
            });
          } else {
            // Fallback: Use template's variables array for legacy compatibility
            // Template stores variables array like ["recipient_name", "invoice_number", "grand_total", "invoice_url", "message_type"]
            // Each position maps to Twilio's {{1}}, {{2}}, {{3}}, etc.
            const templateVariables = template!.variables || [];
            
            templateVariables.forEach((varName: string, index: number) => {
              const twilioPosition = (index + 1).toString(); // Twilio uses 1-indexed
              switch (varName) {
                case "recipient_name":
                  contentVariables[twilioPosition] = message.recipientName || metadata.recipient_name || "Pelanggan";
                  break;
                case "invoice_number":
                  contentVariables[twilioPosition] = metadata.invoice_number || "";
                  break;
                case "grand_total":
                  contentVariables[twilioPosition] = grandTotalFormatted;
                  break;
                case "invoice_url":
                  contentVariables[twilioPosition] = shortenedMessage || metadata.invoice_url || "";
                  break;
                case "message_type":
                  contentVariables[twilioPosition] = messageTypeText;
                  break;
                default:
                  // Try to get from metadata directly
                  contentVariables[twilioPosition] = metadata[varName] || "";
              }
            });
          }
          
          // Validate that all template placeholders are mapped
          // Extract placeholders from template content (e.g., {{1}}, {{2}}, etc.)
          const templateContent = template!.content || "";
          const placeholderMatches = templateContent.match(/\{\{(\d+)\}\}/g) || [];
          const requiredPlaceholders = Array.from(new Set(placeholderMatches.map(p => p.replace(/[{}]/g, ""))));
          
          // Check if all required placeholders have values
          const missingPlaceholders = requiredPlaceholders.filter(p => {
            const value = contentVariables[p];
            return value === undefined || value === null || value === "";
          });
          
          if (missingPlaceholders.length > 0) {
            // Variable mappings don't cover all template placeholders - fail the message
            const errorMsg = `Variable mapping incomplete: placeholders ${missingPlaceholders.map(p => `{{${p}}}`).join(", ")} are not mapped or have empty values. Configure API client variable mappings.`;
            console.log(`API queue: ${errorMsg}`);
            await storage.updateApiMessage(message.id, {
              status: "failed",
              errorMessage: errorMsg,
            });
            isApiQueueProcessing = false;
            return;
          }
          
          console.log(`API queue: Using approved template "${template!.name}" (${template!.twilioContentSid}) for ${message.phoneNumber}`);
          console.log(`API queue: Content variables:`, JSON.stringify(contentVariables));
          const twilioResult = await sendWhatsAppTemplate(
            message.phoneNumber,
            template!.twilioContentSid!,
            contentVariables,
            template!.content
          );
          result = {
            messageId: twilioResult.messageId,
            success: twilioResult.success,
            error: twilioResult.error
          };
        } else {
          // No approved template - try free-form (may fail for business-initiated messages)
          const reason = !message.templateId ? "no templateId stored" : 
                        !template ? "template not found" :
                        !template.twilioContentSid ? "no Twilio ContentSid" :
                        !template.twilioApprovalStatus ? "not approved" : "unknown";
          console.log(`API queue: No approved template (${reason}), sending free-form to ${message.phoneNumber}`);
          const twilioResult = await twilioSend(message.phoneNumber, shortenedMessage);
          result = {
            messageId: twilioResult.messageId,
            success: twilioResult.success,
            error: twilioResult.error
          };
        }
        
        if (!result.success) {
          throw new Error(result.error || "Failed to send via Twilio");
        }
      } else {
        // Fall back to Baileys (unofficial)
        const formattedNumber = message.phoneNumber + "@s.whatsapp.net";
        result = await whatsappService.sendMessage(formattedNumber, shortenedMessage);
        
        // Check for rate limiting - requeue the message
        if (result.rateLimited) {
          console.log(`API queue: Rate limited for ${message.phoneNumber}. Requeuing...`);
          await storage.updateApiMessage(message.id, {
            status: "queued",
            errorMessage: "Rate limited - will retry later",
          });
          // Set next send time based on rate limit wait time
          apiQueueNextSendTime = Date.now() + (result.waitMs || 60000);
          isApiQueueProcessing = false;
          return;
        }
        
        if (!result.success) {
          throw new Error("Failed to send WhatsApp message via Baileys");
        }
      }

      // Create or update conversation and message for inbox visibility
      try {
        // If no contact, try to create one or find by phone
        if (!contactId) {
          const existingContact = await storage.getContactByPhoneNumber(message.phoneNumber);
          if (existingContact) {
            contactId = existingContact.id;
          } else {
            // Create a new contact for this phone number
            const newContact = await storage.createContact({
              platformId: message.phoneNumber,
              phoneNumber: message.phoneNumber,
              name: message.recipientName || message.phoneNumber,
              platform: "whatsapp",
            });
            contactId = newContact.id;
            console.log(`API queue: Created new contact for ${message.phoneNumber}`);
          }
        }
        
        // Find or create conversation
        if (!conversationId && contactId) {
          const existingConversation = await storage.getConversationByContactId(contactId);
          if (existingConversation) {
            conversationId = existingConversation.id;
          } else {
            // Create new conversation
            const newConversation = await storage.createConversation({
              platform: "whatsapp",
              contactId: contactId,
              lastMessageAt: new Date(),
              lastMessagePreview: shortenedMessage.slice(0, 100),
              unreadCount: 0,
              isArchived: false,
            });
            conversationId = newConversation.id;
            console.log(`API queue: Created new conversation for ${message.phoneNumber}`);
          }
        }
        
        // Create message record in conversation
        if (conversationId) {
          await storage.createMessage({
            conversationId: conversationId,
            externalId: result.messageId || undefined,
            direction: "outbound",
            content: shortenedMessage,
            status: "sent",
            timestamp: new Date(),
            metadata: JSON.stringify({
              source: "api_queue",
              clientId: message.clientId,
              requestId: message.requestId,
            }),
          });
          
          // Update conversation with latest message info
          await storage.updateConversation(conversationId, {
            lastMessageAt: new Date(),
            lastMessagePreview: shortenedMessage.slice(0, 100),
          });
          
          console.log(`API queue: Created inbox message for ${message.phoneNumber}`);
        }
      } catch (inboxError) {
        // Log error but don't fail the API message - message was still sent
        console.error(`API queue: Failed to create inbox record:`, inboxError);
      }

      // Update message as sent
      await storage.updateApiMessage(message.id, {
        status: "sent",
        externalMessageId: result.messageId || null,
        contactId: contactId || null,
        conversationId: conversationId || null,
        sentAt: new Date(),
        errorMessage: null, // Clear any previous error
      });

      console.log(`API queue: Sent message to ${message.phoneNumber} (request: ${message.requestId})`);

      // Set next allowed send time with randomized interval (1-5 minutes)
      const waitTime = getRandomInterval(API_QUEUE_MIN_INTERVAL_SECONDS, API_QUEUE_MAX_INTERVAL_SECONDS) * 1000;
      apiQueueNextSendTime = now + waitTime;
      const waitMinutes = Math.floor(waitTime / 60000);
      const waitSeconds = Math.round((waitTime % 60000) / 1000);
      console.log(`API queue: Next message in ${waitMinutes}m ${waitSeconds}s (randomized delay)`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`API queue: Failed to send message ${message.id}:`, errorMessage);
      
      await storage.updateApiMessageStatus(message.id, "failed", errorMessage);
    }
  } catch (error) {
    console.error("API queue processing error:", error);
  } finally {
    isApiQueueProcessing = false;
  }
}

export function startApiQueueWorker(): void {
  if (apiQueueInterval) {
    console.log("API queue worker already running");
    return;
  }

  console.log("Starting API queue worker...");
  
  // Check queue every 10 seconds
  apiQueueInterval = setInterval(async () => {
    await processApiMessageQueue();
  }, 10000);

  // Run immediately on startup
  processApiMessageQueue();
}

export function stopApiQueueWorker(): void {
  if (apiQueueInterval) {
    clearInterval(apiQueueInterval);
    apiQueueInterval = null;
  }
  console.log("API queue worker stopped");
}
