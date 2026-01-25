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

// Get Twilio auth headers for media fetch
export async function getTwilioAuthHeaders(): Promise<Record<string, string>> {
  const creds = await getCredentials();
  
  // Create Basic auth header
  const username = creds.source === 'database' ? creds.accountSid : creds.apiKey || creds.accountSid;
  const password = creds.source === 'database' ? creds.authToken! : creds.apiKeySecret || '';
  const authString = Buffer.from(`${username}:${password}`).toString('base64');
  
  return {
    'Authorization': `Basic ${authString}`,
  };
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

// Sanitize content variable values for Twilio WhatsApp templates
// Twilio rejects: newlines, tabs, and more than 4 consecutive spaces
// Note: Empty values should be rejected BEFORE calling this function
function sanitizeContentVariable(value: string): string {
  let sanitized = String(value);
  
  // Replace newlines and tabs with spaces
  sanitized = sanitized.replace(/[\n\r\t]/g, ' ');
  
  // Replace more than 4 consecutive spaces with max 4
  sanitized = sanitized.replace(/\s{5,}/g, '    ');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  return sanitized;
}

// Validate and prepare content variables for Twilio template
// Returns sanitized variables or an error if validation fails
function validateAndSanitizeContentVariables(
  contentVariables: Record<string, string>,
  templateContent?: string
): { success: true; variables: Record<string, string> } | { success: false; error: string } {
  // Require template content for proper validation
  if (!templateContent) {
    console.warn('[Twilio] Warning: No template content provided for validation, performing basic sanitization only');
  }
  
  // Check for any empty values in provided variables (Twilio rejects empty strings)
  const providedKeys = Object.keys(contentVariables).sort((a, b) => parseInt(a) - parseInt(b));
  for (const key of providedKeys) {
    if (contentVariables[key] === "" || contentVariables[key] === null || contentVariables[key] === undefined) {
      return {
        success: false,
        error: `Template variable {{${key}}} has empty value. All variables must have non-empty values for Twilio.`
      };
    }
  }
  
  // Extract required placeholders from template content if provided
  let requiredPlaceholders: string[] = [];
  if (templateContent) {
    const matches = templateContent.match(/\{\{(\d+)\}\}/g) || [];
    requiredPlaceholders = Array.from(new Set(matches.map(m => m.replace(/[{}]/g, '')))).sort((a, b) => parseInt(a) - parseInt(b));
  }
  
  // If we have template content, validate against required placeholders
  if (requiredPlaceholders.length > 0) {
    // Check that all required placeholders have non-empty values
    const missingOrEmptyPlaceholders = requiredPlaceholders.filter(p => {
      const value = contentVariables[p];
      return value === undefined || value === null || value === "";
    });
    
    if (missingOrEmptyPlaceholders.length > 0) {
      return {
        success: false,
        error: `Missing or empty required template variables: ${missingOrEmptyPlaceholders.map(p => `{{${p}}}`).join(', ')}. All template placeholders must have non-empty values.`
      };
    }
    
    // Check that provided keys exactly match required placeholders (no extras)
    const extraKeys = providedKeys.filter(k => !requiredPlaceholders.includes(k));
    if (extraKeys.length > 0) {
      console.warn(`[Twilio] Warning: Extra variables provided that are not in template: ${extraKeys.join(', ')}`);
      // Remove extra keys - don't include them in the sanitized variables
    }
  }
  
  // Check that we have sequential placeholders (no gaps)
  // Twilio requires: if you have {{1}} and {{3}}, you must also have {{2}}
  // Use template placeholders as source of truth if available
  const keysToCheck = requiredPlaceholders.length > 0 ? requiredPlaceholders : providedKeys;
  if (keysToCheck.length > 0) {
    const maxKey = Math.max(...keysToCheck.map(k => parseInt(k)));
    
    for (let i = 1; i <= maxKey; i++) {
      // Only check if it's a required placeholder
      if (requiredPlaceholders.length > 0 && !requiredPlaceholders.includes(String(i))) {
        continue; // Skip if not required by template
      }
      if (contentVariables[String(i)] === undefined || contentVariables[String(i)] === "") {
        return {
          success: false,
          error: `Missing sequential variable {{${i}}}. Template requires all placeholders from 1 to ${maxKey}.`
        };
      }
    }
  }
  
  // Sanitize all values - remove newlines, tabs, excessive spaces
  // Note: empty values already rejected above for required placeholders
  const sanitizedVariables: Record<string, string> = {};
  const keysToInclude = requiredPlaceholders.length > 0 ? requiredPlaceholders : providedKeys;
  for (const key of keysToInclude) {
    const value = contentVariables[key];
    if (value !== undefined) {
      sanitizedVariables[key] = sanitizeContentVariable(value);
    }
  }
  
  return { success: true, variables: sanitizedVariables };
}

// Send WhatsApp message using approved template (ContentSid)
// Required for business-initiated messages outside 24-hour window
export async function sendWhatsAppTemplate(
  to: string,
  contentSid: string,
  contentVariables: Record<string, string>,
  templateContent?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const client = await getTwilioClient();
    const fromNumber = await getTwilioFromPhoneNumber();
    
    // Format phone numbers for WhatsApp
    const toWhatsApp = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const fromWhatsApp = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
    
    // Validate and sanitize content variables
    const validation = validateAndSanitizeContentVariables(contentVariables, templateContent);
    if (!validation.success) {
      console.error(`[Twilio] Content variable validation failed: ${validation.error}`);
      return { success: false, error: validation.error };
    }
    
    const sanitizedVariables = validation.variables;
    
    // Log the content variables being sent for debugging
    console.log(`[Twilio] Sending WhatsApp template ${contentSid} to ${to}`);
    console.log(`[Twilio] Content variables (sanitized):`, JSON.stringify(sanitizedVariables));
    
    const message = await client.messages.create({
      from: fromWhatsApp,
      to: toWhatsApp,
      contentSid: contentSid,
      contentVariables: JSON.stringify(sanitizedVariables)
    });
    
    console.log(`[Twilio] WhatsApp template message sent: ${message.sid} (template: ${contentSid})`);
    return { success: true, messageId: message.sid };
  } catch (error: any) {
    console.error('[Twilio] Failed to send WhatsApp template:', error);
    console.error('[Twilio] Template:', contentSid, 'Variables:', JSON.stringify(contentVariables));
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
    Timestamp,
    DateSent, // Alternative timestamp field
    DateCreated, // Another possible timestamp field
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
    if (MediaContentType0?.startsWith('image/')) {
      mediaType = 'image';
    } else if (MediaContentType0?.startsWith('video/')) {
      mediaType = 'video';
    } else if (MediaContentType0?.startsWith('audio/')) {
      mediaType = 'audio';
    } else {
      mediaType = 'document';
    }
    
    // Try to upload to S3 for persistent storage
    try {
      const { isS3Configured, uploadMediaFromUrl, getExtensionFromContentType } = await import("./s3");
      if (await isS3Configured()) {
        const ext = getExtensionFromContentType(MediaContentType0 || 'application/octet-stream');
        const filename = `${MessageSid}${ext}`;
        const authHeaders = await getTwilioAuthHeaders();
        
        const result = await uploadMediaFromUrl(MediaUrl0, 'whatsapp-media', filename, authHeaders);
        if (result.success && result.url) {
          mediaUrl = result.url;
          console.log(`[Twilio] Media uploaded to S3: ${result.url}`);
        } else {
          console.warn(`[Twilio] S3 upload failed, using original URL: ${result.error}`);
          mediaUrl = MediaUrl0;
        }
      } else {
        mediaUrl = MediaUrl0;
      }
    } catch (s3Error) {
      console.error('[Twilio] S3 upload error:', s3Error);
      mediaUrl = MediaUrl0;
    }
  }
  
  // Parse timestamp from Twilio webhook (try multiple fields)
  // IMPORTANT: Always use UTC timestamps for consistent timezone handling
  let messageTimestamp: Date;
  const rawTimestamp = Timestamp || DateSent || DateCreated;
  if (rawTimestamp) {
    const parsed = new Date(rawTimestamp);
    if (!isNaN(parsed.getTime())) {
      messageTimestamp = parsed;
      console.log(`[Twilio] Using webhook timestamp: ${messageTimestamp.toISOString()}`);
    } else {
      messageTimestamp = new Date(); // Current UTC time
      console.log(`[Twilio] Invalid webhook timestamp, using current: ${messageTimestamp.toISOString()}`);
    }
  } else {
    // No timestamp from Twilio, use current UTC time
    messageTimestamp = new Date();
    console.log(`[Twilio] No webhook timestamp, using current: ${messageTimestamp.toISOString()}`);
  }
  
  // Create message (storage.createMessage also updates conversation metadata)
  await storage.createMessage({
    conversationId: conversation.id,
    content: Body || '',
    direction: 'inbound',
    status: 'delivered',
    externalId: MessageSid,
    mediaUrl,
    mediaType,
    timestamp: messageTimestamp, // Always explicitly set UTC timestamp
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
export async function getAuthForHttp(): Promise<{ authString: string; accountSid: string } | null> {
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
  language: string = 'en',
  category: string = 'UTILITY'
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
// Category should be: UTILITY, MARKETING, or AUTHENTICATION
export async function submitTemplateForApproval(
  contentSid: string, 
  category: string = 'UTILITY',
  templateName?: string
): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    // Normalize category to uppercase for Twilio API
    const normalizedCategory = category.toUpperCase();
    const validCategories = ['UTILITY', 'MARKETING', 'AUTHENTICATION'];
    const twilioCategory = validCategories.includes(normalizedCategory) ? normalizedCategory : 'UTILITY';
    
    // Build approval request payload
    // According to Twilio docs, category is required, name is the WhatsApp template name
    const payload: { category: string; name?: string } = {
      category: twilioCategory
    };
    
    // Use template name if provided (for WhatsApp template registration)
    if (templateName) {
      // WhatsApp template names must be lowercase with underscores
      payload.name = templateName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }
    
    console.log(`[Twilio Content] Submitting template ${contentSid} for approval with category: ${twilioCategory}${templateName ? `, name: ${payload.name}` : ''}`);
    
    // Submit for WhatsApp approval via HTTP with category
    const response = await fetch(`https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth.authString}`
      },
      body: JSON.stringify(payload)
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

// List all templates from Twilio Content API
export async function listTwilioTemplates(): Promise<{
  success: boolean;
  templates?: Array<{
    sid: string;
    friendlyName: string;
    language: string;
    body?: string;
    variables?: Record<string, string>;
    whatsappStatus?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    const response = await fetch('https://content.twilio.com/v1/Content', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth.authString}`
      }
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('[Twilio Content] List templates error:', result);
      return {
        success: false,
        error: result.message || result.error || `HTTP ${response.status}`
      };
    }
    
    const templates = (result.contents || []).map((content: any) => {
      // Extract WhatsApp approval status - check multiple possible paths
      // Twilio Content API uses approval_requests.whatsapp or approval_requests.content_approval
      let whatsappStatus = 'unknown';
      if (content.approval_requests?.whatsapp?.status) {
        whatsappStatus = content.approval_requests.whatsapp.status;
      } else if (content.approval_requests?.content_approval?.status) {
        whatsappStatus = content.approval_requests.content_approval.status;
      } else if (content.approval_requests) {
        // Check any approval request status
        const requests = content.approval_requests;
        for (const key of Object.keys(requests)) {
          if (requests[key]?.status) {
            whatsappStatus = requests[key].status;
            break;
          }
        }
      }
      
      return {
        sid: content.sid,
        friendlyName: content.friendly_name,
        language: content.language || 'en',
        body: content.types?.['twilio/text']?.body || content.types?.['twilio/quick-reply']?.body || '',
        variables: content.variables || {},
        whatsappStatus,
        createdAt: content.date_created,
        updatedAt: content.date_updated
      };
    });
    
    // Log status for debugging
    templates.forEach((t: { friendlyName: string; sid: string; whatsappStatus: string }) => {
      console.log(`[Twilio Content] Template ${t.friendlyName} (${t.sid}): status=${t.whatsappStatus}`);
    });
    
    console.log(`[Twilio Content] Found ${templates.length} templates`);
    return { success: true, templates };
  } catch (error: any) {
    console.error('[Twilio Content] Error listing templates:', error);
    return {
      success: false,
      error: error.message || 'Failed to list templates from Twilio'
    };
  }
}

// Get single template details from Twilio
export async function getTwilioTemplate(contentSid: string): Promise<{
  success: boolean;
  template?: {
    sid: string;
    friendlyName: string;
    language: string;
    body?: string;
    variables?: Record<string, string>;
    whatsappStatus?: string;
  };
  error?: string;
}> {
  try {
    const auth = await getAuthForHttp();
    if (!auth) {
      return { success: false, error: 'Twilio credentials not configured' };
    }
    
    const response = await fetch(`https://content.twilio.com/v1/Content/${contentSid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth.authString}`
      }
    });
    
    const content = await response.json();
    
    if (!response.ok) {
      console.error('[Twilio Content] Get template error:', content);
      return {
        success: false,
        error: content.message || content.error || `HTTP ${response.status}`
      };
    }
    
    // Also get approval status
    const approvalResult = await getTemplateApprovalStatus(contentSid);
    
    return {
      success: true,
      template: {
        sid: content.sid,
        friendlyName: content.friendly_name,
        language: content.language || 'en',
        body: content.types?.['twilio/text']?.body || '',
        variables: content.variables || {},
        whatsappStatus: approvalResult.status || 'unknown'
      }
    };
  } catch (error: any) {
    console.error('[Twilio Content] Error getting template:', error);
    return {
      success: false,
      error: error.message || 'Failed to get template from Twilio'
    };
  }
}

// Sync all Twilio templates to database (Twilio -> App)
export async function syncTwilioToDatabase(options: { deleteOrphans?: boolean } = {}): Promise<{
  success: boolean;
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let unchanged = 0;
  
  try {
    const listResult = await listTwilioTemplates();
    if (!listResult.success || !listResult.templates) {
      return { success: false, synced: 0, created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [listResult.error || 'Failed to list templates'] };
    }
    
    const { storage } = await import('./storage');
    const allTemplates = await storage.getAllMessageTemplates();
    
    // Build set of all Twilio SIDs for orphan detection
    const twilioSids = new Set<string>();
    
    // Track ContentSids already processed in this sync to avoid duplicates
    const processedSids = new Set<string>();
    
    for (const twilioTemplate of listResult.templates) {
      twilioSids.add(twilioTemplate.sid);
      
      try {
        // Skip if we've already processed this ContentSid
        if (processedSids.has(twilioTemplate.sid)) {
          console.log(`[Sync] Skipping duplicate ContentSid: ${twilioTemplate.sid}`);
          continue;
        }
        processedSids.add(twilioTemplate.sid);
        
        // Try to find matching template by ContentSid first (exact match)
        let existingTemplate = allTemplates.find(t => t.twilioContentSid === twilioTemplate.sid);
        
        // Get approval status - if list API returned 'unknown', fetch the actual status
        let whatsappStatus = twilioTemplate.whatsappStatus;
        if (whatsappStatus === 'unknown' || !whatsappStatus) {
          // Fetch the actual approval status from the dedicated API
          const statusResult = await getTemplateApprovalStatus(twilioTemplate.sid);
          if (statusResult.success && statusResult.status) {
            whatsappStatus = statusResult.status;
            console.log(`[Sync] Fetched actual status for ${twilioTemplate.friendlyName}: ${whatsappStatus}`);
          }
        }
        
        // Normalize approval status from Twilio
        const twilioApprovalStatus = whatsappStatus === 'approved' ? 'approved' : 
                                      whatsappStatus === 'rejected' ? 'rejected' : 'pending';
        const twilioContent = twilioTemplate.body || '';
        
        if (existingTemplate) {
          // Check if there are actual changes before updating
          const hasChanges = 
            existingTemplate.twilioApprovalStatus !== twilioApprovalStatus ||
            existingTemplate.content !== twilioContent;
          
          if (hasChanges) {
            await storage.updateMessageTemplate(existingTemplate.id, {
              twilioApprovalStatus,
              twilioSyncedAt: new Date(),
              content: twilioContent || existingTemplate.content
            });
            console.log(`[Sync] Updated template ${existingTemplate.name} (ContentSid: ${twilioTemplate.sid}, status: ${twilioApprovalStatus})`);
            synced++;
            updated++;
          } else {
            console.log(`[Sync] Template ${existingTemplate.name} unchanged, skipping`);
            unchanged++;
          }
        } else {
          // This ContentSid doesn't exist in database - create new template
          // Use full friendly name to preserve uniqueness
          const templateName = twilioTemplate.friendlyName;
          
          // Check if a template with this exact name already exists
          const nameExists = allTemplates.find(t => t.name === templateName);
          // If name exists, append ContentSid suffix to make it unique
          const finalName = nameExists ? `${templateName}_${twilioTemplate.sid.slice(-8)}` : templateName;
          
          const newTemplate = await storage.createMessageTemplate({
            name: finalName,
            content: twilioContent,
            variables: Object.keys(twilioTemplate.variables || {}),
            isActive: true,
            twilioContentSid: twilioTemplate.sid,
            twilioApprovalStatus,
            twilioSyncedAt: new Date()
          });
          console.log(`[Sync] Created template ${finalName} (ContentSid: ${twilioTemplate.sid})`);
          synced++;
          created++;
          
          // Add to allTemplates to track for subsequent iterations
          allTemplates.push(newTemplate as any);
        }
      } catch (err: any) {
        errors.push(`Error syncing ${twilioTemplate.friendlyName}: ${err.message}`);
      }
    }
    
    // Delete orphaned templates (templates in app with SID that no longer exists in Twilio)
    if (options.deleteOrphans !== false) {
      for (const template of allTemplates) {
        if (template.twilioContentSid && !twilioSids.has(template.twilioContentSid)) {
          try {
            console.log(`[Sync] Deleting orphaned template ${template.name} (ContentSid: ${template.twilioContentSid} no longer exists in Twilio)`);
            await storage.deleteMessageTemplate(template.id);
            deleted++;
          } catch (err: any) {
            errors.push(`Error deleting orphaned template ${template.name}: ${err.message}`);
          }
        }
      }
    }
    
    return { success: true, synced, created, updated, deleted, unchanged, errors };
  } catch (error: any) {
    return { success: false, synced, created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [error.message] };
  }
}

// Combined bidirectional sync: Twilio -> App first, then App -> Twilio
export async function bidirectionalSync(): Promise<{
  success: boolean;
  fromTwilio: { created: number; updated: number; deleted: number; unchanged: number };
  toTwilio: { synced: number; skipped: number };
  errors: string[];
}> {
  const errors: string[] = [];
  
  try {
    console.log('[Bidirectional Sync] Starting Twilio -> App sync...');
    
    // Step 1: Sync from Twilio to App (creates, updates, deletes orphans)
    const fromTwilioResult = await syncTwilioToDatabase({ deleteOrphans: true });
    
    if (!fromTwilioResult.success) {
      return {
        success: false,
        fromTwilio: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
        toTwilio: { synced: 0, skipped: 0 },
        errors: fromTwilioResult.errors
      };
    }
    
    errors.push(...fromTwilioResult.errors);
    
    console.log(`[Bidirectional Sync] Twilio -> App completed: ${fromTwilioResult.created} created, ${fromTwilioResult.updated} updated, ${fromTwilioResult.deleted} deleted, ${fromTwilioResult.unchanged} unchanged`);
    
    // Step 2: Sync from App to Twilio (push local templates that don't exist in Twilio)
    console.log('[Bidirectional Sync] Starting App -> Twilio sync...');
    
    const { storage } = await import('./storage');
    const allLocalTemplates = await storage.getAllMessageTemplates();
    
    // Get current Twilio templates to check what exists
    const twilioResult = await listTwilioTemplates();
    const twilioSids = new Set((twilioResult.templates || []).map(t => t.sid));
    
    let toTwilioSynced = 0;
    let toTwilioSkipped = 0;
    
    for (const localTemplate of allLocalTemplates) {
      // Only sync templates that don't have a valid Twilio ContentSid
      if (!localTemplate.twilioContentSid || !twilioSids.has(localTemplate.twilioContentSid)) {
        // Template doesn't exist in Twilio - create it
        if (localTemplate.content && localTemplate.content.trim()) {
          try {
            const result = await syncDatabaseToTwilio(localTemplate.id);
            if (result.success) {
              console.log(`[Bidirectional Sync] Pushed template ${localTemplate.name} to Twilio (${result.contentSid})`);
              toTwilioSynced++;
            } else {
              errors.push(`Failed to push ${localTemplate.name}: ${result.error}`);
            }
          } catch (err: any) {
            errors.push(`Error pushing ${localTemplate.name}: ${err.message}`);
          }
        } else {
          console.log(`[Bidirectional Sync] Skipping ${localTemplate.name} - no content`);
          toTwilioSkipped++;
        }
      } else {
        // Template already exists in Twilio
        toTwilioSkipped++;
      }
    }
    
    console.log(`[Bidirectional Sync] App -> Twilio completed: ${toTwilioSynced} synced, ${toTwilioSkipped} skipped`);
    
    return {
      success: true,
      fromTwilio: {
        created: fromTwilioResult.created,
        updated: fromTwilioResult.updated,
        deleted: fromTwilioResult.deleted,
        unchanged: fromTwilioResult.unchanged
      },
      toTwilio: {
        synced: toTwilioSynced,
        skipped: toTwilioSkipped
      },
      errors
    };
  } catch (error: any) {
    console.error('[Bidirectional Sync] Error:', error);
    return {
      success: false,
      fromTwilio: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      toTwilio: { synced: 0, skipped: 0 },
      errors: [error.message]
    };
  }
}

// Sync database template to Twilio (App -> Twilio)
export async function syncDatabaseToTwilio(templateId: string): Promise<{
  success: boolean;
  contentSid?: string;
  status?: string;
  error?: string;
}> {
  try {
    const { storage } = await import('./storage');
    const template = await storage.getMessageTemplateById(templateId);
    
    if (!template) {
      return { success: false, error: 'Template not found' };
    }
    
    // If template already has a ContentSid, check if we need to update
    if (template.twilioContentSid) {
      // Delete old template and create new one (Twilio doesn't support updates)
      await deleteTemplateFromTwilio(template.twilioContentSid);
    }
    
    // Create new template in Twilio
    const templateCategory = template.category || 'UTILITY';
    const createResult = await syncTemplateToTwilio(
      template.name,
      template.content,
      template.variables || [],
      'id', // Indonesian
      templateCategory
    );
    
    if (!createResult.success) {
      return { success: false, error: createResult.error };
    }
    
    // Submit for WhatsApp approval with category and template name
    const approvalResult = await submitTemplateForApproval(createResult.contentSid!, templateCategory, template.name);
    
    // Update database with new ContentSid
    await storage.updateMessageTemplate(templateId, {
      twilioContentSid: createResult.contentSid,
      twilioApprovalStatus: approvalResult.status === 'approved' ? 'approved' : 'pending',
      twilioSyncedAt: new Date()
    });
    
    console.log(`[Sync] Synced template ${template.name} to Twilio: ${createResult.contentSid}`);
    
    return {
      success: true,
      contentSid: createResult.contentSid,
      status: approvalResult.status
    };
  } catch (error: any) {
    console.error('[Sync] Error syncing to Twilio:', error);
    return { success: false, error: error.message };
  }
}

// Bulk sync all database templates to Twilio (App -> Twilio)
// Also cleans up orphaned Twilio templates (only if explicitly requested)
export async function bulkSyncDatabaseToTwilio(options: {
  deleteOrphans?: boolean;
  forceResync?: boolean;
} = {}): Promise<{
  success: boolean;
  synced: number;
  deleted: number;
  skipped: number;
  orphans: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const orphans: string[] = [];
  let synced = 0;
  let deleted = 0;
  let skipped = 0;
  
  try {
    const { storage } = await import('./storage');
    const allLocalTemplates = await storage.getAllMessageTemplates();
    
    // Get all Twilio templates
    const twilioResult = await listTwilioTemplates();
    if (!twilioResult.success) {
      return { success: false, synced: 0, deleted: 0, skipped: 0, orphans: [], errors: [twilioResult.error || 'Failed to list Twilio templates'] };
    }
    
    const twilioTemplates = twilioResult.templates || [];
    const localContentSids = new Set(allLocalTemplates.map(t => t.twilioContentSid).filter(Boolean));
    const localNames = new Set(allLocalTemplates.map(t => t.name.toLowerCase()));
    
    // 1. Find orphaned Twilio templates (exist in Twilio but not linked to local DB)
    // Only delete if explicitly requested AND template name doesn't match any local template
    for (const twilioTemplate of twilioTemplates) {
      if (!localContentSids.has(twilioTemplate.sid)) {
        // Check if name matches any local template (could be a template that needs linking)
        const nameMatch = localNames.has(twilioTemplate.friendlyName.toLowerCase()) || 
                         localNames.has(twilioTemplate.friendlyName.replace(/_\d+$/, '').toLowerCase());
        
        if (options.deleteOrphans === true && !nameMatch) {
          // Only delete if explicitly requested AND no name match
          try {
            await deleteTemplateFromTwilio(twilioTemplate.sid);
            console.log(`[Bulk Sync] Deleted orphaned Twilio template: ${twilioTemplate.friendlyName} (${twilioTemplate.sid})`);
            deleted++;
          } catch (err: any) {
            errors.push(`Failed to delete orphan ${twilioTemplate.friendlyName}: ${err.message}`);
          }
        } else {
          // Report as orphan but don't delete
          orphans.push(`${twilioTemplate.friendlyName} (${twilioTemplate.sid})`);
          console.log(`[Bulk Sync] Found orphaned Twilio template (not deleting): ${twilioTemplate.friendlyName} (${twilioTemplate.sid})`);
        }
      }
    }
    
    // 2. Sync all local templates to Twilio
    for (const localTemplate of allLocalTemplates) {
      try {
        // Check if template exists in Twilio with matching ContentSid
        const existsInTwilio = twilioTemplates.find(t => t.sid === localTemplate.twilioContentSid);
        
        if (!existsInTwilio || options.forceResync === true) {
          // Template doesn't exist in Twilio or force resync - create/update it
          const result = await syncDatabaseToTwilio(localTemplate.id);
          if (result.success) {
            console.log(`[Bulk Sync] Synced template ${localTemplate.name} to Twilio (${result.contentSid})`);
            synced++;
          } else {
            errors.push(`Failed to sync ${localTemplate.name}: ${result.error}`);
          }
        } else {
          // Template exists in Twilio - refresh status only
          const statusResult = await refreshTemplateStatus(localTemplate.id);
          if (statusResult.success) {
            console.log(`[Bulk Sync] Refreshed status for ${localTemplate.name}: ${statusResult.status}`);
            skipped++;
          }
        }
      } catch (err: any) {
        errors.push(`Error syncing ${localTemplate.name}: ${err.message}`);
      }
    }
    
    return { success: true, synced, deleted, skipped, orphans, errors };
  } catch (error: any) {
    return { success: false, synced, deleted, skipped: 0, orphans: [], errors: [error.message] };
  }
}

// Refresh approval status for a template
export async function refreshTemplateStatus(templateId: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  try {
    const { storage } = await import('./storage');
    const template = await storage.getMessageTemplateById(templateId);
    
    if (!template || !template.twilioContentSid) {
      return { success: false, error: 'Template not found or not synced to Twilio' };
    }
    
    const statusResult = await getTemplateApprovalStatus(template.twilioContentSid);
    
    if (!statusResult.success) {
      return { success: false, error: statusResult.error };
    }
    
    // Update database with new status
    const approvalStatus = statusResult.status === 'approved' ? 'approved' : 
                           statusResult.status === 'rejected' ? 'rejected' : 'pending';
    
    await storage.updateMessageTemplate(templateId, {
      twilioApprovalStatus: approvalStatus,
      twilioSyncedAt: new Date()
    });
    
    console.log(`[Sync] Refreshed status for ${template.name}: ${approvalStatus}`);
    
    return { success: true, status: approvalStatus };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
