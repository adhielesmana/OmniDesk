import OpenAI from "openai";
import { storage } from "./storage";
import type { Conversation, Contact } from "@shared/schema";

const AUTOREPLY_ENABLED_KEY = "autoreply_enabled";
const AUTOREPLY_PROMPT_KEY = "autoreply_prompt";
const AUTOREPLY_COOLDOWN_HOURS = 24;

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
  incomingMessage: string
): Promise<string | null> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    console.log("Auto-reply: OpenAI API key not configured");
    return null;
  }

  try {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are an AI assistant responding to messages on behalf of a business.
Follow these instructions carefully:
${prompt}

Contact Information:
- Name: ${contact.name || "Unknown"}
- Phone: ${contact.phoneNumber || "Unknown"}

IMPORTANT: 
- Keep your response natural, friendly and conversational
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
  sendMessage: (jid: string, message: string) => Promise<void>
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

  // Get phone number for contact
  const phoneNumber = contact.platformId || contact.whatsappLid || contact.phoneNumber;
  if (!phoneNumber) {
    console.log("Auto-reply: No phone number for contact");
    return false;
  }

  console.log(`Auto-reply: Generating response for ${contact.name || phoneNumber}...`);

  const reply = await generateAutoReply(prompt, contact, incomingMessage);
  if (!reply) {
    console.log("Auto-reply: Failed to generate response");
    return false;
  }

  try {
    // Normalize phone number to proper JID format
    const jid = normalizePhoneToJid(phoneNumber);
    
    await sendMessage(jid, reply);
    console.log(`Auto-reply sent to ${contact.name || phoneNumber}`);

    // Create the auto-reply message in database
    await storage.createMessage({
      conversationId: conversation.id,
      direction: "outbound",
      content: reply,
      status: "sent",
      timestamp: new Date(),
      metadata: JSON.stringify({ isAutoReply: true }),
    });

    // Update the conversation's lastAutoReplyAt timestamp
    await storage.updateConversation(conversation.id, {
      lastAutoReplyAt: new Date(),
    });

    return true;
  } catch (error) {
    console.error("Auto-reply: Error sending message:", error);
    return false;
  }
}
