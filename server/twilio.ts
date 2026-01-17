// Twilio Integration for WhatsApp, SMS messaging
// Supports both database-stored credentials (production) and Replit connector (development)

import twilio from 'twilio';
import type { Twilio } from 'twilio';
import { storage } from './storage';
import { handleAutoReply } from './autoreply';

let twilioClient: Twilio | null = null;
let twilioFromNumber: string | null = null;

// Get credentials from database (app_settings table)
async function getCredentialsFromDatabase(): Promise<{
  accountSid: string;
  authToken: string;
  phoneNumber: string;
} | null> {
  try {
    const accountSid = await storage.getAppSetting('twilio_account_sid');
    const authToken = await storage.getAppSetting('twilio_auth_token');
    const phoneNumber = await storage.getAppSetting('twilio_phone_number');
    
    if (accountSid?.value && authToken?.value && phoneNumber?.value) {
      return {
        accountSid: accountSid.value,
        authToken: authToken.value,
        phoneNumber: phoneNumber.value
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Get credentials from Replit connector (development only)
async function getCredentialsFromReplit(): Promise<{
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  phoneNumber: string;
} | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken || !hostname) {
    return null;
  }

  try {
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
      return null;
    }
    
    return {
      accountSid: connectionSettings.settings.account_sid,
      apiKey: connectionSettings.settings.api_key,
      apiKeySecret: connectionSettings.settings.api_key_secret,
      phoneNumber: connectionSettings.settings.phone_number
    };
  } catch {
    return null;
  }
}

// Get credentials - tries database first, then Replit connector
async function getCredentials(): Promise<{
  accountSid: string;
  authToken?: string;
  apiKey?: string;
  apiKeySecret?: string;
  phoneNumber: string;
  source: 'database' | 'replit';
}> {
  // First try database (works in production)
  const dbCreds = await getCredentialsFromDatabase();
  if (dbCreds) {
    return { ...dbCreds, source: 'database' };
  }
  
  // Then try Replit connector (works in development)
  const replitCreds = await getCredentialsFromReplit();
  if (replitCreds) {
    return { ...replitCreds, source: 'replit' };
  }
  
  throw new Error('Twilio credentials not configured - add them in Settings');
}

export async function getTwilioClient(): Promise<Twilio> {
  if (twilioClient) return twilioClient;
  
  const creds = await getCredentials();
  
  // Database credentials use accountSid + authToken
  // Replit credentials use apiKey + apiKeySecret  
  if (creds.source === 'database' && creds.authToken) {
    twilioClient = twilio(creds.accountSid, creds.authToken);
  } else if (creds.apiKey && creds.apiKeySecret) {
    twilioClient = twilio(creds.apiKey, creds.apiKeySecret, { accountSid: creds.accountSid });
  } else {
    throw new Error('Invalid Twilio credentials');
  }
  
  twilioFromNumber = creds.phoneNumber;
  
  console.log(`[Twilio] Client initialized (${creds.source}) with phone:`, creds.phoneNumber);
  return twilioClient;
}

// Clear cached client (call after settings change)
export function clearTwilioClient() {
  twilioClient = null;
  twilioFromNumber = null;
}

export async function getTwilioFromPhoneNumber(): Promise<string> {
  if (twilioFromNumber) return twilioFromNumber;
  
  const creds = await getCredentials();
  twilioFromNumber = creds.phoneNumber;
  return creds.phoneNumber;
}

// Get Twilio status for frontend display
export async function getTwilioStatus(): Promise<{
  connected: boolean;
  phoneNumber: string | null;
  source: 'database' | 'replit' | null;
}> {
  try {
    const creds = await getCredentials();
    return {
      connected: true,
      phoneNumber: creds.phoneNumber,
      source: creds.source
    };
  } catch {
    return {
      connected: false,
      phoneNumber: null,
      source: null
    };
  }
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
  
  // Trigger auto-reply using Twilio to send (fire and forget - don't await to not block response)
  const twilioSendFn = async (to: string, content: string) => {
    try {
      const result = await sendWhatsAppMessage(to, content);
      return { success: result.success, messageId: result.messageId };
    } catch (error) {
      console.error('[Twilio] Auto-reply send error:', error);
      return { success: false };
    }
  };
  
  handleAutoReply(
    conversation,
    contact,
    Body || '',
    twilioSendFn,
    'whatsapp'
  ).catch((err) => {
    console.error('[Twilio] Auto-reply error:', err);
  });
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

// =============== TWILIO CONTENT API (Template Sync) ===============

interface TwilioContentTemplate {
  sid: string;
  friendly_name: string;
  language: string;
  types: {
    'twilio/text'?: { body: string };
  };
  approval_requests?: {
    whatsapp?: {
      status: string;
      rejection_reason?: string;
    };
  };
}

// Convert OmniDesk variables to Twilio numbered variables
// {{recipient_name}} -> {{1}}, {{invoice_number}} -> {{2}}, etc.
function convertVariablesToTwilio(content: string, variables: string[]): {
  twilioContent: string;
  variableMap: Record<string, string>;
  defaultValues: Record<string, string>;
} {
  const variableMap: Record<string, string> = {};
  const defaultValues: Record<string, string> = {};
  let twilioContent = content;
  
  variables.forEach((variable, index) => {
    const twilioVar = `{{${index + 1}}}`;
    variableMap[variable] = twilioVar;
    defaultValues[String(index + 1)] = `[${variable}]`; // Default sample value
    
    // Replace all occurrences of {{variable}} with {{1}}, {{2}}, etc.
    const regex = new RegExp(`\\{\\{${variable}\\}\\}`, 'g');
    twilioContent = twilioContent.replace(regex, twilioVar);
  });
  
  return { twilioContent, variableMap, defaultValues };
}

// Helper to get auth credentials for HTTP requests
// Database uses accountSid:authToken, Replit uses apiKey:apiKeySecret
async function getAuthForHttp(): Promise<{ authString: string; accountSid: string } | null> {
  try {
    const creds = await getCredentials();
    let authString: string;
    
    if (creds.source === 'database' && creds.authToken) {
      authString = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
    } else if (creds.apiKey && creds.apiKeySecret) {
      authString = Buffer.from(`${creds.apiKey}:${creds.apiKeySecret}`).toString('base64');
    } else {
      return null;
    }
    
    return { authString, accountSid: creds.accountSid };
  } catch {
    return null;
  }
}

// Create a template in Twilio Content API
// NOTE: Twilio SDK does NOT support template creation - must use direct HTTP requests
export async function syncTemplateToTwilio(
  templateName: string,
  content: string,
  variables: string[] = [],
  language: string = 'en'
): Promise<{
  success: boolean;
  contentSid?: string;
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    // Convert variables to Twilio format
    const { twilioContent, defaultValues } = convertVariablesToTwilio(content, variables);
    
    // Build payload for Content API
    const payload: any = {
      friendly_name: templateName,
      language: language,
      types: {
        'twilio/text': {
          body: twilioContent
        }
      }
    };
    
    // Add variable defaults if we have variables
    if (variables.length > 0) {
      payload.variables = defaultValues;
    }
    
    // Use direct HTTP request since SDK doesn't support template creation
    const response = await fetch('https://content.twilio.com/v1/Content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth.authString}`
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('[Twilio Content] API error:', result);
      return {
        success: false,
        error: result.message || result.error || `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    console.log(`[Twilio Content] Template created: ${result.sid}`);
    
    return {
      success: true,
      contentSid: result.sid
    };
  } catch (error: any) {
    console.error('[Twilio Content] Error creating template:', error);
    return {
      success: false,
      error: error.message || 'Failed to create template in Twilio'
    };
  }
}

// Submit template for WhatsApp approval
// Uses direct HTTP request to Twilio Content API
export async function submitTemplateForApproval(contentSid: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    // Submit for WhatsApp approval via HTTP
    const response = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth.authString}`
      }
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('[Twilio Content] Approval API error:', result);
      return {
        success: false,
        error: result.message || result.error || `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    // Log the full response for debugging
    console.log(`[Twilio Content] Template ${contentSid} submitted for WhatsApp approval:`, JSON.stringify(result, null, 2));
    
    // Response has status at top level
    const status = result.status;
    
    if (!status) {
      console.warn(`[Twilio Content] No status in approval response, defaulting to 'received'`);
    }
    
    return {
      success: true,
      status: status || 'received'
    };
  } catch (error: any) {
    console.error('[Twilio Content] Error submitting for approval:', error);
    return {
      success: false,
      error: error.message || 'Failed to submit template for approval'
    };
  }
}

// Check template approval status
// Uses direct HTTP request to Twilio Content API
export async function getTemplateApprovalStatus(contentSid: string): Promise<{
  success: boolean;
  status?: string;
  rejectionReason?: string;
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    // Fetch approval status via HTTP
    const response = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth.authString}`
      }
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('[Twilio Content] Status fetch API error:', result);
      return {
        success: false,
        error: result.message || result.error || `HTTP ${response.status}: ${response.statusText}`
      };
    }
    
    // Log for debugging
    console.log(`[Twilio Content] Approval status for ${contentSid}:`, JSON.stringify(result, null, 2));
    
    // Response has whatsapp object containing status
    const whatsapp = result.whatsapp;
    
    if (!whatsapp) {
      console.warn(`[Twilio Content] No whatsapp object in approval response for ${contentSid}`);
      return {
        success: true,
        status: 'unknown',
      };
    }
    
    const status = whatsapp.status;
    const rejectionReason = whatsapp.rejection_reason || undefined;
    
    if (!status) {
      console.warn(`[Twilio Content] No status in whatsapp object for ${contentSid}`);
    }
    
    return {
      success: true,
      status: status || 'unknown',
      rejectionReason: rejectionReason
    };
  } catch (error: any) {
    console.error('[Twilio Content] Error fetching approval status:', error);
    return {
      success: false,
      error: error.message || 'Failed to fetch approval status'
    };
  }
}

// Delete a template from Twilio
export async function deleteTemplateFromTwilio(contentSid: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = await getTwilioClient();
    
    await client.content.v1.contents(contentSid).remove();
    
    console.log(`[Twilio Content] Template ${contentSid} deleted`);
    
    return { success: true };
  } catch (error: any) {
    console.error('[Twilio Content] Error deleting template:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete template from Twilio'
    };
  }
}
