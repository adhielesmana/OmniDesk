import OpenAI from "openai";
import { storage } from "./storage";
import type { Conversation, Contact, Platform } from "@shared/schema";

const AUTOREPLY_ENABLED_KEY = "autoreply_enabled";
const AUTOREPLY_PROMPT_KEY = "autoreply_prompt";
const AUTOREPLY_COOLDOWN_HOURS = 24;

// Platform-specific send message function type
// WhatsApp returns object with success/rateLimited, Meta API returns void (throws on error)
export type SendMessageFn = (recipientId: string, message: string) => Promise<void | { success?: boolean; rateLimited?: boolean; waitMs?: number }>;

// Default timezone for Indonesia (WIB)
const DEFAULT_TIMEZONE = "Asia/Jakarta";

// Get current date/time info in the configured timezone
function getLocalDateTime(timezone: string = DEFAULT_TIMEZONE): { 
  formattedDate: string; 
  formattedTime: string;
  dayName: string;
  greeting: string;
} {
  const now = new Date();
  
  // Get hour in the specified timezone
  const hourString = now.toLocaleString("en-US", { 
    timeZone: timezone, 
    hour: "numeric", 
    hour12: false 
  });
  const hour = parseInt(hourString, 10);
  
  // Get formatted date and time
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
  
  // Determine appropriate greeting
  let greeting = "Selamat pagi"; // Default morning
  if (hour >= 11 && hour < 15) {
    greeting = "Selamat siang";
  } else if (hour >= 15 && hour < 18) {
    greeting = "Selamat sore";
  } else if (hour >= 18 || hour < 5) {
    greeting = "Selamat malam";
  }
  
  return { formattedDate, formattedTime, dayName, greeting };
}

export async function isAutoReplyEnabled(): Promise<boolean> {
  const setting = await storage.getAppSetting(AUTOREPLY_ENABLED_KEY);
  return setting?.value === "true";
}

export async function getAutoReplyPrompt(): Promise<string | null> {
  const setting = await storage.getAppSetting(AUTOREPLY_PROMPT_KEY);
  return setting?.value || null;
}

export async function setAutoReplyEnabled(enabled: boolean): Promise<void> {
  await storage.setAppSetting(AUTOREPLY_ENABLED_KEY, enabled ? "true" : "false");
}

export async function setAutoReplyPrompt(prompt: string): Promise<void> {
  await storage.setAppSetting(AUTOREPLY_PROMPT_KEY, prompt);
}

export async function deleteAutoReplyPrompt(): Promise<void> {
  await storage.deleteAppSetting(AUTOREPLY_PROMPT_KEY);
}

async function getOpenAIKey(): Promise<string | null> {
  const setting = await storage.getAppSetting("openai_api_key");
  if (setting?.value && setting.isValid) {
    return setting.value;
  }
  return process.env.OPENAI_API_KEY || null;
}

export async function hasValidOpenAIKey(): Promise<boolean> {
  const key = await getOpenAIKey();
  return !!key;
}

function normalizePhoneToJid(phone: string): string {
  // Remove any existing @ suffix
  let normalized = phone.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "");
  // Remove non-numeric characters except +
  normalized = normalized.replace(/[^0-9+]/g, "");
  // Remove leading +
  normalized = normalized.replace(/^\+/, "");
  // Add WhatsApp suffix
  return `${normalized}@s.whatsapp.net`;
}

export function shouldSendAutoReply(conversation: Conversation): boolean {
  // Check if an auto-reply was sent in the last 24 hours
  if (!conversation.lastAutoReplyAt) {
    // No auto-reply ever sent for this conversation
    return true;
  }
  
  const lastAutoReplyTime = new Date(conversation.lastAutoReplyAt).getTime();
  const now = Date.now();
  const hoursSinceLastAutoReply = (now - lastAutoReplyTime) / (1000 * 60 * 60);
  
  return hoursSinceLastAutoReply > AUTOREPLY_COOLDOWN_HOURS;
}

