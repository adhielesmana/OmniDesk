// Twilio Integration for WhatsApp, SMS messaging
// Uses Replit's Twilio connector for secure credential management

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { storage } from './storage';

let twilioClient: Twilio | null = null;
let twilioFromNumber: string | null = null;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('Twilio credentials not available - X_REPLIT_TOKEN not found');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=twilio',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  const connectionSettings = data.items?.[0];

  if (!connectionSettings || 
      !connectionSettings.settings.account_sid || 
      !connectionSettings.settings.api_key || 
      !connectionSettings.settings.api_key_secret) {
    throw new Error('Twilio not connected - please configure Twilio in Replit');
  }
  
  return {
    accountSid: connectionSettings.settings.account_sid,
    apiKey: connectionSettings.settings.api_key,
    apiKeySecret: connectionSettings.settings.api_key_secret,
    phoneNumber: connectionSettings.settings.phone_number
  };
}

export async function getTwilioClient(): Promise<Twilio> {
  if (twilioClient) return twilioClient;
  
  const { accountSid, apiKey, apiKeySecret, phoneNumber } = await getCredentials();
  twilioClient = twilio(apiKey, apiKeySecret, { accountSid });
  twilioFromNumber = phoneNumber;
  
  console.log('[Twilio] Client initialized with phone:', phoneNumber);
  return twilioClient;
}

export async function getTwilioFromPhoneNumber(): Promise<string> {
  if (twilioFromNumber) return twilioFromNumber;
  
  const { phoneNumber } = await getCredentials();
  twilioFromNumber = phoneNumber;
  return phoneNumber;
}

export async function isTwilioConfigured(): Promise<boolean> {
  try {
    await getCredentials();
    return true;
  } catch {
    return false;
  }
}

// Send WhatsApp message via Twilio
export async function sendWhatsAppMessage(
  to: string,
  body: string,
  mediaUrl?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const client = await getTwilioClient();
    const fromNumber = await getTwilioFromPhoneNumber();
    
    // Format phone numbers for WhatsApp
    const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const fromWhatsApp = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
    
    const messageOptions: any = {
      from: fromWhatsApp,
      to: toWhatsApp,
      body: body
    };
    
    if (mediaUrl) {
      messageOptions.mediaUrl = [mediaUrl];
    }
    
    const message = await client.messages.create(messageOptions);
    
    console.log(`[Twilio] WhatsApp message sent: ${message.sid}`);
    return { success: true, messageId: message.sid };
  } catch (error: any) {
    console.error('[Twilio] Failed to send WhatsApp message:', error);
    return { success: false, error: error.message };
  }
}

// Send SMS message via Twilio
export async function sendSMSMessage(
  to: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const client = await getTwilioClient();
    const fromNumber = await getTwilioFromPhoneNumber();
    
    const message = await client.messages.create({
      from: fromNumber,
      to: to,
      body: body
    });
    
    console.log(`[Twilio] SMS sent: ${message.sid}`);
    return { success: true, messageId: message.sid };
  } catch (error: any) {
    console.error('[Twilio] Failed to send SMS:', error);
    return { success: false, error: error.message };
  }
}

// Process incoming Twilio webhook for WhatsApp/SMS
export async function processIncomingMessage(webhookData: any): Promise<void> {
  const {
    MessageSid,
    From,
    Body,
    NumMedia,
    MediaUrl0,
    MediaContentType0,
    ProfileName,
  } = webhookData;
  
  // Determine if it's WhatsApp or SMS
  const isWhatsApp = From?.startsWith('whatsapp:');
  
  // Clean phone number (remove whatsapp: prefix if present)
  const phoneNumber = From?.replace('whatsapp:', '').replace('+', '');
  
  if (!phoneNumber) {
    console.error('[Twilio] No phone number in webhook');
    return;
  }
  
  console.log(`[Twilio] Incoming WhatsApp from ${phoneNumber}: ${Body?.substring(0, 50)}...`);
  
  // Find or create contact
  let contact = await storage.getContactByPlatformId(phoneNumber, 'whatsapp');
  
  if (!contact) {
    // Try finding by phone number
    contact = await storage.getContactByPhoneNumber(phoneNumber);
  }
  
  if (!contact) {
    // Create new contact
    contact = await storage.createContact({
      name: ProfileName || phoneNumber,
      phoneNumber: phoneNumber,
      platform: 'whatsapp',
      platformId: phoneNumber,
    });
    console.log(`[Twilio] Created new contact: ${contact.id}`);
  }
  
  // Find or create conversation
  let conversation = await storage.getConversationByContactId(contact.id);
  
  if (!conversation) {
    conversation = await storage.createConversation({
      contactId: contact.id,
      platform: 'whatsapp',
    });
    console.log(`[Twilio] Created new conversation: ${conversation.id}`);
  }
  
  // Determine media URL if present
  let mediaUrl: string | undefined;
  let mediaType: string | undefined;
  
  if (NumMedia && parseInt(NumMedia) > 0 && MediaUrl0) {
    mediaUrl = MediaUrl0;
    if (MediaContentType0?.startsWith('image/')) {
      mediaType = 'image';
    } else if (MediaContentType0?.startsWith('video/')) {
      mediaType = 'video';
    } else if (MediaContentType0?.startsWith('audio/')) {
      mediaType = 'audio';
    } else {
      mediaType = 'document';
    }
  }
  
  // Create message
  await storage.createMessage({
    conversationId: conversation.id,
    content: Body || '',
    direction: 'inbound',
    status: 'delivered',
    externalId: MessageSid,
    mediaUrl,
    mediaType,
  });
  
  // Update conversation
  await storage.updateConversation(conversation.id, {
    lastMessageAt: new Date(),
    unreadCount: (conversation.unreadCount || 0) + 1,
  });
  
  console.log(`[Twilio] Message saved to conversation ${conversation.id}`);
}

// Update message status from Twilio status callback
export async function updateMessageStatus(webhookData: any): Promise<void> {
  const { MessageSid, MessageStatus } = webhookData;
  
  if (!MessageSid) return;
  
  // Map Twilio status to our status
  const statusMap: Record<string, string> = {
    'queued': 'pending',
    'sent': 'sent',
    'delivered': 'delivered',
    'read': 'read',
    'failed': 'failed',
    'undelivered': 'failed',
  };
  
  const status = statusMap[MessageStatus] || 'sent';
  
  // Find and update message by platform message ID
  // Note: This requires a storage method to find message by platformMessageId
  console.log(`[Twilio] Status update: ${MessageSid} -> ${status}`);
}
