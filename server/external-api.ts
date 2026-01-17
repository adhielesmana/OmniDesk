import { Request, Response, NextFunction, Router } from "express";
import crypto from "crypto";
import { storage } from "./storage";
import { z } from "zod";
import { ApiClient } from "@shared/schema";

const DEFAULT_TIMEZONE = "Asia/Jakarta";

// Apply template variables to template content
function applyTemplateVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(placeholder, value || '');
  }
  return result;
}

// Format Indonesian Rupiah currency
function formatRupiah(amount: string | number): string {
  const num = typeof amount === 'string' ? parseInt(amount.replace(/\D/g, ''), 10) : amount;
  if (isNaN(num)) return String(amount);
  return num.toLocaleString('id-ID');
}

function getLocalDateTime(timezone: string) {
  const now = new Date();
  const jakartaOffset = 7 * 60; // WIB is UTC+7
  const localTime = new Date(now.getTime() + (jakartaOffset + now.getTimezoneOffset()) * 60000);
  const hour = localTime.getHours();
  
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

async function generateAIPersonalizedMessage(
  apiKey: string, 
  aiPrompt: string, 
  originalMessage: string,
  recipientName: string | null,
  phoneNumber: string
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  const { formattedDate, formattedTime, dayName } = getLocalDateTime(DEFAULT_TIMEZONE);

  try {
    const systemPrompt = `You are a helpful assistant that generates personalized WhatsApp messages.
Based on the client's instructions (AI Prompt) and the incoming message data, generate a unique, natural-sounding personalized message.
Make the message feel personal and human, avoiding robotic or templated language.
Keep the message concise and appropriate for WhatsApp.
Vary your writing style, sentence structure, and vocabulary to make each message unique.

CRITICAL: NEVER use marketing or promotional language. Avoid these words completely:
- English: promotion, promo, discount, sale, offer, deal, limited time, special price, buy now, order now, exclusive, free, bonus, cashback, voucher, coupon
- Indonesian: promosi, promo, diskon, potongan harga, penawaran, gratis, bonus, cashback, voucher, kupon, harga spesial, terbatas, beli sekarang, pesan sekarang

Instead, use conversational and friendly language.

Current date and time context (Indonesia timezone - WIB):
- Date: ${formattedDate}
- Time: ${formattedTime}
- Day: ${dayName}

Use appropriate greetings based on the time of day if relevant.`;

    const userPrompt = `Client's AI Instructions (Prompt):
${aiPrompt}

Incoming Message Data:
- Recipient Name: ${recipientName || "Unknown"}
- Phone Number: ${phoneNumber}
- Original Message Content: ${originalMessage}

Based on the client's AI instructions above, generate a personalized message for this recipient. 
Read and understand the original message content, then transform it according to the AI instructions.`;

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
    return data.choices[0]?.message?.content?.trim() || originalMessage;
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("AI personalization error:", error);
    // Return original message if AI fails
    return originalMessage;
  }
}

declare global {
  namespace Express {
    interface Request {
      apiClient?: ApiClient;
    }
  }
}

const HMAC_TIMESTAMP_TOLERANCE_MS = 10 * 60 * 1000; // 10 minutes tolerance for clock drift

// In-memory sliding window rate limiter for per-minute rate limiting
const rateLimitWindows: Map<string, { count: number; resetAt: number }> = new Map();

function checkRateLimitPerMinute(clientId: string, limit: number): { allowed: boolean; remaining: number; resetAt: Date } {
  const now = Date.now();
  const windowKey = clientId;
  const window = rateLimitWindows.get(windowKey);
  
  if (!window || now >= window.resetAt) {
    // Create new window
    rateLimitWindows.set(windowKey, { count: 1, resetAt: now + 60000 });
    return { allowed: true, remaining: limit - 1, resetAt: new Date(now + 60000) };
  }
  
  if (window.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: new Date(window.resetAt) };
  }
  
  window.count++;
  return { allowed: true, remaining: limit - window.count, resetAt: new Date(window.resetAt) };
}

// Clean up expired rate limit windows periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateLimitWindows.entries()) {
    if (now >= window.resetAt) {
      rateLimitWindows.delete(key);
    }
  }
}, 60000);

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET required for API secret encryption");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function generateClientId(): string {
  return `odk_${crypto.randomBytes(12).toString("hex")}`;
}

function generateSecretKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function encryptSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecret(encryptedSecret: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(encryptedSecret, "base64");
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

function verifyHmacSignature(
  clientId: string,
  timestamp: string,
  body: string,
  signature: string,
  encryptedSecret: string
): boolean {
  try {
    const secret = decryptSecret(encryptedSecret);
    const message = `${clientId}.${timestamp}.${body}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(message)
      .digest("hex");
    
    // Both signature and expectedSignature are hex strings
    // Compare them as hex-encoded buffers for proper timing-safe comparison
    // Handle length mismatch to avoid timingSafeEqual throwing
    if (signature.length !== expectedSignature.length) {
      return false;
    }
    
    // Normalize to lowercase for case-insensitive hex comparison
    const normalizedSig = signature.toLowerCase();
    const normalizedExpected = expectedSignature.toLowerCase();
    
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSig, "hex"),
      Buffer.from(normalizedExpected, "hex")
    );
  } catch (error) {
    console.error("HMAC verification error:", error);
    return false;
  }
}

export async function apiAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const startTime = Date.now();
  const clientId = req.headers["x-client-id"] as string;
  const timestamp = req.headers["x-timestamp"] as string;
  const signature = req.headers["x-signature"] as string;

  if (!clientId || !timestamp || !signature) {
    return res.status(401).json({
      error: "Missing authentication headers",
      required: ["X-Client-Id", "X-Timestamp", "X-Signature"],
    });
  }

  const timestampMs = parseInt(timestamp, 10);
  if (isNaN(timestampMs)) {
    return res.status(401).json({ error: "Invalid timestamp format" });
  }

  const now = Date.now();
  const timeDiff = Math.abs(now - timestampMs);
  if (timeDiff > HMAC_TIMESTAMP_TOLERANCE_MS) {
    // Detect if client might be sending seconds instead of milliseconds
    const looksLikeSeconds = timestampMs < 10000000000; // Unix seconds are 10 digits
    return res.status(401).json({
      error: "Request timestamp expired or in future",
      serverTime: now,
      receivedTimestamp: timestampMs,
      differenceMs: timeDiff,
      hint: looksLikeSeconds 
        ? "Timestamp appears to be in seconds - use milliseconds (Date.now() or time()*1000)"
        : "Ensure your system clock is synchronized (within 10 minutes of server time)",
    });
  }

  const client = await storage.getApiClientByClientId(clientId);
  if (!client) {
    return res.status(401).json({ error: "Invalid client ID" });
  }

  if (!client.isActive) {
    return res.status(403).json({ error: "API client is disabled" });
  }

  if (client.ipWhitelist && client.ipWhitelist.length > 0) {
    // Use Cloudflare's CF-Connecting-IP header first (most reliable behind Cloudflare)
    // Fall back to X-Real-IP, then X-Forwarded-For, then socket IP
    const cfConnectingIp = req.headers["cf-connecting-ip"] as string | undefined;
    const xRealIp = req.headers["x-real-ip"] as string | undefined;
    const forwardedFor = req.headers["x-forwarded-for"];
    const socketIp = req.ip || req.socket.remoteAddress || "";
    
    const realIp = cfConnectingIp 
      || xRealIp 
      || (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim()) 
      || socketIp;

    if (!client.ipWhitelist.includes(realIp)) {
      return res.status(403).json({
        error: "IP address not whitelisted",
        ip: realIp,
      });
    }
  }

  // HMAC signature verification using raw request body
  // The raw body is captured before JSON parsing, so clients sign the exact payload they send
  // For GET requests (no body), use empty string to match what clients sign
  const rawBody = (req as any).rawBody;
  let bodyString: string;
  if (rawBody instanceof Buffer) {
    bodyString = rawBody.toString('utf8');
  } else if (req.method === 'GET' || Object.keys(req.body || {}).length === 0) {
    // GET requests and empty bodies should use empty string for signature
    bodyString = '';
  } else {
    // Fallback for non-empty POST bodies without raw capture (shouldn't happen normally)
    bodyString = JSON.stringify(req.body);
  }
  const isValid = verifyHmacSignature(
    clientId,
    timestamp,
    bodyString,
    signature,
    client.secretHash
  );

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Per-minute rate limiting (sliding window)
  if (client.rateLimitPerMinute && client.rateLimitPerMinute > 0) {
    const rateCheck = checkRateLimitPerMinute(clientId, client.rateLimitPerMinute);
    
    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", client.rateLimitPerMinute);
    res.setHeader("X-RateLimit-Remaining", rateCheck.remaining);
    res.setHeader("X-RateLimit-Reset", Math.floor(rateCheck.resetAt.getTime() / 1000));
    
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: "Rate limit exceeded",
        limit: client.rateLimitPerMinute,
        remaining: 0,
        reset_at: rateCheck.resetAt.toISOString(),
      });
    }
  }

  // Daily quota check
  const lastReset = client.lastResetAt ? new Date(client.lastResetAt) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!lastReset || lastReset < today) {
    await storage.resetApiClientDailyCount(client.id);
    client.requestCountToday = 0;
  }

  if (client.rateLimitPerDay && (client.requestCountToday || 0) >= client.rateLimitPerDay) {
    return res.status(429).json({
      error: "Daily quota exceeded",
      limit: client.rateLimitPerDay,
      reset_at: new Date(today.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  await storage.incrementApiClientRequestCount(clientId);

  req.apiClient = client;

  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const durationMs = Date.now() - startTime;
    storage.createApiRequestLog({
      clientId: client.id,
      endpoint: req.path,
      method: req.method,
      requestBody: JSON.stringify(req.body || {}).substring(0, 10000),
      responseStatus: res.statusCode,
      responseBody: JSON.stringify(body || {}).substring(0, 10000),
      ipAddress: req.ip || req.socket.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
      durationMs,
    }).catch(console.error);
    return originalJson(body);
  };

  next();
}

const sendMessageSchema = z.object({
  request_id: z.string().min(1).max(255),
  phone_number: z.string().min(10).max(20),
  recipient_name: z.string().max(255).optional(), // Optional name for AI personalization
  message: z.string().min(1).max(4096),
  priority: z.number().int().min(0).max(100).optional().default(0),
  scheduled_at: z.string().datetime().optional(),
  metadata: z.record(z.any()).optional(),
});

const bulkSendSchema = z.object({
  messages: z.array(sendMessageSchema).min(1).max(100),
});

export const externalApiRouter = Router();

externalApiRouter.use(apiAuthMiddleware);

externalApiRouter.post("/messages", async (req: Request, res: Response) => {
  try {
    const validation = sendMessageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.error.issues,
      });
    }

    const { request_id, phone_number, recipient_name, message, priority, scheduled_at, metadata } = validation.data;

    const existing = await storage.getApiMessageByRequestId(request_id);
    if (existing) {
      return res.status(409).json({
        error: "Duplicate request_id",
        message_id: existing.id,
        status: existing.status,
      });
    }

    const client = req.apiClient!;
    let finalMessage = message;
    let aiGenerated = false;
    let templateApplied = false;
    let matchedTemplateName: string | null = null;
    let matchedBy: string | null = null;

    // Import template functions
    const { selectTemplate, renderTemplate } = await import('./template-selector');
    const meta = (metadata && typeof metadata === 'object') ? metadata as Record<string, any> : {};
    
    // Priority 0: Check if client has a default template assigned
    let selectionResult: { template: any | null; matchedBy: string | null } = { template: null, matchedBy: null };
    
    if (client.defaultTemplateId) {
      // Client has a specific template assigned - use it directly
      const { storage } = await import('./storage');
      const clientTemplate = await storage.getMessageTemplate(client.defaultTemplateId);
      // Only use if template is active, has Twilio SID, and is approved
      if (clientTemplate && clientTemplate.isActive && clientTemplate.twilioContentSid && clientTemplate.twilioApprovalStatus === 'approved') {
        selectionResult = { template: clientTemplate, matchedBy: 'client_default' };
        console.log(`API queue: Using client's default template "${clientTemplate.name}" for request ${request_id}`);
      } else if (clientTemplate) {
        console.log(`API queue: Client template "${clientTemplate.name}" not usable (active=${clientTemplate.isActive}, sid=${clientTemplate.twilioContentSid}, status=${clientTemplate.twilioApprovalStatus})`);
      }
    }
    
    // If no client template, use 3-tier selection: messageType → trigger rules → default
    if (!selectionResult.template) {
      const templateContext = {
        messageType: meta.messageType,
        message: message,
        variables: {
          recipient_name: recipient_name || meta.recipient_name || 'Pelanggan',
          invoice_number: meta.invoice_number || '',
          grand_total: meta.grand_total ? formatRupiah(meta.grand_total) : '',
          invoice_url: message,
          phone_number: phone_number,
          ...meta,
        }
      };
      
      // Select template using 3-tier priority
      selectionResult = await selectTemplate(templateContext);
    }
    
    if (selectionResult.template) {
      const template = selectionResult.template;
      matchedTemplateName = template.name;
      matchedBy = selectionResult.matchedBy;
      
      // Map message type to Indonesian text for invoice-related messages
      let messageTypeText = '';
      if (meta.messageType) {
        switch (meta.messageType) {
          case 'new_invoice':
            messageTypeText = 'Berikut adalah tagihan baru untuk layanan internet Anda:';
            break;
          case 'reminder_invoices':
            messageTypeText = 'Kami mengingatkan tagihan internet Anda yang belum dibayar:';
            break;
          case 'overdue':
            messageTypeText = 'PENTING: Tagihan internet Anda sudah melewati jatuh tempo:';
            break;
          case 'payment_confirmation':
            messageTypeText = 'Terima kasih! Pembayaran Anda telah kami terima untuk:';
            break;
          default:
            messageTypeText = 'Informasi tagihan internet Anda:';
        }
      }
      
      // Build template variables
      const templateVars: Record<string, string> = {
        recipient_name: recipient_name || meta.recipient_name || 'Pelanggan',
        invoice_number: meta.invoice_number || '',
        grand_total: meta.grand_total ? formatRupiah(meta.grand_total) : '',
        invoice_url: message,
        message_type: messageTypeText,
        message: message,
        phone_number: phone_number,
        ...Object.fromEntries(
          Object.entries(meta).filter(([k, v]) => typeof v === 'string')
        ),
      };
      
      finalMessage = renderTemplate(template, templateVars);
      templateApplied = true;
      console.log(`API queue: Applied template "${template.name}" (matched by ${matchedBy}) for request ${request_id}`);
    } else {
      console.log(`API queue: No template match for request ${request_id}, using original message`);
    }

    // Apply AI personalization if the client has an AI prompt configured (and no template was applied)
    if (!templateApplied && client.aiPrompt && client.aiPrompt.trim().length > 0) {
      const apiKey = await getOpenAIKey();
      if (apiKey) {
        console.log(`API queue: Generating AI personalized message for request ${request_id}`);
        try {
          finalMessage = await generateAIPersonalizedMessage(
            apiKey,
            client.aiPrompt,
            message,
            recipient_name || null,
            phone_number
          );
          aiGenerated = true;
          console.log(`API queue: AI message generated successfully for request ${request_id}`);
        } catch (aiError) {
          console.error(`API queue: AI generation failed for request ${request_id}:`, aiError);
          // Fall back to original message
          finalMessage = message;
        }
      } else {
        console.warn(`API queue: Client ${client.name} has AI prompt but no OpenAI API key configured`);
      }
    }

    const queuedMessage = await storage.createApiMessage({
      requestId: request_id,
      clientId: client.id,
      phoneNumber: phone_number.replace(/\D/g, ""),
      recipientName: recipient_name || null,
      message: finalMessage,
      priority: priority || 0,
      scheduledAt: scheduled_at ? new Date(scheduled_at) : null,
      metadata: metadata ? JSON.stringify({ ...metadata, originalMessage: message, aiGenerated, templateApplied, matchedTemplateName, matchedBy }) : JSON.stringify({ originalMessage: message, aiGenerated, templateApplied, matchedTemplateName, matchedBy }),
    });

    return res.status(201).json({
      success: true,
      message_id: queuedMessage.id,
      request_id: queuedMessage.requestId,
      status: queuedMessage.status,
      ai_generated: aiGenerated,
      template_applied: templateApplied,
      template_name: matchedTemplateName,
      matched_by: matchedBy,
      created_at: queuedMessage.createdAt,
    });
  } catch (error) {
    console.error("Error creating API message:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

externalApiRouter.post("/messages/bulk", async (req: Request, res: Response) => {
  try {
    const validation = bulkSendSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validation.error.issues,
      });
    }

    const client = req.apiClient!;
    const hasAiPrompt = client.aiPrompt && client.aiPrompt.trim().length > 0;
    const apiKey = hasAiPrompt ? await getOpenAIKey() : null;

    const results: Array<{
      request_id: string;
      success: boolean;
      message_id?: string;
      ai_generated?: boolean;
      error?: string;
    }> = [];

    for (const msg of validation.data.messages) {
      try {
        const existing = await storage.getApiMessageByRequestId(msg.request_id);
        if (existing) {
          results.push({
            request_id: msg.request_id,
            success: false,
            message_id: existing.id,
            error: "Duplicate request_id",
          });
          continue;
        }

        let finalMessage = msg.message;
        let aiGenerated = false;

        // Apply AI personalization if the client has an AI prompt configured
        if (hasAiPrompt && apiKey) {
          try {
            finalMessage = await generateAIPersonalizedMessage(
              apiKey,
              client.aiPrompt!,
              msg.message,
              msg.recipient_name || null,
              msg.phone_number
            );
            aiGenerated = true;
          } catch (aiError) {
            console.error(`API queue bulk: AI generation failed for request ${msg.request_id}:`, aiError);
            finalMessage = msg.message;
          }
        }

        const queuedMessage = await storage.createApiMessage({
          requestId: msg.request_id,
          clientId: client.id,
          phoneNumber: msg.phone_number.replace(/\D/g, ""),
          recipientName: msg.recipient_name || null,
          message: finalMessage,
          priority: msg.priority || 0,
          scheduledAt: msg.scheduled_at ? new Date(msg.scheduled_at) : null,
          metadata: msg.metadata ? JSON.stringify({ ...msg.metadata, originalMessage: msg.message, aiGenerated }) : JSON.stringify({ originalMessage: msg.message, aiGenerated }),
        });

        results.push({
          request_id: msg.request_id,
          success: true,
          message_id: queuedMessage.id,
          ai_generated: aiGenerated,
        });
      } catch (err) {
        results.push({
          request_id: msg.request_id,
          success: false,
          error: "Failed to queue message",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    return res.status(successCount > 0 ? 201 : 400).json({
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (error) {
    console.error("Error in bulk send:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

externalApiRouter.get("/messages/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    let message = await storage.getApiMessage(id);
    if (!message) {
      message = await storage.getApiMessageByRequestId(id);
    }

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.clientId !== req.apiClient!.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    return res.json({
      message_id: message.id,
      request_id: message.requestId,
      phone_number: message.phoneNumber,
      message: message.message,
      status: message.status,
      error_message: message.errorMessage,
      external_message_id: message.externalMessageId,
      scheduled_at: message.scheduledAt,
      sent_at: message.sentAt,
      created_at: message.createdAt,
      updated_at: message.updatedAt,
    });
  } catch (error) {
    console.error("Error getting message:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get available templates (for API clients to reference)
externalApiRouter.get("/templates", async (req: Request, res: Response) => {
  try {
    const templates = await storage.getAllMessageTemplates();
    const activeTemplates = templates.filter(t => t.isActive);
    
    return res.json({
      templates: activeTemplates.map(t => ({
        name: t.name,
        description: t.description,
        variables: t.variables,
        category: t.category,
      })),
    });
  } catch (error) {
    console.error("Error getting templates:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

externalApiRouter.get("/status", async (req: Request, res: Response) => {
  try {
    const client = req.apiClient!;
    
    const messages = await storage.getApiMessageQueue(client.id);
    const queuedCount = messages.filter((m) => m.status === "queued").length;
    const processingCount = messages.filter((m) => m.status === "processing" || m.status === "sending").length;
    const sentTodayCount = messages.filter((m) => {
      if (m.status !== "sent" || !m.sentAt) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(m.sentAt) >= today;
    }).length;
    const failedTodayCount = messages.filter((m) => {
      if (m.status !== "failed") return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(m.updatedAt!) >= today;
    }).length;

    return res.json({
      client_id: client.clientId,
      name: client.name,
      is_active: client.isActive,
      rate_limit_per_day: client.rateLimitPerDay,
      requests_today: client.requestCountToday,
      queue: {
        queued: queuedCount,
        processing: processingCount,
        sent_today: sentTodayCount,
        failed_today: failedTodayCount,
      },
    });
  } catch (error) {
    console.error("Error getting status:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export { generateClientId, generateSecretKey, encryptSecret };
