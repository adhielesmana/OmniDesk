import { storage } from "./storage";
import { whatsappService } from "./whatsapp";
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
    
    const sendResult = await whatsappService.sendMessage(jid, messageToSend);

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
      throw new Error("WhatsApp send failed");
    }

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

// Configuration for API queue sending (same conservative approach as blast campaigns)
const API_QUEUE_MIN_INTERVAL_SECONDS = 120; // 2 minutes minimum between messages
const API_QUEUE_MAX_INTERVAL_SECONDS = 180; // 3 minutes maximum between messages
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
      
      const formattedNumber = message.phoneNumber + "@s.whatsapp.net";
      const result = await whatsappService.sendMessage(formattedNumber, message.message);
      
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
        throw new Error("Failed to send WhatsApp message");
      }

      // Update message as sent
      await storage.updateApiMessage(message.id, {
        status: "sent",
        externalMessageId: result.messageId || null,
        contactId: contactId || null,
        conversationId: conversationId || null,
        sentAt: new Date(),
      });

      console.log(`API queue: Sent message to ${message.phoneNumber} (request: ${message.requestId})`);

      // Set next allowed send time with randomized interval
      const waitTime = getRandomInterval(API_QUEUE_MIN_INTERVAL_SECONDS, API_QUEUE_MAX_INTERVAL_SECONDS) * 1000;
      apiQueueNextSendTime = now + waitTime;
      console.log(`API queue: Next message in ${Math.round(waitTime / 60000)} minutes`);

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