export async function generateAutoReply(
  prompt: string,
  contact: Contact,
  incomingMessage: string,
  platform: Platform = "whatsapp"
): Promise<string | null> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    console.log("Auto-reply: OpenAI API key not configured");
    return null;
  }
  
  // Get current date/time context
  const { formattedDate, formattedTime, dayName, greeting } = getLocalDateTime(DEFAULT_TIMEZONE);

  // Platform-friendly name
  const platformName = platform === "whatsapp" ? "WhatsApp" : 
                       platform === "facebook" ? "Facebook Messenger" : 
                       platform === "instagram" ? "Instagram" : platform;

  try {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are an AI assistant responding to messages on behalf of a business via ${platformName}.
Follow these instructions carefully:
${prompt}

Contact Information:
- Name: ${contact.name || "Unknown"}
- Platform: ${platformName}
${contact.phoneNumber ? `- Phone: ${contact.phoneNumber}` : ""}

Current Date and Time (Indonesia timezone - WIB):
- Date: ${formattedDate}
- Time: ${formattedTime}
- Day: ${dayName}
- Appropriate greeting: ${greeting}

IMPORTANT: 
- Keep your response natural, friendly and conversational
- Use appropriate time-based greetings (${greeting}) when starting a conversation
- Do not include any greetings like "Hi" or "Hello" if they already said hello
- Respond appropriately to their message
- Be helpful and professional`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: incomingMessage },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || null;
  } catch (error) {
    console.error("Auto-reply generation error:", error);
    return null;
  }
}

export async function handleAutoReply(
  conversation: Conversation,
  contact: Contact,
  incomingMessage: string,
  sendMessage: SendMessageFn,
  platform: Platform = "whatsapp"
): Promise<boolean> {
  // First check if enabled
  const enabled = await isAutoReplyEnabled();
  if (!enabled) return false;

  // Check for valid OpenAI key first
  const hasKey = await hasValidOpenAIKey();
  if (!hasKey) {
    console.log("Auto-reply: No valid OpenAI API key configured, skipping");
    return false;
  }

  // Check for valid prompt
  const prompt = await getAutoReplyPrompt();
  if (!prompt || prompt.trim() === "") {
    console.log("Auto-reply: No prompt configured, skipping");
    return false;
  }

  // Check if we should send auto-reply (cooldown check)
  if (!shouldSendAutoReply(conversation)) {
    console.log("Auto-reply: Already sent auto-reply within 24 hours, skipping");
    return false;
  }

  // SAFETY: Check if contact is blocked to avoid replying to spam/problematic contacts
  if (contact.isBlocked) {
    console.log("Auto-reply: Contact is blocked, skipping");
    return false;
  }

  // Get recipient ID based on platform
  const recipientId = contact.platformId || contact.whatsappLid || contact.phoneNumber;
  if (!recipientId) {
    console.log(`Auto-reply: No recipient ID for contact on ${platform}`);
    return false;
  }

  const platformName = platform === "whatsapp" ? "WhatsApp" : 
                       platform === "facebook" ? "Facebook" : 
                       platform === "instagram" ? "Instagram" : platform;

  console.log(`Auto-reply (${platformName}): Generating response for ${contact.name || recipientId}...`);

  const reply = await generateAutoReply(prompt, contact, incomingMessage, platform);
  if (!reply) {
    console.log("Auto-reply: Failed to generate response");
    return false;
  }

  try {
    // For WhatsApp, normalize to JID format; for others, use platformId directly
    const targetId = platform === "whatsapp" ? normalizePhoneToJid(recipientId) : recipientId;
    
    // Send message and check for rate limiting / failure
    const sendResult = await sendMessage(targetId, reply);
    
    // For WhatsApp, sendMessage returns an object with success/rateLimited flags
    // For Meta API (Instagram/Facebook), it throws on error
    if (typeof sendResult === 'object' && sendResult !== null) {
      const result = sendResult as { success?: boolean; rateLimited?: boolean; waitMs?: number };
      if (result.rateLimited) {
        console.log(`Auto-reply (${platformName}): Rate limited, will retry later. Wait ${Math.round((result.waitMs || 0) / 1000)}s`);
        return false; // Don't record message, will be retried next time
      }
      if (result.success === false) {
        console.log(`Auto-reply (${platformName}): Send failed, not recording message`);
        return false;
      }
    }
    
    console.log(`Auto-reply (${platformName}) sent to ${contact.name || recipientId}`);

    // Create the auto-reply message in database
    await storage.createMessage({
      conversationId: conversation.id,
      direction: "outbound",
      content: reply,
      status: "sent",
      timestamp: new Date(),
      metadata: JSON.stringify({ isAutoReply: true, platform }),
    });

    // Update the conversation's lastAutoReplyAt timestamp
    await storage.updateConversation(conversation.id, {
      lastAutoReplyAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error(`Auto-reply (${platformName}): Error sending message:`, error);
    return false;
  }
}
