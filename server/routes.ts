import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { z } from "zod";
import multer from "multer";
import Papa from "papaparse";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { MetaApiService, type WebhookMessage } from "./meta-api";
import { whatsappService } from "./whatsapp";
import { updateContactSchema, type Platform, type User, insertUserSchema, insertDepartmentSchema } from "@shared/schema";
import { hashPassword, verifyPassword, isAdmin, getUserDepartmentIds } from "./auth";
import { clearCampaignTiming, triggerImmediateGeneration, generateCampaignMessageBatch } from "./blast-worker";
import { isAutoReplyEnabled, getAutoReplyPrompt, setAutoReplyEnabled, setAutoReplyPrompt, deleteAutoReplyPrompt, handleAutoReply, hasValidOpenAIKey } from "./autoreply";
import { externalApiRouter, generateClientId, generateSecretKey, encryptSecret } from "./external-api";
import { resolveShortUrl } from "./url-shortener";
import type { Contact } from "@shared/schema";

const execAsync = promisify(exec);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function normalizeWhatsAppJid(jid: string): string {
  return jid
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "")
    .replace("@c.us", "")
    .replace("+", "");
}

// Check if an ID is a WhatsApp LID (Linked ID) rather than a real phone number
// LIDs are internal WhatsApp identifiers with 15+ digits that don't map to phone numbers
function isWhatsAppLid(id: string): boolean {
  const cleaned = id.replace(/[^0-9]/g, "");
  // LIDs typically have 14+ digits and don't start with valid country codes like 62, 1, 44, etc.
  // Real phone numbers are typically 10-14 digits with recognizable country codes
  if (cleaned.length >= 15) return true;
  if (cleaned.length >= 14) {
    // Check if it starts with common country codes - if not, likely a LID
    const commonPrefixes = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98'];
    const hasValidCountryCode = commonPrefixes.some(prefix => cleaned.startsWith(prefix));
    // If 14 digits but doesn't start with valid country code, it's likely a LID
    if (!hasValidCountryCode) return true;
  }
  return false;
}

// Normalize phone number: convert local Indonesian numbers (starting with 0) to +62 format
function normalizePhoneNumber(phone: string): { digits: string; formatted: string } {
  let digits = phone.replace(/[^0-9]/g, "");
  
  // If starts with 0, assume Indonesian number and convert to 62
  if (digits.startsWith("0")) {
    digits = "62" + digits.substring(1);
  }
  
  return {
    digits,
    formatted: `+${digits}`,
  };
}

// Get OpenAI API key from settings or environment
async function getOpenAIKey(): Promise<string | null> {
  const setting = await storage.getAppSetting("openai_api_key");
  return setting?.value || process.env.OPENAI_API_KEY || null;
}

// Use OpenAI to detect CSV column mappings
async function detectCSVColumnsWithAI(
  headers: string[],
  sampleRows: Record<string, string>[]
): Promise<{ nameColumn: string | null; phoneColumn: string | null; confidence: number }> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const sampleData = sampleRows.slice(0, 3).map(row => {
    const rowData: Record<string, string> = {};
    headers.forEach(h => {
      rowData[h] = row[h] || "";
    });
    return rowData;
  });

  const prompt = `Analyze this CSV data and identify which columns contain:
1. Person's name (full name, first name, contact name, etc.)
2. Phone number (mobile, telephone, WhatsApp number, etc.)

Headers: ${JSON.stringify(headers)}

Sample data (first 3 rows):
${JSON.stringify(sampleData, null, 2)}

Respond in JSON format only:
{
  "nameColumn": "exact header name for name column or null if not found",
  "phoneColumn": "exact header name for phone column or null if not found",
  "confidence": 0.0 to 1.0 indicating how confident you are
}

Important:
- The column names might be in any language (Indonesian, English, etc.)
- Phone columns might contain numbers starting with 0, +62, 62, or other formats
- Name columns might be labeled "nama", "name", "contact", "pelanggan", "customer", etc.
- Only return the JSON, no other text.`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a data analysis assistant. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    // Parse JSON response, handling potential markdown code blocks
    let jsonContent = content;
    if (content.startsWith("```")) {
      jsonContent = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    }

    const result = JSON.parse(jsonContent);
    
    // Validate the detected columns exist in headers
    return {
      nameColumn: headers.includes(result.nameColumn) ? result.nameColumn : null,
      phoneColumn: headers.includes(result.phoneColumn) ? result.phoneColumn : null,
      confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("AI column detection error:", error);
    throw error;
  }
}

async function validateOpenAIKey(apiKey: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error("OpenAI validation timed out");
    } else {
      console.error("OpenAI validation error:", error);
    }
    return false;
  }
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

declare module "express-session" {
  interface SessionData {
    userId: string;
    user: {
      id: string;
      username: string;
      role: User["role"];
      displayName: string | null;
    };
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || !req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.session.user.role !== "admin" && req.session.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden - Admin access required" });
  }
  next();
}

function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId || !req.session.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.session.user.role !== "superadmin") {
    return res.status(403).json({ error: "Forbidden - Superadmin access required" });
  }
  next();
}

// Update service state
interface UpdateStatus {
  isChecking: boolean;
  isUpdating: boolean;
  hasUpdate: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  lastChecked: Date | null;
  updateLog: string[];
  error: string | null;
}

const updateStatus: UpdateStatus = {
  isChecking: false,
  isUpdating: false,
  hasUpdate: false,
  localCommit: null,
  remoteCommit: null,
  lastChecked: null,
  updateLog: [],
  error: null,
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // WebSocket setup for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  const broadcast = (data: unknown) => {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // ============= URL SHORTENER REDIRECT =============
  app.get("/s/:shortCode", async (req, res) => {
    try {
      const { shortCode } = req.params;
      const originalUrl = await resolveShortUrl(shortCode);
      
      if (!originalUrl) {
        return res.status(404).send("Link not found or expired");
      }
      
      // Use JavaScript redirect instead of HTTP 301 to prevent WhatsApp preview from seeing final domain
      // WhatsApp link preview only executes HTTP redirects, not JavaScript
      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex, nofollow">
  <title>Redirecting...</title>
  <script>window.location.replace("${originalUrl.replace(/"/g, '\\"')}");</script>
</head>
<body>
  <p>Redirecting... <a href="${originalUrl.replace(/"/g, '&quot;')}">Click here</a> if not redirected.</p>
</body>
</html>`;
      res.type('html').send(html);
    } catch (error) {
      console.error("Error resolving short URL:", error);
      res.status(500).send("Error processing link");
    }
  });

  // ============= AUTHENTICATION ROUTES =============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      console.log("Login attempt for:", username);
      
      if (!username || !password) {
        console.log("Missing username or password");
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        console.log("User not found:", username);
        return res.status(401).json({ error: "Invalid credentials" });
      }
      
      if (!user.isActive) {
        console.log("User is inactive:", username);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await verifyPassword(password, user.password);
      console.log("Password verification result:", valid);
      
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      };

      // Explicitly save session before responding
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Session save failed" });
        }
        res.json({
          id: user.id,
          username: user.username,
          role: user.role,
          displayName: user.displayName,
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  // Debug endpoint for diagnosing session issues in production
  app.get("/api/debug/session", (req, res) => {
    const cookieHeader = req.get("cookie") || "";
    const hasSessionCookie = cookieHeader.includes("inbox.sid");
    
    res.json({
      hasSession: !!req.session,
      hasUserId: !!req.session?.userId,
      sessionId: req.sessionID ? req.sessionID.substring(0, 8) + "..." : null,
      cookieSecure: req.session?.cookie?.secure,
      cookieSameSite: req.session?.cookie?.sameSite,
      isProduction: process.env.NODE_ENV === "production",
      protocol: req.protocol,
      host: req.get("host"),
      xForwardedProto: req.get("x-forwarded-proto"),
      receivedSessionCookie: hasSessionCookie,
      cookieCount: cookieHeader.split(";").filter(c => c.trim()).length,
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "User not found" });
    }

    const departments = await storage.getUserDepartments(user.id);
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      departments: user.role === "superadmin" ? "all" : departments,
    });
  });

  // ============= EXTERNAL API ROUTES =============
  app.use("/api/external", externalApiRouter);

  // ============= ADMIN API CLIENTS MANAGEMENT =============
  app.get("/api/admin/api-clients", requireSuperadmin, async (req, res) => {
    try {
      const clients = await storage.getApiClients();
      const clientsWithStats = clients.map((client) => ({
        id: client.id,
        name: client.name,
        clientId: client.clientId,
        isActive: client.isActive,
        aiPrompt: client.aiPrompt,
        rateLimitPerMinute: client.rateLimitPerMinute,
        rateLimitPerDay: client.rateLimitPerDay,
        requestCountToday: client.requestCountToday,
        lastRequestAt: client.lastRequestAt,
        ipWhitelist: client.ipWhitelist,
        createdAt: client.createdAt,
      }));
      res.json(clientsWithStats);
    } catch (error) {
      console.error("Error fetching API clients:", error);
      res.status(500).json({ error: "Failed to fetch API clients" });
    }
  });

  app.post("/api/admin/api-clients", requireSuperadmin, async (req, res) => {
    try {
      const { name, aiPrompt, rateLimitPerMinute, rateLimitPerDay, ipWhitelist } = req.body;
      
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "Name is required" });
      }

      const clientId = generateClientId();
      const secretKey = generateSecretKey();
      const secretHash = encryptSecret(secretKey);

      const newClient = await storage.createApiClient({
        name: name.trim(),
        clientId,
        secretHash,
        isActive: true,
        aiPrompt: aiPrompt?.trim() || null,
        rateLimitPerMinute: rateLimitPerMinute || 60,
        rateLimitPerDay: rateLimitPerDay || 1000,
        ipWhitelist: ipWhitelist || null,
        createdBy: req.session.userId!,
      });

      res.status(201).json({
        id: newClient.id,
        name: newClient.name,
        clientId: newClient.clientId,
        secretKey,
        isActive: newClient.isActive,
        rateLimitPerMinute: newClient.rateLimitPerMinute,
        rateLimitPerDay: newClient.rateLimitPerDay,
        createdAt: newClient.createdAt,
        warning: "Save the secret key now. It cannot be retrieved later.",
      });
    } catch (error) {
      console.error("Error creating API client:", error);
      res.status(500).json({ error: "Failed to create API client" });
    }
  });

  app.patch("/api/admin/api-clients/:id", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, aiPrompt, isActive, rateLimitPerMinute, rateLimitPerDay, ipWhitelist } = req.body;

      const client = await storage.getApiClient(id);
      if (!client) {
        return res.status(404).json({ error: "API client not found" });
      }

      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name;
      if (aiPrompt !== undefined) updateData.aiPrompt = aiPrompt;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (rateLimitPerMinute !== undefined) updateData.rateLimitPerMinute = rateLimitPerMinute;
      if (rateLimitPerDay !== undefined) updateData.rateLimitPerDay = rateLimitPerDay;
      if (ipWhitelist !== undefined) updateData.ipWhitelist = ipWhitelist;

      const updated = await storage.updateApiClient(id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating API client:", error);
      res.status(500).json({ error: "Failed to update API client" });
    }
  });

  app.post("/api/admin/api-clients/:id/regenerate-secret", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;

      const client = await storage.getApiClient(id);
      if (!client) {
        return res.status(404).json({ error: "API client not found" });
      }

      const newSecretKey = generateSecretKey();
      const newSecretHash = encryptSecret(newSecretKey);

      await storage.updateApiClient(id, { secretHash: newSecretHash } as any);

      res.json({
        clientId: client.clientId,
        secretKey: newSecretKey,
        warning: "Save the new secret key now. It cannot be retrieved later.",
      });
    } catch (error) {
      console.error("Error regenerating secret:", error);
      res.status(500).json({ error: "Failed to regenerate secret" });
    }
  });

  app.delete("/api/admin/api-clients/:id", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;

      const client = await storage.getApiClient(id);
      if (!client) {
        return res.status(404).json({ error: "API client not found" });
      }

      await storage.deleteApiClient(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting API client:", error);
      res.status(500).json({ error: "Failed to delete API client" });
    }
  });

  // ============= API MESSAGE QUEUE ROUTES =============
  app.get("/api/admin/api-message-queue", requireSuperadmin, async (req, res) => {
    try {
      const messages = await storage.getApiMessageQueueWithClient();
      res.json(messages);
    } catch (error) {
      console.error("Error fetching API message queue:", error);
      res.status(500).json({ error: "Failed to fetch message queue" });
    }
  });

  app.delete("/api/admin/api-message-queue/:id", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;
      const message = await storage.getApiMessage(id);
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }
      if (message.status === "sent") {
        return res.status(400).json({ error: "Cannot delete sent messages" });
      }
      await storage.deleteApiMessage(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting API message:", error);
      res.status(500).json({ error: "Failed to delete message" });
    }
  });

  app.get("/api/admin/api-clients/:id/logs", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;

      const client = await storage.getApiClient(id);
      if (!client) {
        return res.status(404).json({ error: "API client not found" });
      }

      const logs = await storage.getApiRequestLogs(id, limit);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching API logs:", error);
      res.status(500).json({ error: "Failed to fetch API logs" });
    }
  });

  app.get("/api/admin/api-queue", requireSuperadmin, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const messages = await storage.getApiMessageQueue(clientId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching API queue:", error);
      res.status(500).json({ error: "Failed to fetch API queue" });
    }
  });

  // ============= MESSAGE TEMPLATES MANAGEMENT =============
  app.get("/api/admin/templates", requireSuperadmin, async (req, res) => {
    try {
      const templates = await storage.getAllMessageTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  app.post("/api/admin/templates", requireSuperadmin, async (req, res) => {
    try {
      const { name, description, content, variables, category } = req.body;
      
      if (!name || !content) {
        return res.status(400).json({ error: "Name and content are required" });
      }

      const existing = await storage.getMessageTemplateByName(name);
      if (existing) {
        return res.status(409).json({ error: "Template with this name already exists" });
      }

      const template = await storage.createMessageTemplate({
        name,
        description,
        content,
        variables: variables || [],
        category,
        isActive: true,
        createdBy: req.user?.id,
      });
      
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ error: "Failed to create template" });
    }
  });

  app.put("/api/admin/templates/:id", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, content, variables, category, isActive } = req.body;
      
      const template = await storage.updateMessageTemplate(id, {
        name,
        description,
        content,
        variables,
        category,
        isActive,
      });
      
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      
      res.json(template);
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).json({ error: "Failed to update template" });
    }
  });

  app.delete("/api/admin/templates/:id", requireSuperadmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteMessageTemplate(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting template:", error);
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  // Export all templates as JSON
  app.get("/api/admin/templates/export", requireSuperadmin, async (req, res) => {
    try {
      const templates = await storage.getAllMessageTemplates();
      // Remove id field for export (will be regenerated on import)
      const exportData = templates.map(({ id, createdAt, updatedAt, ...rest }) => rest);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="templates-export.json"');
      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        templates: exportData,
      });
    } catch (error) {
      console.error("Error exporting templates:", error);
      res.status(500).json({ error: "Failed to export templates" });
    }
  });

  // Import templates from JSON
  app.post("/api/admin/templates/import", requireSuperadmin, async (req, res) => {
    try {
      const { templates, overwrite } = req.body;
      
      if (!Array.isArray(templates)) {
        return res.status(400).json({ error: "Invalid import data: templates must be an array" });
      }

      const results = { imported: 0, skipped: 0, updated: 0, errors: [] as string[] };
      
      for (const template of templates) {
        try {
          // Check if template with same name exists
          const existing = await storage.getMessageTemplateByName(template.name);
          
          if (existing) {
            if (overwrite) {
              // Update existing template
              await storage.updateMessageTemplate(existing.id, {
                content: template.content,
                platform: template.platform,
                category: template.category,
                description: template.description,
                variables: template.variables,
                isActive: template.isActive ?? true,
              });
              results.updated++;
            } else {
              results.skipped++;
            }
          } else {
            // Create new template
            await storage.createMessageTemplate({
              name: template.name,
              content: template.content,
              platform: template.platform || 'whatsapp',
              category: template.category,
              description: template.description,
              variables: template.variables,
              isActive: template.isActive ?? true,
            });
            results.imported++;
          }
        } catch (err) {
          results.errors.push(`Failed to import "${template.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      
      res.json(results);
    } catch (error) {
      console.error("Error importing templates:", error);
      res.status(500).json({ error: "Failed to import templates" });
    }
  });

  // ============= ADMIN USER MANAGEMENT =============
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithDepartments = await Promise.all(
        users.map(async (user) => {
          const departments = await storage.getUserDepartments(user.id);
          return {
            id: user.id,
            username: user.username,
            role: user.role,
            displayName: user.displayName,
            isActive: user.isActive,
            isDeletable: user.isDeletable,
            departments,
            createdAt: user.createdAt,
          };
        })
      );
      res.json(usersWithDepartments);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const validation = insertUserSchema.omit({ id: true, password: true }).extend({
        password: z.string().min(6),
        departmentIds: z.array(z.string()).optional(),
      }).safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const { password, departmentIds, ...userData } = validation.data;
      const hashedPassword = await hashPassword(password);

      const newUser = await storage.createUser({
        ...userData,
        password: hashedPassword,
      });

      if (departmentIds && departmentIds.length > 0) {
        await storage.setUserDepartments(newUser.id, departmentIds);
      }

      const departments = await storage.getUserDepartments(newUser.id);
      res.json({
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        displayName: newUser.displayName,
        isActive: newUser.isActive,
        departments,
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const { password, departmentIds, ...userData } = req.body;

      let updateData: any = { ...userData };
      if (password) {
        updateData.password = await hashPassword(password);
      }

      const updated = await storage.updateUser(req.params.id, updateData);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      if (departmentIds !== undefined) {
        await storage.setUserDepartments(req.params.id, departmentIds);
      }

      const departments = await storage.getUserDepartments(updated.id);
      res.json({
        id: updated.id,
        username: updated.username,
        role: updated.role,
        displayName: updated.displayName,
        isActive: updated.isActive,
        departments,
      });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!user.isDeletable) {
        return res.status(403).json({ error: "This user cannot be deleted" });
      }

      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ============= DEPARTMENT MANAGEMENT =============
  app.get("/api/admin/departments", requireAdmin, async (req, res) => {
    try {
      const departments = await storage.getAllDepartments();
      res.json(departments);
    } catch (error) {
      console.error("Error fetching departments:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  });

  app.post("/api/admin/departments", requireAdmin, async (req, res) => {
    try {
      const validation = insertDepartmentSchema.omit({ id: true }).safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }

      const department = await storage.createDepartment(validation.data);
      res.json(department);
    } catch (error) {
      console.error("Error creating department:", error);
      res.status(500).json({ error: "Failed to create department" });
    }
  });

  app.patch("/api/admin/departments/:id", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateDepartment(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Department not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating department:", error);
      res.status(500).json({ error: "Failed to update department" });
    }
  });

  app.delete("/api/admin/departments/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteDepartment(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting department:", error);
      res.status(500).json({ error: "Failed to delete department" });
    }
  });

  // ============= BRANDING SETTINGS =============
  const brandingFolder = path.join(process.cwd(), "media", "branding");
  if (!fs.existsSync(brandingFolder)) {
    fs.mkdirSync(brandingFolder, { recursive: true });
  }

  // Public endpoint - no auth required so login page can show branding
  app.get("/api/admin/branding", async (req, res) => {
    try {
      const logoSetting = await storage.getAppSetting("organization_logo");
      const nameSetting = await storage.getAppSetting("organization_name");
      res.json({
        logoUrl: logoSetting?.value || null,
        organizationName: nameSetting?.value || null,
      });
    } catch (error) {
      console.error("Error fetching branding:", error);
      res.status(500).json({ error: "Failed to fetch branding" });
    }
  });

  app.post("/api/admin/branding/logo", requireSuperadmin, upload.single("logo"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ error: "Invalid file type. Only JPEG, PNG, GIF, WebP allowed." });
      }

      const ext = req.file.mimetype.split("/")[1] === "jpeg" ? "jpg" : req.file.mimetype.split("/")[1];
      const filename = `logo_${Date.now()}.${ext}`;
      const filepath = path.join(brandingFolder, filename);

      const oldLogoSetting = await storage.getAppSetting("organization_logo");
      if (oldLogoSetting?.value) {
        const oldFilename = oldLogoSetting.value.replace("/api/branding/logo/", "");
        const oldPath = path.join(brandingFolder, oldFilename);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }

      fs.writeFileSync(filepath, req.file.buffer);

      const logoUrl = `/api/branding/logo/${filename}`;
      await storage.setAppSetting("organization_logo", logoUrl);

      res.json({ logoUrl });
    } catch (error) {
      console.error("Error uploading logo:", error);
      res.status(500).json({ error: "Failed to upload logo" });
    }
  });

  app.delete("/api/admin/branding/logo", requireSuperadmin, async (req, res) => {
    try {
      const logoSetting = await storage.getAppSetting("organization_logo");
      if (logoSetting?.value) {
        const filename = logoSetting.value.replace("/api/branding/logo/", "");
        const filepath = path.join(brandingFolder, filename);
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }
      await storage.deleteAppSetting("organization_logo");
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting logo:", error);
      res.status(500).json({ error: "Failed to delete logo" });
    }
  });

  app.patch("/api/admin/branding", requireSuperadmin, async (req, res) => {
    try {
      const { organizationName } = req.body;
      if (organizationName !== undefined) {
        await storage.setAppSetting("organization_name", organizationName || null);
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating branding:", error);
      res.status(500).json({ error: "Failed to update branding" });
    }
  });

  app.get("/api/branding/logo/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      const safeName = path.basename(filename);
      const filepath = path.join(brandingFolder, safeName);

      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: "Logo not found" });
      }

      const ext = path.extname(safeName).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };

      res.setHeader("Content-Type", mimeTypes[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000");
      fs.createReadStream(filepath).pipe(res);
    } catch (error) {
      console.error("Error serving logo:", error);
      res.status(500).json({ error: "Failed to serve logo" });
    }
  });

  // Merge duplicate conversations by phone number
  app.post("/api/admin/merge-duplicates", requireAdmin, async (req, res) => {
    try {
      console.log("Starting duplicate conversation merge...");
      const result = await storage.mergeDuplicateConversations();
      console.log(`Merge complete: ${result.mergedContacts} contacts, ${result.mergedConversations} conversations merged`);
      broadcast({ type: "conversations_merged" });
      res.json(result);
    } catch (error) {
      console.error("Error merging duplicates:", error);
      res.status(500).json({ error: "Failed to merge duplicates" });
    }
  });

  // Manual merge of two specific contacts
  app.post("/api/admin/merge-contacts", requireAdmin, async (req, res) => {
    try {
      const { primaryContactId, duplicateContactId } = req.body;
      
      if (!primaryContactId || !duplicateContactId) {
        return res.status(400).json({ error: "Both primaryContactId and duplicateContactId are required" });
      }
      
      const result = await storage.mergeSpecificContacts(primaryContactId, duplicateContactId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.message });
      }
      
      broadcast({ type: "conversations_merged" });
      res.json(result);
    } catch (error) {
      console.error("Error merging contacts:", error);
      res.status(500).json({ error: "Failed to merge contacts" });
    }
  });

  // ============= SYSTEM UPDATE ROUTES =============
  const GITHUB_REPO_URL = "https://github.com/adhielesmana/omnidesk.git";
  
  // Helper to ensure git repo is initialized
  async function ensureGitRepo(): Promise<void> {
    const cwd = process.cwd();
    try {
      await execAsync("git rev-parse --git-dir", { cwd });
    } catch {
      // No git repo, initialize one
      updateStatus.updateLog.push("Initializing git repository...");
      await execAsync("git init", { cwd });
      await execAsync(`git remote add origin ${GITHUB_REPO_URL}`, { cwd });
      updateStatus.updateLog.push("Git repository initialized");
    }
  }
  
  app.get("/api/admin/update/status", requireSuperadmin, async (req, res) => {
    res.json(updateStatus);
  });

  app.post("/api/admin/update/check", requireSuperadmin, async (req, res) => {
    if (updateStatus.isChecking || updateStatus.isUpdating) {
      return res.status(409).json({ error: "Update operation already in progress" });
    }

    try {
      updateStatus.isChecking = true;
      updateStatus.error = null;
      updateStatus.updateLog = ["Checking git repository..."];

      await ensureGitRepo();
      
      updateStatus.updateLog.push("Fetching updates from remote...");
      await execAsync("git fetch origin", { cwd: process.cwd() });
      updateStatus.updateLog.push("Remote fetched successfully");

      // Check if we have any local commits (fresh repo may not have HEAD)
      let localCommit = "";
      try {
        const { stdout } = await execAsync("git rev-parse HEAD", { cwd: process.cwd() });
        localCommit = stdout.trim();
      } catch {
        // Fresh repo with no commits - update is always available
        localCommit = "";
      }
      
      const { stdout: remoteCommit } = await execAsync("git rev-parse origin/main", { cwd: process.cwd() });

      updateStatus.localCommit = localCommit || "(fresh install)";
      updateStatus.remoteCommit = remoteCommit.trim();
      updateStatus.hasUpdate = localCommit !== remoteCommit.trim();
      updateStatus.lastChecked = new Date();
      updateStatus.isChecking = false;

      if (updateStatus.hasUpdate) {
        if (!localCommit) {
          updateStatus.updateLog.push("Fresh installation detected - ready to pull latest code");
        } else {
          const { stdout: commitLog } = await execAsync(
            `git log --oneline ${localCommit}..${updateStatus.remoteCommit}`,
            { cwd: process.cwd() }
          );
          updateStatus.updateLog.push(`Found ${commitLog.split('\n').filter(Boolean).length} new commits`);
        }
      } else {
        updateStatus.updateLog.push("Already up to date");
      }

      res.json(updateStatus);
    } catch (error) {
      updateStatus.isChecking = false;
      updateStatus.error = error instanceof Error ? error.message : "Failed to check for updates";
      updateStatus.updateLog.push(`Error: ${updateStatus.error}`);
      res.status(500).json({ error: updateStatus.error });
    }
  });

  app.post("/api/admin/update/run", requireSuperadmin, async (req, res) => {
    if (updateStatus.isChecking || updateStatus.isUpdating) {
      return res.status(409).json({ error: "Update operation already in progress" });
    }

    // Skip check requirement - just pull directly
    updateStatus.isUpdating = true;
    updateStatus.error = null;
    updateStatus.updateLog = ["Starting update process..."];

    res.json({ message: "Update started", status: updateStatus });

    try {
      await ensureGitRepo();
      
      // Check if we have any commits (fresh repo)
      let hasPreviousCommits = false;
      try {
        await execAsync("git rev-parse HEAD", { cwd: process.cwd() });
        hasPreviousCommits = true;
      } catch {
        hasPreviousCommits = false;
      }
      
      if (hasPreviousCommits) {
        updateStatus.updateLog.push("Pulling latest changes (git pull)...");
        const { stdout: pullOutput } = await execAsync("git pull origin main", { cwd: process.cwd() });
        updateStatus.updateLog.push(pullOutput.trim());
      } else {
        // Fresh repo - fetch and reset to origin/main
        updateStatus.updateLog.push("Fresh install - fetching from remote...");
        await execAsync("git fetch origin", { cwd: process.cwd() });
        
        // Clean up legacy WhatsApp auth files that conflict with checkout
        // Session data is now stored in database, these are obsolete
        const whatsappAuthPath = path.join(process.cwd(), ".whatsapp-auth");
        if (fs.existsSync(whatsappAuthPath)) {
          updateStatus.updateLog.push("Cleaning up legacy .whatsapp-auth files...");
          fs.rmSync(whatsappAuthPath, { recursive: true, force: true });
        }
        
        // Also clean .dockerignore if it exists and conflicts
        const dockerignorePath = path.join(process.cwd(), ".dockerignore");
        if (fs.existsSync(dockerignorePath)) {
          fs.unlinkSync(dockerignorePath);
        }
        
        await execAsync("git checkout -b main origin/main", { cwd: process.cwd() });
        updateStatus.updateLog.push("Checked out main branch from remote");
      }

      updateStatus.updateLog.push("Running deploy script...");
      
      const deployProcess = spawn("bash", ["./deploy.sh"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      deployProcess.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        updateStatus.updateLog.push(...lines);
      });

      deployProcess.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        updateStatus.updateLog.push(...lines);
      });

      deployProcess.on("close", (code) => {
        updateStatus.isUpdating = false;
        if (code === 0) {
          updateStatus.hasUpdate = false;
          updateStatus.updateLog.push("Deploy completed successfully!");
        } else {
          updateStatus.error = `Deploy failed with exit code ${code}`;
          updateStatus.updateLog.push(updateStatus.error);
        }
      });

      deployProcess.unref();
    } catch (error) {
      updateStatus.isUpdating = false;
      updateStatus.error = error instanceof Error ? error.message : "Update failed";
      updateStatus.updateLog.push(`Error: ${updateStatus.error}`);
    }
  });

  // Get departments for current user
  app.get("/api/departments", requireAuth, async (req, res) => {
    try {
      if (!req.session.user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (req.session.user.role === "superadmin") {
        const departments = await storage.getAllDepartments();
        return res.json(departments);
      }

      const departments = await storage.getUserDepartments(req.session.userId!);
      res.json(departments);
    } catch (error) {
      console.error("Error fetching user departments:", error);
      res.status(500).json({ error: "Failed to fetch departments" });
    }
  });

  // ============= CONVERSATION ROUTES =============
  // Get all conversations (filtered by user's departments)
  app.get("/api/conversations", requireAuth, async (req, res) => {
    try {
      let departmentFilter: string[] | undefined;
      
      const userRole = req.session.user?.role;
      console.log(`Fetching conversations for user ${req.session.userId} with role ${userRole}`);

      // Superadmin and admin can see all conversations, regular users only see their department's
      if (userRole !== "superadmin" && userRole !== "admin") {
        const userDepartmentIds = await getUserDepartmentIds(req.session.userId!, userRole!);
        if (userDepartmentIds !== "all") {
          departmentFilter = userDepartmentIds;
        }
        console.log(`User ${req.session.userId} has departments: ${JSON.stringify(departmentFilter)}`);
      } else {
        console.log(`User ${req.session.userId} is ${userRole}, showing all conversations`);
      }

      const conversations = await storage.getConversations(departmentFilter);
      console.log(`Returning ${conversations.length} conversations`);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", async (req, res) => {
    try {
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      // Mark as read when fetching conversation
      if (conversation.unreadCount && conversation.unreadCount > 0) {
        await storage.markConversationAsRead(req.params.id);
        broadcast({ type: "conversation_updated", conversationId: req.params.id });
      }
      
      res.json(conversation);
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Mark conversation as read
  app.post("/api/conversations/:id/read", async (req, res) => {
    try {
      await storage.markConversationAsRead(req.params.id);
      broadcast({ type: "conversation_updated", conversationId: req.params.id });
      res.json({ success: true });
    } catch (error) {
      console.error("Error marking conversation as read:", error);
      res.status(500).json({ error: "Failed to mark conversation as read" });
    }
  });

  // Get older messages for pagination (load more)
  app.get("/api/conversations/:id/older-messages", async (req, res) => {
    try {
      const { before, beforeId, limit } = req.query;
      
      if (!before || !beforeId) {
        return res.status(400).json({ error: "Missing 'before' timestamp or 'beforeId' parameter" });
      }

      const beforeTimestamp = new Date(before as string);
      const messageLimit = limit ? parseInt(limit as string) : 50;

      if (isNaN(beforeTimestamp.getTime())) {
        return res.status(400).json({ error: "Invalid 'before' timestamp" });
      }

      const result = await storage.getOlderMessages(
        req.params.id, 
        beforeTimestamp, 
        beforeId as string,
        messageLimit
      );

      res.json(result);
    } catch (error) {
      console.error("Error fetching older messages:", error);
      res.status(500).json({ error: "Failed to fetch older messages" });
    }
  });

  // Update conversation (archive, pin, etc.)
  app.patch("/api/conversations/:id", async (req, res) => {
    try {
      const updated = await storage.updateConversation(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ error: "Failed to update conversation" });
    }
  });

  // Send a message
  app.post("/api/conversations/:id/messages", async (req, res) => {
    try {
      const { content, mediaUrl } = req.body;
      const conversationId = req.params.id;

      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      let result: { success: boolean; messageId: string | undefined } = { success: false, messageId: undefined };

      // Route message based on conversation platform - NEVER fall back to a different platform
      if (conversation.platform === "whatsapp") {
        // Try Twilio first (official API), then fall back to Baileys (unofficial)
        const { isTwilioConfigured, sendWhatsAppMessage: twilioSend } = await import("./twilio");
        const twilioAvailable = await isTwilioConfigured();
        
        if (twilioAvailable) {
          // Use Twilio WhatsApp API
          console.log("[Message] Using Twilio for WhatsApp message");
          const phoneNumber = conversation.contact.phoneNumber || conversation.contact.platformId;
          const twilioResult = await twilioSend(phoneNumber, content, mediaUrl);
          result = { success: twilioResult.success, messageId: twilioResult.messageId };
          
          if (!twilioResult.success) {
            console.error("[Twilio] Send failed:", twilioResult.error);
            return res.status(400).json({ error: twilioResult.error || "Failed to send via Twilio" });
          }
        } else if (whatsappService.isConnected()) {
          // Fall back to unofficial WhatsApp (Baileys)
          console.log("[Message] Using Baileys for WhatsApp message");
          const waResult = await whatsappService.sendMessage(
            conversation.contact.platformId,
            content
          );
          
          // Check for rate limiting
          if (waResult.rateLimited) {
            return res.status(429).json({ 
              error: "Message sending rate limited. Please wait before sending more messages.",
              retryAfterMs: waResult.waitMs
            });
          }
          
          result = { success: waResult.success, messageId: waResult.messageId || undefined };
        } else {
          return res.status(400).json({ 
            error: "WhatsApp is not connected. Please configure Twilio or scan the QR code for Baileys." 
          });
        }
      } else if (conversation.platform === "instagram" || conversation.platform === "facebook") {
        // Use Meta API for Instagram/Facebook - MUST use correct platform settings
        let settings = await storage.getPlatformSetting(conversation.platform);
        
        // For Instagram: Fall back to Facebook settings ONLY if they share the same Page access token
        // This is valid because Instagram Business accounts are linked to Facebook Pages
        if (!settings?.accessToken && conversation.platform === "instagram") {
          console.log("Instagram settings not found, checking Facebook settings for shared Page token");
          settings = await storage.getPlatformSetting("facebook");
        }
        
        if (!settings?.accessToken) {
          return res.status(400).json({ 
            error: `${conversation.platform.charAt(0).toUpperCase() + conversation.platform.slice(1)} is not configured. Please set up the platform in Admin Panel > Platforms.` 
          });
        }
        
        if (!settings.isConnected) {
          return res.status(400).json({ 
            error: `${conversation.platform.charAt(0).toUpperCase() + conversation.platform.slice(1)} is not connected. Please test the connection in Admin Panel > Platforms.` 
          });
        }
        
        // Create Meta API service with the CORRECT platform to ensure proper routing
        const metaApi = new MetaApiService(conversation.platform, {
          accessToken: settings.accessToken,
          phoneNumberId: settings.phoneNumberId || undefined,
          pageId: settings.pageId || undefined,
          businessId: settings.businessId || undefined,
        });
        
        console.log(`[Meta API] Sending ${conversation.platform} message to recipient: ${conversation.contact.platformId}, pageId: ${settings.pageId}, businessId: ${settings.businessId}`);
        const metaResult = await metaApi.sendMessage(conversation.contact.platformId, content);
        result = { success: metaResult.success, messageId: metaResult.messageId };
        
        if (!metaResult.success) {
          console.error(`[Meta API] Failed to send ${conversation.platform} message to ${conversation.contact.platformId}:`, metaResult.error);
          return res.status(400).json({ error: metaResult.error || "Failed to send message" });
        }
      } else {
        return res.status(400).json({ error: `Unsupported platform: ${conversation.platform}` });
      }

      // Create message in database
      const message = await storage.createMessage({
        conversationId,
        externalId: result.messageId || undefined,
        direction: "outbound",
        content,
        mediaUrl,
        status: result.success ? "sent" : "failed",
        timestamp: new Date(),
      });

      broadcast({ type: "new_message", message, conversationId });
      res.json(message);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Get platform settings (requires auth)
  app.get("/api/platform-settings", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getPlatformSettings();
      // Don't expose access tokens
      const sanitized = settings.map((s) => ({
        ...s,
        accessToken: s.accessToken ? "********" : null,
      }));
      res.json(sanitized);
    } catch (error) {
      console.error("Error fetching platform settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Save platform settings (requires admin)
  app.post("/api/platform-settings/:platform", requireAdmin, async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      if (!["whatsapp", "instagram", "facebook"].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const { accessToken, pageId, phoneNumberId, businessId, webhookVerifyToken } = req.body;

      // Get existing settings to check if we need a new token
      const existingSettings = await storage.getPlatformSetting(platform);
      
      // Require access token if no existing token
      if (!accessToken && !existingSettings?.accessToken) {
        return res.status(400).json({ error: "Access token is required" });
      }

      if (platform === "facebook" && !pageId) {
        return res.status(400).json({ error: "Page ID is required for Facebook" });
      }

      if (platform === "instagram" && !businessId) {
        return res.status(400).json({ error: "Business ID is required for Instagram" });
      }
      
      if (platform === "whatsapp" && !phoneNumberId && !existingSettings?.phoneNumberId) {
        return res.status(400).json({ error: "Phone Number ID is required for WhatsApp Business API" });
      }

      // Use new token if provided, otherwise keep existing
      const finalAccessToken = accessToken || existingSettings?.accessToken;
      const finalPhoneNumberId = phoneNumberId || existingSettings?.phoneNumberId;

      const settings = await storage.upsertPlatformSettings({
        platform,
        accessToken: finalAccessToken,
        pageId: pageId || null,
        phoneNumberId: finalPhoneNumberId || null,
        businessId: businessId || null,
        webhookVerifyToken: webhookVerifyToken || null,
        isConnected: false,
      });

      res.json({
        ...settings,
        accessToken: settings.accessToken ? "********" : null,
      });
    } catch (error) {
      console.error("Error saving platform settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Test platform connection (requires admin)
  app.post("/api/platform-settings/:platform/test", requireAdmin, async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      if (!["whatsapp", "instagram", "facebook"].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const settings = await storage.getPlatformSetting(platform);
      if (!settings || !settings.accessToken) {
        return res.status(400).json({ error: "Platform not configured" });
      }
      
      // For WhatsApp Business API, also check phoneNumberId
      if (platform === "whatsapp" && !settings.phoneNumberId) {
        return res.status(400).json({ error: "Phone Number ID is required for WhatsApp Business API" });
      }

      const metaApi = new MetaApiService(platform, {
        accessToken: settings.accessToken,
        phoneNumberId: settings.phoneNumberId || undefined,
        pageId: settings.pageId || undefined,
        businessId: settings.businessId || undefined,
      });

      const result = await metaApi.testConnection();

      if (result.success) {
        await storage.upsertPlatformSettings({
          ...settings,
          isConnected: true,
          lastSyncAt: new Date(),
        });
      }

      res.json(result);
    } catch (error) {
      console.error("Error testing connection:", error);
      res.status(500).json({ success: false, error: "Connection test failed" });
    }
  });

  // Disconnect platform (requires admin)
  app.post("/api/platform-settings/:platform/disconnect", requireAdmin, async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      if (!["instagram", "facebook"].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const settings = await storage.getPlatformSetting(platform);
      if (settings) {
        await storage.upsertPlatformSettings({
          ...settings,
          accessToken: null,
          isConnected: false,
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting platform:", error);
      res.status(500).json({ error: "Failed to disconnect platform" });
    }
  });

  // Sync Facebook/Instagram conversations (fetch previous messages)
  app.post("/api/platform-settings/:platform/sync", requireAdmin, async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      if (!["instagram", "facebook"].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const settings = await storage.getPlatformSetting(platform);
      if (!settings || !settings.accessToken) {
        return res.status(400).json({ error: "Platform not configured" });
      }

      const metaApi = new MetaApiService(platform, {
        accessToken: settings.accessToken,
        pageId: settings.pageId || undefined,
        businessId: settings.businessId || undefined,
      });

      console.log(`Starting ${platform} message sync...`);
      const { conversations, error } = await metaApi.fetchConversations(50);

      if (error) {
        console.error(`${platform} sync error:`, error);
        return res.status(400).json({ error });
      }

      let syncedConversations = 0;
      let syncedMessages = 0;
      const pageId = settings.pageId || settings.businessId;

      for (const conv of conversations) {
        // Find the customer participant (not the page)
        const customerParticipant = conv.participants?.data?.find(
          (p: any) => p.id !== pageId
        );

        if (!customerParticipant) continue;

        // Find or create contact
        let contact = await storage.getContactByPlatformId(customerParticipant.id, platform);
        
        if (!contact) {
          // Try to get profile info
          const profile = await metaApi.getUserProfile(customerParticipant.id);
          
          contact = await storage.createContact({
            platformId: customerParticipant.id,
            platform,
            name: profile?.name || customerParticipant.name || customerParticipant.email,
            profilePictureUrl: profile?.profilePicture,
          });
        }

        // Find or create conversation
        let conversation = await storage.getConversationByContactId(contact.id);
        
        if (!conversation) {
          conversation = await storage.createConversation({
            contactId: contact.id,
            platform,
            unreadCount: 0,
          });
          syncedConversations++;
        }

        // Process messages
        const messages = conv.messages?.data || [];
        for (const msg of messages) {
          if (!msg.message && !msg.attachments) continue;

          // Check if message already exists
          const existingMsg = await storage.getMessageByExternalId(msg.id);
          if (existingMsg) continue;

          // Determine direction (from page = outbound, from customer = inbound)
          const isFromPage = msg.from?.id === pageId;
          
          await storage.createMessage({
            conversationId: conversation.id,
            externalId: msg.id,
            direction: isFromPage ? "outbound" : "inbound",
            content: msg.message,
            status: "delivered",
            timestamp: new Date(msg.created_time),
          });
          syncedMessages++;
        }

        // Update conversation's last message
        if (messages.length > 0) {
          const latestMsg = messages[0];
          await storage.updateConversation(conversation.id, {
            lastMessageAt: new Date(latestMsg.created_time),
            lastMessagePreview: latestMsg.message?.slice(0, 100),
          });
        }
      }

      // Update last sync time
      await storage.upsertPlatformSettings({
        ...settings,
        lastSyncAt: new Date(),
      });

      console.log(`${platform} sync complete: ${syncedConversations} conversations, ${syncedMessages} messages`);
      
      res.json({ 
        success: true, 
        syncedConversations, 
        syncedMessages,
        totalConversations: conversations.length,
      });
    } catch (error) {
      console.error("Error syncing platform:", error);
      res.status(500).json({ error: "Failed to sync messages" });
    }
  });

  // ============= OPENAI SETTINGS ROUTES =============
  
  // Get OpenAI API key status
  app.get("/api/settings/openai", requireAdmin, async (req, res) => {
    try {
      const setting = await storage.getAppSetting("openai_api_key");
      const envKeyExists = !!process.env.OPENAI_API_KEY;
      
      res.json({
        hasKey: !!setting?.value || envKeyExists,
        isCustomKey: !!setting?.value,
        isValid: setting?.isValid ?? null,
        lastValidatedAt: setting?.lastValidatedAt ?? null,
      });
    } catch (error) {
      console.error("Error getting OpenAI settings:", error);
      res.status(500).json({ error: "Failed to get OpenAI settings" });
    }
  });

  // Save OpenAI API key
  app.post("/api/settings/openai", requireAdmin, async (req, res) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).json({ error: "API key is required" });
      }

      // Validate the key by making a test call to OpenAI
      const isValid = await validateOpenAIKey(apiKey);
      
      await storage.setAppSetting("openai_api_key", apiKey, isValid);

      res.json({
        hasKey: true,
        isCustomKey: true,
        isValid,
        lastValidatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error saving OpenAI key:", error);
      res.status(500).json({ error: "Failed to save OpenAI key" });
    }
  });

  // Delete OpenAI API key (revert to env variable)
  app.delete("/api/settings/openai", requireAdmin, async (req, res) => {
    try {
      await storage.deleteAppSetting("openai_api_key");
      const envKeyExists = !!process.env.OPENAI_API_KEY;
      
      res.json({
        hasKey: envKeyExists,
        isCustomKey: false,
        isValid: null,
        lastValidatedAt: null,
      });
    } catch (error) {
      console.error("Error deleting OpenAI key:", error);
      res.status(500).json({ error: "Failed to delete OpenAI key" });
    }
  });

  // Validate current OpenAI API key
  app.post("/api/settings/openai/validate", requireAdmin, async (req, res) => {
    try {
      const setting = await storage.getAppSetting("openai_api_key");
      const keyToValidate = setting?.value || process.env.OPENAI_API_KEY;

      if (!keyToValidate) {
        return res.json({ isValid: false, error: "No API key configured" });
      }

      const isValid = await validateOpenAIKey(keyToValidate);
      
      if (setting?.value) {
        await storage.setAppSetting("openai_api_key", setting.value, isValid);
      }

      res.json({
        isValid,
        lastValidatedAt: new Date(),
      });
    } catch (error) {
      console.error("Error validating OpenAI key:", error);
      res.status(500).json({ error: "Failed to validate OpenAI key" });
    }
  });

  // Webhook verification (GET request from Meta)
  app.get("/api/webhook/:platform", async (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const platform = req.params.platform as Platform;
    
    // Get verify token from database or environment
    let verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;
    
    if (["instagram", "facebook"].includes(platform)) {
      const settings = await storage.getPlatformSetting(platform);
      if (settings?.webhookVerifyToken) {
        verifyToken = settings.webhookVerifyToken;
      }
    }

    if (mode === "subscribe" && token === verifyToken) {
      console.log(`${platform} webhook verified`);
      res.status(200).send(challenge);
    } else {
      console.log(`${platform} webhook verification failed. Expected: ${verifyToken}, Got: ${token}`);
      res.sendStatus(403);
    }
  });

  // Webhook handler (POST request from Meta)
  app.post("/api/webhook/:platform", async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      let webhookMessage: WebhookMessage | null = null;

      switch (platform) {
        case "whatsapp":
          webhookMessage = MetaApiService.parseWhatsAppWebhook(req.body);
          break;
        case "instagram":
          webhookMessage = MetaApiService.parseInstagramWebhook(req.body);
          break;
        case "facebook":
          webhookMessage = MetaApiService.parseFacebookWebhook(req.body);
          break;
      }

      if (webhookMessage) {
        // For echo messages (sent by page/auto-reply), the recipient is the customer
        // For regular messages, the sender is the customer
        const isEcho = webhookMessage.isEcho === true;
        const customerId = isEcho ? webhookMessage.recipientId : webhookMessage.senderId;
        
        if (!customerId) {
          console.log("No customer ID found in webhook message, skipping");
          res.sendStatus(200);
          return;
        }

        // Find or create contact
        let contact = await storage.getContactByPlatformId(
          customerId,
          webhookMessage.platform
        );

        if (!contact) {
          let name = isEcho ? undefined : webhookMessage.senderName;
          let profilePictureUrl: string | undefined;
          
          // Try to fetch profile info from Meta for Facebook/Instagram
          if (["facebook", "instagram"].includes(webhookMessage.platform)) {
            const settings = await storage.getPlatformSetting(webhookMessage.platform);
            if (settings?.accessToken) {
              const metaApi = new MetaApiService(webhookMessage.platform, {
                accessToken: settings.accessToken,
                pageId: settings.pageId || undefined,
                businessId: settings.businessId || undefined,
              });
              const profile = await metaApi.getUserProfile(customerId);
              if (profile) {
                name = profile.name || name;
                profilePictureUrl = profile.profilePicture;
              }
            }
          }
          
          contact = await storage.createContact({
            platformId: customerId,
            platform: webhookMessage.platform,
            name,
            profilePictureUrl,
          });
        }

        // Find or create conversation
        let conversation = await storage.getConversationByContactId(contact.id);

        if (!conversation) {
          conversation = await storage.createConversation({
            contactId: contact.id,
            platform: webhookMessage.platform,
            unreadCount: isEcho ? 0 : 1,
          });
        } else if (!isEcho) {
          // Only increment unread count for incoming messages, not echo/auto-reply
          await storage.updateConversation(conversation.id, {
            unreadCount: (conversation.unreadCount || 0) + 1,
          });
        }

        // Create message - echo messages are outbound, regular messages are inbound
        const message = await storage.createMessage({
          conversationId: conversation.id,
          externalId: webhookMessage.externalId,
          direction: isEcho ? "outbound" : "inbound",
          content: webhookMessage.content,
          mediaUrl: webhookMessage.mediaUrl,
          mediaType: webhookMessage.mediaType,
          status: "delivered",
          timestamp: webhookMessage.timestamp,
        });

        // Broadcast to connected clients
        broadcast({
          type: "new_message",
          message,
          conversationId: conversation.id,
        });

        broadcast({
          type: "conversation_updated",
          conversationId: conversation.id,
        });

        // Handle auto-reply for Facebook and Instagram (not for echo messages)
        if (!isEcho && webhookMessage.content && ["facebook", "instagram"].includes(webhookMessage.platform)) {
          let settings = await storage.getPlatformSetting(webhookMessage.platform);
          
          // Fallback: If Instagram settings not found, try using Facebook settings
          if (!settings?.accessToken && webhookMessage.platform === "instagram") {
            console.log("Instagram settings not found for auto-reply, falling back to Facebook settings");
            settings = await storage.getPlatformSetting("facebook");
          }
          
          if (settings?.accessToken) {
            const metaApi = new MetaApiService(webhookMessage.platform, {
              accessToken: settings.accessToken,
              pageId: settings.pageId || undefined,
              businessId: settings.businessId || undefined,
            });
            
            // Create a send function for this platform
            const sendMetaMessage = async (recipientId: string, messageContent: string) => {
              const result = await metaApi.sendMessage(recipientId, messageContent);
              if (!result.success) {
                throw new Error(result.error || "Failed to send message");
              }
            };
            
            // Trigger auto-reply (runs in background, don't await to not block webhook response)
            handleAutoReply(
              conversation,
              contact,
              webhookMessage.content,
              sendMetaMessage,
              webhookMessage.platform
            ).catch((err) => {
              console.error(`Auto-reply error for ${webhookMessage.platform}:`, err);
            });
          }
        }
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("Webhook error:", error);
      res.sendStatus(200); // Always return 200 to acknowledge receipt
    }
  });

  // Contact management endpoints
  app.get("/api/contacts", requireAuth, async (req, res) => {
    try {
      const { search, platform, isFavorite, isBlocked, tag, sortBy, sortOrder, limit, offset } = req.query;
      
      const result = await storage.getAllContacts({
        search: search as string | undefined,
        platform: platform as Platform | undefined,
        isFavorite: isFavorite === "true" ? true : isFavorite === "false" ? false : undefined,
        isBlocked: isBlocked === "true" ? true : isBlocked === "false" ? false : undefined,
        tag: tag as string | undefined,
        sortBy: sortBy as "name" | "lastContacted" | "createdAt" | undefined,
        sortOrder: sortOrder as "asc" | "desc" | undefined,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
      });
      
      res.json(result);
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.get("/api/contacts/tags", requireAuth, async (req, res) => {
    try {
      const tags = await storage.getAllTags();
      res.json(tags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  app.post("/api/contacts/import", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { nameColumn, phoneColumn, emailColumn, notesColumn, defaultPlatform, defaultTag } = req.body;
      
      if (!phoneColumn) {
        return res.status(400).json({ error: "Phone column is required" });
      }
      
      const csvContent = req.file.buffer.toString("utf-8");
      
      const parseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim(),
      });

      if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
        return res.status(400).json({ 
          error: "Failed to parse CSV", 
          details: parseResult.errors.slice(0, 5) 
        });
      }

      const rows = parseResult.data as Record<string, string>[];
      const headers = parseResult.meta.fields || [];
      
      if (rows.length === 0) {
        return res.status(400).json({ error: "CSV file is empty" });
      }

      const results = {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [] as { row: number; reason: string }[],
      };

      const platform = (defaultPlatform || "whatsapp") as Platform;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const name = nameColumn ? row[nameColumn]?.trim() : null;
          const rawPhone = phoneColumn ? row[phoneColumn]?.trim() : null;
          const email = emailColumn ? row[emailColumn]?.trim() : null;
          const notes = notesColumn ? row[notesColumn]?.trim() : null;

          if (!rawPhone) {
            results.skipped++;
            results.errors.push({ row: i + 2, reason: "Missing phone number" });
            continue;
          }

          const { digits: phoneDigits, formatted: normalizedPhone } = normalizePhoneNumber(rawPhone);
          
          if (phoneDigits.length < 8) {
            results.skipped++;
            results.errors.push({ row: i + 2, reason: "Invalid phone number (too short)" });
            continue;
          }
          if (phoneDigits.length > 15) {
            results.skipped++;
            results.errors.push({ row: i + 2, reason: "Invalid phone number (too long)" });
            continue;
          }

          let existingContact = await storage.getContactByPhoneNumber(phoneDigits);
          
          if (existingContact) {
            const updates: Partial<Contact> = {};
            if (name && !existingContact.name) updates.name = name;
            if (email && !existingContact.email) updates.email = email;
            if (notes && !existingContact.notes) updates.notes = notes;
            
            if (defaultTag && existingContact.tags) {
              const existingTags = existingContact.tags as string[];
              if (!existingTags.includes(defaultTag)) {
                updates.tags = [...existingTags, defaultTag];
              }
            } else if (defaultTag) {
              updates.tags = [defaultTag];
            }
            
            if (Object.keys(updates).length > 0) {
              await storage.updateContact(existingContact.id, updates);
              results.updated++;
            } else {
              results.skipped++;
            }
          } else {
            await storage.createContact({
              platformId: phoneDigits,
              platform,
              name: name || normalizedPhone,
              phoneNumber: normalizedPhone,
              email: email || null,
              notes: notes || null,
              tags: defaultTag ? [defaultTag] : null,
            });
            results.created++;
          }
        } catch (rowError) {
          results.skipped++;
          results.errors.push({ row: i + 2, reason: "Processing error" });
        }
      }

      res.json({
        success: true,
        headers,
        totalRows: rows.length,
        ...results,
      });
    } catch (error) {
      console.error("Error importing contacts:", error);
      res.status(500).json({ error: "Failed to import contacts" });
    }
  });

  app.post("/api/contacts/import/preview", requireAuth, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const useAI = req.body?.useAI === "true" || req.body?.useAI === true;
      const csvContent = req.file.buffer.toString("utf-8");
      
      // First parse: get total row count
      const fullParseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim(),
      });
      
      const totalRows = fullParseResult.data.length;
      
      // Second parse: get preview rows only (for faster response)
      const parseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        preview: 5,
        transformHeader: (h: string) => h.trim(),
      });

      if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
        return res.status(400).json({ 
          error: "Failed to parse CSV", 
          details: parseResult.errors.slice(0, 5) 
        });
      }

      const headers = parseResult.meta.fields || [];
      const previewRows = parseResult.data as Record<string, string>[];

      let suggestedMapping: {
        nameColumn: string | null;
        phoneColumn: string | null;
        emailColumn?: string | null;
        notesColumn?: string | null;
      };
      let aiDetection = null;

      if (useAI) {
        try {
          const aiResult = await detectCSVColumnsWithAI(headers, previewRows);
          suggestedMapping = {
            nameColumn: aiResult.nameColumn,
            phoneColumn: aiResult.phoneColumn,
          };
          aiDetection = {
            used: true,
            confidence: aiResult.confidence,
          };
        } catch (aiError) {
          console.error("AI detection failed, falling back to regex:", aiError);
          suggestedMapping = {
            nameColumn: headers.find(h => /^(name|nama|contact|full\s*name)$/i.test(h)) || null,
            phoneColumn: headers.find(h => /^(phone|hp|mobile|telepon|nomor|number|wa|whatsapp|tel)$/i.test(h)) || null,
          };
          aiDetection = {
            used: false,
            error: aiError instanceof Error ? aiError.message : "AI detection failed",
          };
        }
      } else {
        suggestedMapping = {
          nameColumn: headers.find(h => /^(name|nama|contact|full\s*name)$/i.test(h)) || null,
          phoneColumn: headers.find(h => /^(phone|hp|mobile|telepon|nomor|number|wa|whatsapp|tel)$/i.test(h)) || null,
          emailColumn: headers.find(h => /^(email|e-mail|mail)$/i.test(h)) || null,
          notesColumn: headers.find(h => /^(notes?|catatan|keterangan|description|desc)$/i.test(h)) || null,
        };
      }

      res.json({
        headers,
        previewRows,
        suggestedMapping,
        totalRows,
        aiDetection,
      });
    } catch (error) {
      console.error("Error previewing CSV:", error);
      res.status(500).json({ error: "Failed to preview CSV" });
    }
  });

  app.get("/api/contacts/:id", requireAuth, async (req, res) => {
    try {
      const contact = await storage.getContact(req.params.id);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(contact);
    } catch (error) {
      console.error("Error fetching contact:", error);
      res.status(500).json({ error: "Failed to fetch contact" });
    }
  });

  app.patch("/api/contacts/:id", requireAuth, async (req, res) => {
    try {
      const parseResult = updateContactSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid contact data", 
          details: parseResult.error.flatten() 
        });
      }
      
      const updated = await storage.updateContact(req.params.id, parseResult.data);
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating contact:", error);
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.get("/api/contacts/:id/conversations", requireAuth, async (req, res) => {
    try {
      const conversations = await storage.getConversationsByContactId(req.params.id);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching contact conversations:", error);
      res.status(500).json({ error: "Failed to fetch contact conversations" });
    }
  });

  app.delete("/api/contacts/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteContact(req.params.id);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting contact:", error);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.post("/api/contacts/:id/favorite", requireAuth, async (req, res) => {
    try {
      const updated = await storage.toggleFavorite(req.params.id);
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error toggling favorite:", error);
      res.status(500).json({ error: "Failed to toggle favorite" });
    }
  });

  app.post("/api/contacts/:id/block", requireAuth, async (req, res) => {
    try {
      const updated = await storage.toggleBlocked(req.params.id);
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error toggling block:", error);
      res.status(500).json({ error: "Failed to toggle block" });
    }
  });

  const tagSchema = z.object({ tag: z.string().min(1, "Tag cannot be empty") });

  app.post("/api/contacts/:id/tags", requireAuth, async (req, res) => {
    try {
      const parseResult = tagSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid tag data", 
          details: parseResult.error.flatten() 
        });
      }
      
      const updated = await storage.addTagToContact(req.params.id, parseResult.data.tag);
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error adding tag:", error);
      res.status(500).json({ error: "Failed to add tag" });
    }
  });

  app.delete("/api/contacts/:id/tags/:tag", requireAuth, async (req, res) => {
    try {
      const updated = await storage.removeTagFromContact(req.params.id, req.params.tag);
      if (!updated) {
        return res.status(404).json({ error: "Contact not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error removing tag:", error);
      res.status(500).json({ error: "Failed to remove tag" });
    }
  });

  // Fetch and update profile picture for a contact
  app.post("/api/contacts/:id/profile-picture", requireAuth, async (req, res) => {
    try {
      const contact = await storage.getContact(req.params.id);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      let profilePictureUrl: string | null = null;

      // Fetch profile picture based on platform
      if (contact.platform === "whatsapp" && whatsappService.isConnected()) {
        profilePictureUrl = await whatsappService.getProfilePicture(contact.platformId);
      }

      if (profilePictureUrl) {
        const updated = await storage.updateContact(req.params.id, { profilePictureUrl });
        res.json(updated);
      } else {
        res.json({ message: "No profile picture available", contact });
      }
    } catch (error) {
      console.error("Error fetching profile picture:", error);
      res.status(500).json({ error: "Failed to fetch profile picture" });
    }
  });

  // Quick replies
  app.get("/api/quick-replies", async (req, res) => {
    try {
      const replies = await storage.getQuickReplies();
      res.json(replies);
    } catch (error) {
      console.error("Error fetching quick replies:", error);
      res.status(500).json({ error: "Failed to fetch quick replies" });
    }
  });

  app.post("/api/quick-replies", async (req, res) => {
    try {
      const reply = await storage.createQuickReply(req.body);
      res.json(reply);
    } catch (error) {
      console.error("Error creating quick reply:", error);
      res.status(500).json({ error: "Failed to create quick reply" });
    }
  });

  app.delete("/api/quick-replies/:id", async (req, res) => {
    try {
      await storage.deleteQuickReply(req.params.id);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting quick reply:", error);
      res.status(500).json({ error: "Failed to delete quick reply" });
    }
  });

  // Auto-reply settings endpoints
  app.get("/api/autoreply/settings", requireAuth, async (req, res) => {
    try {
      const enabled = await isAutoReplyEnabled();
      const prompt = await getAutoReplyPrompt();
      res.json({ enabled, prompt });
    } catch (error) {
      console.error("Error fetching auto-reply settings:", error);
      res.status(500).json({ error: "Failed to fetch auto-reply settings" });
    }
  });

  app.post("/api/autoreply/settings", requireAdmin, async (req, res) => {
    try {
      const { enabled, prompt } = req.body;
      
      // Validate and save prompt first
      if (typeof prompt === "string") {
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt === "") {
          await deleteAutoReplyPrompt();
        } else if (trimmedPrompt.length > 5000) {
          return res.status(400).json({ error: "Prompt must be less than 5000 characters" });
        } else {
          await setAutoReplyPrompt(trimmedPrompt);
        }
      }
      
      // Validate before enabling
      if (typeof enabled === "boolean" && enabled) {
        // Check if prompt exists
        const currentPrompt = await getAutoReplyPrompt();
        if (!currentPrompt || currentPrompt.trim() === "") {
          return res.status(400).json({ error: "Please configure a prompt before enabling auto-reply" });
        }
        
        // Check if OpenAI key exists
        const hasKey = await hasValidOpenAIKey();
        if (!hasKey) {
          return res.status(400).json({ error: "Please configure a valid OpenAI API key before enabling auto-reply" });
        }
        
        await setAutoReplyEnabled(true);
      } else if (typeof enabled === "boolean" && !enabled) {
        await setAutoReplyEnabled(false);
      }
      
      const updatedEnabled = await isAutoReplyEnabled();
      const updatedPrompt = await getAutoReplyPrompt();
      res.json({ enabled: updatedEnabled, prompt: updatedPrompt });
    } catch (error) {
      console.error("Error updating auto-reply settings:", error);
      res.status(500).json({ error: "Failed to update auto-reply settings" });
    }
  });

  // WhatsApp Web connection endpoints
  let currentQR: string | null = null;

  whatsappService.setEventHandlers({
    onQR: (qrDataUrl) => {
      currentQR = qrDataUrl;
      broadcast({ type: "whatsapp_qr", qr: qrDataUrl });
    },
    onConnectionUpdate: (state) => {
      if (state !== "qr") {
        currentQR = null;
      }
      broadcast({ type: "whatsapp_status", status: state });
    },
    onMessage: async (msg) => {
      try {
        // Skip group messages for now
        if (msg.isGroup) return;

        const normalizedId = normalizeWhatsAppJid(msg.from);
        const isLid = isWhatsAppLid(normalizedId);
        
        // Skip messages where the remoteJid is our own WhatsApp number
        // This prevents creating a contact/conversation for ourselves
        const myJid = whatsappService.getMyJid();
        if (myJid && normalizedId === myJid) {
          console.log("Skipping message to/from own WhatsApp number");
          return;
        }
        
        // Normalize alternate ID if provided
        const alternateId = msg.alternateId ? normalizeWhatsAppJid(msg.alternateId) : undefined;
        
        // Use the enhanced contact lookup that can merge duplicates
        let contact = await storage.findOrMergeWhatsAppContact(normalizedId, alternateId);
        
        if (!contact) {
          // For outbound messages (isFromMe), msg.fromName is OUR name, not the recipient's
          // Use phone number as default name for outbound messages to unknown contacts
          const contactName = msg.isFromMe 
            ? (isLid ? normalizedId : `+${normalizedId}`)
            : msg.fromName;
          
          // Determine which ID is LID and which is phone
          const altIsLid = alternateId ? alternateId.length >= 15 : false;
          
          // Create new contact with both identifiers if available
          contact = await storage.createContact({
            platformId: normalizedId,
            platform: "whatsapp",
            name: contactName,
            phoneNumber: isLid ? (alternateId && !altIsLid ? `+${alternateId}` : undefined) : `+${normalizedId}`,
            whatsappLid: isLid ? normalizedId : (alternateId && altIsLid ? alternateId : undefined),
          });
        }

        let conversation = await storage.getConversationByContactId(contact.id);
        if (!conversation) {
          conversation = await storage.createConversation({
            contactId: contact.id,
            platform: "whatsapp",
            lastMessageAt: msg.timestamp,
            lastMessagePreview: msg.content.slice(0, 100),
            unreadCount: msg.isFromMe ? 0 : 1,
          });
        }

        // Check if message already exists (avoid duplicates)
        if (await storage.messageExistsByExternalId(msg.messageId)) return;

        const message = await storage.createMessage({
          conversationId: conversation.id,
          externalId: msg.messageId,
          direction: msg.isFromMe ? "outbound" : "inbound",
          content: msg.content,
          mediaUrl: msg.mediaUrl || null,
          mediaType: msg.mediaType || null,
          metadata: msg.metadata || null,
          status: msg.isFromMe ? "sent" : "delivered",
          timestamp: msg.timestamp,
        });

        broadcast({
          type: "new_message",
          message,
          conversationId: conversation.id,
        });

        broadcast({
          type: "conversation_updated",
          conversationId: conversation.id,
        });

        // Handle auto-reply for new conversations (last message > 24h ago)
        if (!msg.isFromMe) {
          handleAutoReply(
            conversation,
            contact,
            msg.content,
            (jid, text) => whatsappService.sendMessage(jid, text),
            "whatsapp"
          ).catch(err => console.error("Auto-reply error:", err));
        }
      } catch (error) {
        console.error("Error processing WhatsApp message:", error);
      }
    },
    onMessageSent: async (messageId, status) => {
      try {
        await storage.updateMessageStatusByExternalId(messageId, status);
        broadcast({ type: "message_status", messageId, status });
      } catch (error) {
        console.error("Error updating message status:", error);
      }
    },
    onChatsSync: async (chats) => {
      console.log(`Syncing ${chats.length} WhatsApp chats...`);
      const myJid = whatsappService.getMyJid();
      
      for (const chat of chats) {
        try {
          const phoneNumber = chat.jid.replace("@s.whatsapp.net", "").replace("@lid", "");
          const isLid = isWhatsAppLid(phoneNumber);
          
          // Skip our own WhatsApp number
          if (myJid && phoneNumber === myJid) {
            console.log("Skipping sync of own WhatsApp number");
            continue;
          }
          
          // First try to find existing contact by phone number or LID
          let contact = await storage.getContactByPhoneNumber(phoneNumber);
          if (!contact) {
            // Fallback to platform ID lookup (also checks whatsappLid field)
            contact = await storage.getContactByPlatformId(phoneNumber, "whatsapp");
          }
          if (!contact) {
            // Create new contact - if it's a LID, don't store as phone number
            if (isLid) {
              contact = await storage.createContact({
                platformId: phoneNumber,
                platform: "whatsapp",
                name: chat.name,
                whatsappLid: phoneNumber,
              });
            } else {
              contact = await storage.createContact({
                platformId: phoneNumber,
                platform: "whatsapp",
                name: chat.name,
                phoneNumber: `+${phoneNumber}`,
              });
            }
          } else {
            // Update existing contact with missing identifiers
            const updates: Record<string, string> = {};
            if (isLid && !contact.whatsappLid) {
              updates.whatsappLid = phoneNumber;
            } else if (!isLid && !contact.phoneNumber) {
              updates.phoneNumber = `+${phoneNumber}`;
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateContact(contact.id, updates);
            }
          }

          let conversation = await storage.getConversationByContactId(contact.id);
          if (!conversation) {
            await storage.createConversation({
              contactId: contact.id,
              platform: "whatsapp",
              lastMessageAt: chat.lastMessageTime,
              lastMessagePreview: "Chat synced from WhatsApp",
              unreadCount: chat.unreadCount,
            });
          }
        } catch (error) {
          console.error("Error syncing chat:", error);
        }
      }
      broadcast({ type: "chats_synced" });
    },
    onHistorySync: async (messages) => {
      console.log(`Processing ${messages.length} historical messages...`);
      let savedCount = 0;
      const myJid = whatsappService.getMyJid();
      
      for (const msg of messages) {
        try {
          // Skip broadcast/status messages
          if (msg.from === "status" || msg.from.includes("broadcast")) continue;

          const normalizedHistoryId = normalizeWhatsAppJid(msg.from);
          const isLid = isWhatsAppLid(normalizedHistoryId);
          
          // Skip our own WhatsApp number
          if (myJid && normalizedHistoryId === myJid) continue;
          
          // Normalize alternate ID if provided
          const alternateId = msg.alternateId ? normalizeWhatsAppJid(msg.alternateId) : undefined;
          
          // Use enhanced contact lookup
          let contact = await storage.findOrMergeWhatsAppContact(normalizedHistoryId, alternateId);
          
          if (!contact) {
            // Determine which ID is LID and which is phone
            const altIsLid = alternateId ? alternateId.length >= 15 : false;
            
            // Create new contact with both identifiers if available
            contact = await storage.createContact({
              platformId: normalizedHistoryId,
              platform: "whatsapp",
              name: msg.fromName,
              phoneNumber: isLid ? (alternateId && !altIsLid ? `+${alternateId}` : undefined) : `+${normalizedHistoryId}`,
              whatsappLid: isLid ? normalizedHistoryId : (alternateId && altIsLid ? alternateId : undefined),
            });
          }

          let conversation = await storage.getConversationByContactId(contact.id);
          if (!conversation) {
            conversation = await storage.createConversation({
              contactId: contact.id,
              platform: "whatsapp",
              lastMessageAt: msg.timestamp,
              lastMessagePreview: msg.content.slice(0, 100),
              unreadCount: 0,
            });
          }

          // Check if message already exists
          if (await storage.messageExistsByExternalId(msg.messageId)) continue;

          await storage.createMessage({
            conversationId: conversation.id,
            externalId: msg.messageId,
            direction: msg.isFromMe ? "outbound" : "inbound",
            content: msg.content,
            status: msg.isFromMe ? "sent" : "delivered",
            timestamp: msg.timestamp,
          });

          savedCount++;

          // Update conversation with latest message info
          if (msg.timestamp > conversation.lastMessageAt!) {
            await storage.updateConversation(conversation.id, {
              lastMessageAt: msg.timestamp,
              lastMessagePreview: msg.content.slice(0, 100),
            });
          }
        } catch (error) {
          console.error("Error syncing historical message:", error);
        }
      }
      
      console.log(`Saved ${savedCount} new historical messages`);
      broadcast({ type: "history_synced", count: savedCount });
    },
    onContactsSync: async (contacts) => {
      console.log(`Syncing ${contacts.length} phone book contacts...`);
      let updatedCount = 0;
      let createdCount = 0;
      
      for (const waContact of contacts) {
        try {
          const phoneNumber = waContact.jid.replace("@s.whatsapp.net", "").replace("@lid", "");
          const formattedPhone = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;
          
          // Determine best available name - use phonebook name if it's a proper name, otherwise use phone number
          const hasProperName = waContact.name && 
            !waContact.name.includes("@") && 
            waContact.name !== phoneNumber &&
            !waContact.name.match(/^\+?\d+$/);
          const displayName = hasProperName ? waContact.name : null;
          
          // Find existing contact by phone number first (to merge), then by platform ID
          let existingContact = await storage.getContactByPhoneNumber(phoneNumber);
          if (!existingContact) {
            existingContact = await storage.getContactByPlatformId(phoneNumber, "whatsapp");
          }
          if (!existingContact) {
            existingContact = await storage.getContactByPlatformId(waContact.jid, "whatsapp");
          }
          
          if (existingContact) {
            const currentName = existingContact.name;
            
            // Only update name if we have a proper new name and current name is empty or looks like a jid/phone number
            const needsNameUpdate = hasProperName && (!currentName || 
              currentName.includes("@") || 
              currentName === formattedPhone || 
              currentName === phoneNumber ||
              currentName.match(/^\+?\d+$/));
            
            if (needsNameUpdate) {
              await storage.updateContact(existingContact.id, {
                name: displayName,
                phoneNumber: formattedPhone,
              });
              updatedCount++;
            }
          } else {
            // Create new contact from phonebook - store all contacts, even those without proper names
            await storage.createContact({
              platformId: phoneNumber,
              platform: "whatsapp",
              name: displayName,
              phoneNumber: formattedPhone,
            });
            createdCount++;
          }
        } catch (error) {
          console.error("Error syncing contact:", error);
        }
      }
      
      console.log(`Phone book sync: Created ${createdCount} new contacts, updated ${updatedCount} existing contacts`);
      if (createdCount > 0 || updatedCount > 0) {
        broadcast({ type: "contacts_synced", created: createdCount, updated: updatedCount });
      }
    },
  });

  // Merge duplicate conversations on startup
  storage.mergeDuplicateConversations().then((result) => {
    if (result.mergedContacts > 0 || result.mergedConversations > 0) {
      console.log(`Startup cleanup: Merged ${result.mergedContacts} duplicate contacts, ${result.mergedConversations} duplicate conversations`);
    }
  }).catch((error) => {
    console.error("Startup merge failed:", error);
  });

  // Auto-connect WhatsApp if existing session is available
  whatsappService.autoConnect().then((connected) => {
    if (connected) {
      console.log("WhatsApp auto-connect initiated from existing session");
    }
  }).catch((error) => {
    console.error("WhatsApp auto-connect failed:", error);
  });

  // ============= WHATSAPP CONNECTION ROUTES =============
  // These endpoints are available to all authenticated users (not admin-only)
  // so regular users can reconnect WhatsApp if disconnected
  
  app.get("/api/whatsapp/status", requireAuth, async (req, res) => {
    try {
      const baileysStatus = whatsappService.getConnectionState();
      
      // Check if Twilio WhatsApp is configured
      const { getTwilioStatus } = await import("./twilio");
      const twilioStatus = await getTwilioStatus();
      
      // Check if Meta WABA is configured
      const wabaSettings = await storage.getPlatformSettings("whatsapp");
      const wabaConfigured = wabaSettings?.accessToken && wabaSettings?.phoneNumberId;
      
      // Consider connected if any WhatsApp integration is active
      let effectiveStatus = baileysStatus;
      let connectionMethod = "baileys";
      
      if (twilioStatus.connected) {
        effectiveStatus = "connected";
        connectionMethod = "twilio";
      } else if (wabaConfigured) {
        effectiveStatus = "connected";
        connectionMethod = "waba";
      }
      
      res.json({
        status: effectiveStatus,
        qr: currentQR,
        connectionMethod,
        twilioConnected: twilioStatus.connected,
        wabaConnected: !!wabaConfigured,
        baileysConnected: baileysStatus === "connected",
      });
    } catch (error) {
      res.json({
        status: whatsappService.getConnectionState(),
        qr: currentQR,
        connectionMethod: "baileys",
      });
    }
  });

  app.post("/api/whatsapp/connect", requireAuth, async (req, res) => {
    try {
      await whatsappService.connect();
      res.json({ success: true, status: whatsappService.getConnectionState() });
    } catch (error) {
      console.error("Error connecting WhatsApp:", error);
      res.status(500).json({ error: "Failed to connect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/disconnect", requireAuth, async (req, res) => {
    try {
      await whatsappService.disconnect();
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      res.status(500).json({ error: "Failed to disconnect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/logout", requireAuth, async (req, res) => {
    try {
      await whatsappService.logout();
      res.json({ success: true });
    } catch (error) {
      console.error("Error logging out WhatsApp:", error);
      res.status(500).json({ error: "Failed to logout WhatsApp" });
    }
  });

  app.post("/api/whatsapp/send", requireAuth, async (req, res) => {
    try {
      const { to, content } = req.body;
      const result = await whatsappService.sendMessage(to, content);
      res.json(result);
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // ============= TWILIO ROUTES =============
  
  // Check Twilio connection status
  app.get("/api/twilio/status", requireAuth, async (req, res) => {
    try {
      const { getTwilioStatus } = await import("./twilio");
      const status = await getTwilioStatus();
      res.json(status);
    } catch (error) {
      res.json({ connected: false, phoneNumber: null, source: null });
    }
  });
  
  // Get Twilio settings (masked for security)
  app.get("/api/settings/twilio", requireAuth, requireAdmin, async (req, res) => {
    try {
      const accountSid = await storage.getAppSetting('twilio_account_sid');
      const authToken = await storage.getAppSetting('twilio_auth_token');
      const phoneNumber = await storage.getAppSetting('twilio_phone_number');
      
      res.json({
        accountSid: accountSid?.value ? accountSid.value.substring(0, 8) + '...' : null,
        authTokenSet: !!authToken?.value,
        phoneNumber: phoneNumber?.value || null
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get Twilio settings" });
    }
  });
  
  // Save Twilio settings
  app.post("/api/settings/twilio", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { accountSid, authToken, phoneNumber } = req.body;
      
      if (!accountSid || !authToken || !phoneNumber) {
        return res.status(400).json({ error: "All fields are required" });
      }
      
      // Save settings
      await storage.setAppSetting('twilio_account_sid', accountSid);
      await storage.setAppSetting('twilio_auth_token', authToken);
      await storage.setAppSetting('twilio_phone_number', phoneNumber);
      
      // Clear cached client so it uses new credentials
      const { clearTwilioClient } = await import("./twilio");
      clearTwilioClient();
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to save Twilio settings" });
    }
  });
  
  // Delete Twilio settings
  app.delete("/api/settings/twilio", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteAppSetting('twilio_account_sid');
      await storage.deleteAppSetting('twilio_auth_token');
      await storage.deleteAppSetting('twilio_phone_number');
      
      // Clear cached client
      const { clearTwilioClient } = await import("./twilio");
      clearTwilioClient();
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete Twilio settings" });
    }
  });
  
  // Send WhatsApp message via Twilio
  app.post("/api/twilio/whatsapp/send", requireAuth, async (req, res) => {
    try {
      const { to, content, mediaUrl } = req.body;
      const { sendWhatsAppMessage } = await import("./twilio");
      const result = await sendWhatsAppMessage(to, content, mediaUrl);
      res.json(result);
    } catch (error: any) {
      console.error("Error sending Twilio WhatsApp message:", error);
      res.status(500).json({ error: error.message || "Failed to send message" });
    }
  });
  
  // Send SMS via Twilio
  app.post("/api/twilio/sms/send", requireAuth, async (req, res) => {
    try {
      const { to, content } = req.body;
      const { sendSMSMessage } = await import("./twilio");
      const result = await sendSMSMessage(to, content);
      res.json(result);
    } catch (error: any) {
      console.error("Error sending Twilio SMS:", error);
      res.status(500).json({ error: error.message || "Failed to send SMS" });
    }
  });
  
  // Twilio webhook for incoming messages (WhatsApp and SMS)
  app.post("/api/twilio/webhook", async (req, res) => {
    try {
      console.log("[Twilio] Webhook received:", JSON.stringify(req.body).substring(0, 200));
      const { processIncomingMessage } = await import("./twilio");
      await processIncomingMessage(req.body);
      
      // Broadcast new message event
      broadcast({ type: "new_message" });
      
      // Twilio expects TwiML response
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (error) {
      console.error("[Twilio] Webhook error:", error);
      res.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  });
  
  // Twilio status callback for message delivery status
  app.post("/api/twilio/status", async (req, res) => {
    try {
      console.log("[Twilio] Status callback:", JSON.stringify(req.body).substring(0, 200));
      const { updateMessageStatus } = await import("./twilio");
      await updateMessageStatus(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error("[Twilio] Status callback error:", error);
      res.sendStatus(200);
    }
  });

  // ============= BLAST CAMPAIGN ROUTES =============
  
  // Get all blast campaigns
  app.get("/api/blast-campaigns", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaigns = await storage.getBlastCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error("Error getting blast campaigns:", error);
      res.status(500).json({ error: "Failed to get blast campaigns" });
    }
  });

  // Get single blast campaign with recipients
  app.get("/api/blast-campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      const recipients = await storage.getBlastRecipients(req.params.id);
      res.json({ ...campaign, recipients });
    } catch (error) {
      console.error("Error getting blast campaign:", error);
      res.status(500).json({ error: "Failed to get blast campaign" });
    }
  });

  // Create blast campaign
  app.post("/api/blast-campaigns", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, prompt, contactIds, minIntervalSeconds, maxIntervalSeconds } = req.body;
      
      if (!name || !prompt) {
        return res.status(400).json({ error: "Name and prompt are required" });
      }

      // Create campaign
      const campaign = await storage.createBlastCampaign({
        name,
        prompt,
        status: "draft",
        totalRecipients: contactIds?.length || 0,
        minIntervalSeconds: minIntervalSeconds || 120,
        maxIntervalSeconds: maxIntervalSeconds || 180,
        createdBy: req.session.userId,
      });

      // Create recipients if contact IDs provided
      if (contactIds && contactIds.length > 0) {
        const recipientData = contactIds.map((contactId: string) => ({
          campaignId: campaign.id,
          contactId,
          status: "pending" as const,
        }));
        await storage.createBlastRecipients(recipientData);
        
        // Start staged message generation (generates 5 messages at a time)
        triggerImmediateGeneration(campaign.id).catch(err => {
          console.error("Background message generation error:", err);
        });
      }

      res.json(campaign);
    } catch (error) {
      console.error("Error creating blast campaign:", error);
      res.status(500).json({ error: "Failed to create blast campaign" });
    }
  });

  // Update blast campaign
  app.patch("/api/blast-campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, prompt, minIntervalSeconds, maxIntervalSeconds } = req.body;
      const campaign = await storage.updateBlastCampaign(req.params.id, {
        name,
        prompt,
        minIntervalSeconds,
        maxIntervalSeconds,
      });
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      console.error("Error updating blast campaign:", error);
      res.status(500).json({ error: "Failed to update blast campaign" });
    }
  });

  // Delete blast campaign
  app.delete("/api/blast-campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await storage.deleteBlastCampaign(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting blast campaign:", error);
      res.status(500).json({ error: "Failed to delete blast campaign" });
    }
  });

  // Add recipients to campaign
  app.post("/api/blast-campaigns/:id/recipients", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { contactIds } = req.body;
      if (!contactIds || !Array.isArray(contactIds)) {
        return res.status(400).json({ error: "Contact IDs array required" });
      }

      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (campaign.status !== "draft") {
        return res.status(400).json({ error: "Can only add recipients to draft campaigns" });
      }

      const recipientData = contactIds.map((contactId: string) => ({
        campaignId: req.params.id,
        contactId,
        status: "pending" as const,
      }));

      await storage.createBlastRecipients(recipientData);
      await storage.updateBlastCampaign(req.params.id, {
        totalRecipients: (campaign.totalRecipients || 0) + contactIds.length,
      });

      res.json({ success: true, added: contactIds.length });
    } catch (error) {
      console.error("Error adding recipients:", error);
      res.status(500).json({ error: "Failed to add recipients" });
    }
  });

  // Start/launch campaign
  app.post("/api/blast-campaigns/:id/start", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (campaign.status !== "draft" && campaign.status !== "paused") {
        return res.status(400).json({ error: "Campaign cannot be started from current status" });
      }

      if (!campaign.totalRecipients || campaign.totalRecipients === 0) {
        return res.status(400).json({ error: "Campaign has no recipients" });
      }

      // Check WhatsApp connection
      const waStatus = whatsappService.getConnectionState();
      if (waStatus !== "connected") {
        return res.status(400).json({ error: "WhatsApp is not connected" });
      }

      // Update campaign status to running
      const updated = await storage.updateBlastCampaignStatus(req.params.id, "running");
      res.json(updated);
    } catch (error) {
      console.error("Error starting campaign:", error);
      res.status(500).json({ error: "Failed to start campaign" });
    }
  });

  // Pause campaign
  app.post("/api/blast-campaigns/:id/pause", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (campaign.status !== "running") {
        return res.status(400).json({ error: "Only running campaigns can be paused" });
      }

      // Clear timing so it starts fresh when resumed
      clearCampaignTiming(req.params.id);
      const updated = await storage.updateBlastCampaignStatus(req.params.id, "paused");
      res.json(updated);
    } catch (error) {
      console.error("Error pausing campaign:", error);
      res.status(500).json({ error: "Failed to pause campaign" });
    }
  });

  // Cancel campaign
  app.post("/api/blast-campaigns/:id/cancel", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (campaign.status === "completed" || campaign.status === "cancelled") {
        return res.status(400).json({ error: "Campaign is already finished" });
      }

      // Clear timing when cancelling
      clearCampaignTiming(req.params.id);
      const updated = await storage.updateBlastCampaignStatus(req.params.id, "cancelled");
      res.json(updated);
    } catch (error) {
      console.error("Error cancelling campaign:", error);
      res.status(500).json({ error: "Failed to cancel campaign" });
    }
  });

  // Preview AI-generated message for a recipient
  app.post("/api/blast-campaigns/:id/preview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { contactId } = req.body;
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      const contact = await storage.getContact(contactId);
      if (!contact) {
        return res.status(404).json({ error: "Contact not found" });
      }

      // Get OpenAI API key
      const apiKeySetting = await storage.getAppSetting("openai_api_key");
      const apiKey = apiKeySetting?.value || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ error: "OpenAI API key not configured" });
      }

      // Generate personalized message
      const message = await generatePersonalizedMessage(apiKey, campaign.prompt, contact);
      res.json({ message });
    } catch (error) {
      console.error("Error generating preview:", error);
      res.status(500).json({ error: "Failed to generate preview" });
    }
  });

  // ============= BLAST MESSAGE QUEUE MANAGEMENT =============
  
  // Get message queue for a campaign (awaiting_review and approved messages)
  app.get("/api/blast-campaigns/:id/queue", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      const queuedRecipients = await storage.getQueuedRecipients(req.params.id);
      const counts = await storage.getRecipientQueueCounts(req.params.id);
      
      res.json({ 
        recipients: queuedRecipients,
        counts 
      });
    } catch (error) {
      console.error("Error getting message queue:", error);
      res.status(500).json({ error: "Failed to get message queue" });
    }
  });

  // Get single recipient details
  app.get("/api/blast-recipients/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const recipient = await storage.getBlastRecipientWithContact(req.params.id);
      if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }
      res.json(recipient);
    } catch (error) {
      console.error("Error getting recipient:", error);
      res.status(500).json({ error: "Failed to get recipient" });
    }
  });

  // Update/edit recipient message
  app.patch("/api/blast-recipients/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { reviewedMessage, status } = req.body;
      const recipient = await storage.getBlastRecipient(req.params.id);
      if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }

      // Only allow editing messages in awaiting_review or approved status
      if (!["awaiting_review", "approved"].includes(recipient.status)) {
        return res.status(400).json({ error: "Cannot edit message in current status" });
      }

      const updateData: Record<string, any> = {};
      
      if (reviewedMessage !== undefined) {
        updateData.reviewedMessage = reviewedMessage;
        updateData.reviewedBy = req.session.userId;
      }
      
      if (status !== undefined) {
        if (!["awaiting_review", "approved", "skipped"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        updateData.status = status;
        if (status === "approved") {
          updateData.approvedAt = new Date();
        }
      }

      const updated = await storage.updateBlastRecipient(req.params.id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error updating recipient:", error);
      res.status(500).json({ error: "Failed to update recipient" });
    }
  });

  // Approve a recipient message for sending
  app.post("/api/blast-recipients/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { reviewedMessage } = req.body;
      const recipient = await storage.getBlastRecipient(req.params.id);
      if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }

      if (recipient.status !== "awaiting_review") {
        return res.status(400).json({ error: "Can only approve messages awaiting review" });
      }

      const updateData: Record<string, any> = {
        status: "approved",
        approvedAt: new Date(),
        reviewedBy: req.session.userId,
      };

      // If admin provided an edited message, use it
      if (reviewedMessage) {
        updateData.reviewedMessage = reviewedMessage;
      }

      const updated = await storage.updateBlastRecipient(req.params.id, updateData);
      res.json(updated);
    } catch (error) {
      console.error("Error approving recipient:", error);
      res.status(500).json({ error: "Failed to approve recipient" });
    }
  });

  // Bulk approve multiple messages
  app.post("/api/blast-campaigns/:id/approve-all", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      const queuedRecipients = await storage.getQueuedRecipients(req.params.id);
      const awaitingReview = queuedRecipients.filter(r => r.status === "awaiting_review");
      
      let approvedCount = 0;
      for (const recipient of awaitingReview) {
        await storage.updateBlastRecipient(recipient.id, {
          status: "approved",
          approvedAt: new Date(),
          reviewedBy: req.session.userId,
        });
        approvedCount++;
      }

      res.json({ success: true, approvedCount });
    } catch (error) {
      console.error("Error bulk approving:", error);
      res.status(500).json({ error: "Failed to approve messages" });
    }
  });

  // Regenerate message for a recipient (reset to pending)
  app.post("/api/blast-recipients/:id/regenerate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const recipient = await storage.getBlastRecipient(req.params.id);
      if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }

      if (!["awaiting_review", "approved", "failed"].includes(recipient.status)) {
        return res.status(400).json({ error: "Cannot regenerate message in current status" });
      }

      // Reset to pending so it gets regenerated
      const updated = await storage.updateBlastRecipient(req.params.id, {
        status: "pending",
        generatedMessage: null,
        reviewedMessage: null,
        reviewedBy: null,
        generatedAt: null,
        approvedAt: null,
        errorMessage: null,
      });

      // Trigger immediate generation for this campaign
      triggerImmediateGeneration(recipient.campaignId).catch(err => {
        console.error("Regeneration trigger error:", err);
      });

      res.json(updated);
    } catch (error) {
      console.error("Error regenerating message:", error);
      res.status(500).json({ error: "Failed to regenerate message" });
    }
  });

  // Skip/delete a recipient from the queue
  app.post("/api/blast-recipients/:id/skip", requireAuth, requireAdmin, async (req, res) => {
    try {
      const recipient = await storage.getBlastRecipient(req.params.id);
      if (!recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }

      if (["sent", "sending"].includes(recipient.status)) {
        return res.status(400).json({ error: "Cannot skip message that is being sent or already sent" });
      }

      const updated = await storage.updateBlastRecipient(req.params.id, {
        status: "skipped",
        reviewedBy: req.session.userId,
      });

      res.json(updated);
    } catch (error) {
      console.error("Error skipping recipient:", error);
      res.status(500).json({ error: "Failed to skip recipient" });
    }
  });

  // Manually trigger generation for a campaign
  app.post("/api/blast-campaigns/:id/generate", requireAuth, requireAdmin, async (req, res) => {
    try {
      const campaign = await storage.getBlastCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (campaign.status === "cancelled" || campaign.status === "completed") {
        return res.status(400).json({ error: "Cannot generate for finished campaign" });
      }

      // Trigger generation in background
      const result = await generateCampaignMessageBatch(req.params.id);
      res.json({ success: true, generated: result.generated, remaining: result.total });
    } catch (error) {
      console.error("Error triggering generation:", error);
      res.status(500).json({ error: "Failed to trigger generation" });
    }
  });

  // Serve media files
  app.get("/api/media/:filename", (req, res) => {
    try {
      const { filename } = req.params;
      
      // Security: only allow alphanumeric, dots, dashes, and underscores
      if (!/^[\w\-\.]+$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename" });
      }
      
      const mediaPath = path.join(process.cwd(), "media", "whatsapp", filename);
      
      if (!fs.existsSync(mediaPath)) {
        return res.status(404).json({ error: "Media not found" });
      }
      
      // Determine content type from extension
      const ext = path.extname(filename).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".ogg": "audio/ogg",
        ".mp3": "audio/mpeg",
      };
      
      const contentType = contentTypes[ext] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      
      const fileStream = fs.createReadStream(mediaPath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error serving media:", error);
      res.status(500).json({ error: "Failed to serve media" });
    }
  });

  return httpServer;
}
