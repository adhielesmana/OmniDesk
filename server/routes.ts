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
import { clearCampaignTiming } from "./blast-worker";
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

  // ============= AUTHENTICATION ROUTES =============
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || !user.isActive) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const valid = await verifyPassword(password, user.password);
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

      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
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
      updateStatus.updateLog = ["Fetching updates from remote..."];

      await execAsync("git fetch origin", { cwd: process.cwd() });
      updateStatus.updateLog.push("Remote fetched successfully");

      const { stdout: localCommit } = await execAsync("git rev-parse HEAD", { cwd: process.cwd() });
      const { stdout: remoteCommit } = await execAsync("git rev-parse origin/main", { cwd: process.cwd() });

      updateStatus.localCommit = localCommit.trim();
      updateStatus.remoteCommit = remoteCommit.trim();
      updateStatus.hasUpdate = updateStatus.localCommit !== updateStatus.remoteCommit;
      updateStatus.lastChecked = new Date();
      updateStatus.isChecking = false;

      if (updateStatus.hasUpdate) {
        const { stdout: commitLog } = await execAsync(
          `git log --oneline ${updateStatus.localCommit}..${updateStatus.remoteCommit}`,
          { cwd: process.cwd() }
        );
        updateStatus.updateLog.push(`Found ${commitLog.split('\n').filter(Boolean).length} new commits`);
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

    if (!updateStatus.hasUpdate) {
      return res.status(400).json({ error: "No updates available" });
    }

    updateStatus.isUpdating = true;
    updateStatus.error = null;
    updateStatus.updateLog = ["Starting update process..."];

    res.json({ message: "Update started", status: updateStatus });

    try {
      updateStatus.updateLog.push("Pulling latest changes...");
      const { stdout: pullOutput } = await execAsync("git pull origin main", { cwd: process.cwd() });
      updateStatus.updateLog.push(pullOutput.trim());

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

      if (req.session.user?.role !== "superadmin") {
        const userDepartmentIds = await getUserDepartmentIds(req.session.userId!, req.session.user!.role);
        if (userDepartmentIds !== "all") {
          departmentFilter = userDepartmentIds;
        }
      }

      const conversations = await storage.getConversations(departmentFilter);
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

      // Use unofficial WhatsApp for WhatsApp messages
      if (conversation.platform === "whatsapp") {
        if (whatsappService.isConnected()) {
          const waResult = await whatsappService.sendMessage(
            conversation.contact.platformId,
            content
          );
          result = { success: waResult.success, messageId: waResult.messageId || undefined };
        }
      } else {
        // Use Meta API for Instagram/Facebook
        const settings = await storage.getPlatformSetting(conversation.platform);
        if (settings?.isConnected && settings.accessToken) {
          const metaApi = new MetaApiService(conversation.platform, {
            accessToken: settings.accessToken,
            phoneNumberId: settings.phoneNumberId || undefined,
            pageId: settings.pageId || undefined,
            businessId: settings.businessId || undefined,
          });
          const metaResult = await metaApi.sendMessage(conversation.contact.platformId, content);
          result = { success: metaResult.success, messageId: metaResult.messageId };
        }
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

  // Get platform settings
  app.get("/api/platform-settings", async (req, res) => {
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

  // Save platform settings
  app.post("/api/platform-settings/:platform", async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      if (!["whatsapp", "instagram", "facebook"].includes(platform)) {
        return res.status(400).json({ error: "Invalid platform" });
      }

      const settings = await storage.upsertPlatformSettings({
        platform,
        ...req.body,
        isConnected: true,
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

  // Test platform connection
  app.get("/api/platform-settings/:platform/test", async (req, res) => {
    try {
      const platform = req.params.platform as Platform;
      const settings = await storage.getPlatformSetting(platform);

      if (!settings?.accessToken) {
        return res.json({ success: false, error: "No credentials configured" });
      }

      const metaApi = new MetaApiService(platform, {
        accessToken: settings.accessToken,
        phoneNumberId: settings.phoneNumberId || undefined,
        pageId: settings.pageId || undefined,
        businessId: settings.businessId || undefined,
      });

      const result = await metaApi.testConnection();
      res.json(result);
    } catch (error) {
      console.error("Error testing connection:", error);
      res.status(500).json({ success: false, error: "Connection test failed" });
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
  app.get("/api/webhook/:platform", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken) {
      console.log(`${req.params.platform} webhook verified`);
      res.status(200).send(challenge);
    } else {
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
        // Find or create contact
        let contact = await storage.getContactByPlatformId(
          webhookMessage.senderId,
          webhookMessage.platform
        );

        if (!contact) {
          contact = await storage.createContact({
            platformId: webhookMessage.senderId,
            platform: webhookMessage.platform,
            name: webhookMessage.senderName,
          });
        }

        // Find or create conversation
        let conversation = await storage.getConversationByContactId(contact.id);

        if (!conversation) {
          conversation = await storage.createConversation({
            contactId: contact.id,
            platform: webhookMessage.platform,
            unreadCount: 1,
          });
        } else {
          await storage.updateConversation(conversation.id, {
            unreadCount: (conversation.unreadCount || 0) + 1,
          });
        }

        // Create message
        const message = await storage.createMessage({
          conversationId: conversation.id,
          externalId: webhookMessage.externalId,
          direction: "inbound",
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
        
        // First try to find existing contact by phone number or LID
        let contact = await storage.getContactByPhoneNumber(normalizedId);
        if (!contact) {
          // Fallback to platform ID lookup (also checks whatsappLid field)
          contact = await storage.getContactByPlatformId(normalizedId, "whatsapp");
        }
        if (!contact) {
          // Create new contact - if it's a LID, don't store as phone number
          if (isLid) {
            contact = await storage.createContact({
              platformId: normalizedId,
              platform: "whatsapp",
              name: msg.fromName,
              whatsappLid: normalizedId, // Store LID separately
              // Don't set phone number for LID-only contacts
            });
          } else {
            contact = await storage.createContact({
              platformId: normalizedId,
              platform: "whatsapp",
              name: msg.fromName,
              phoneNumber: `+${normalizedId}`,
            });
          }
        } else {
          // Update existing contact with missing identifiers
          const updates: Record<string, string> = {};
          if (isLid && !contact.whatsappLid) {
            updates.whatsappLid = normalizedId;
          } else if (!isLid && !contact.phoneNumber) {
            updates.phoneNumber = `+${normalizedId}`;
          }
          if (Object.keys(updates).length > 0) {
            await storage.updateContact(contact.id, updates);
          }
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
      for (const chat of chats) {
        try {
          const phoneNumber = chat.jid.replace("@s.whatsapp.net", "").replace("@lid", "");
          const isLid = isWhatsAppLid(phoneNumber);
          
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
      
      for (const msg of messages) {
        try {
          // Skip broadcast/status messages
          if (msg.from === "status" || msg.from.includes("broadcast")) continue;

          const normalizedHistoryId = normalizeWhatsAppJid(msg.from);
          const isLid = isWhatsAppLid(normalizedHistoryId);
          
          // First try to find existing contact by phone number or LID
          let contact = await storage.getContactByPhoneNumber(normalizedHistoryId);
          if (!contact) {
            // Fallback to platform ID lookup (also checks whatsappLid field)
            contact = await storage.getContactByPlatformId(normalizedHistoryId, "whatsapp");
          }
          if (!contact) {
            // Create new contact - if it's a LID, don't store as phone number
            if (isLid) {
              contact = await storage.createContact({
                platformId: normalizedHistoryId,
                platform: "whatsapp",
                name: msg.fromName,
                whatsappLid: normalizedHistoryId,
              });
            } else {
              contact = await storage.createContact({
                platformId: normalizedHistoryId,
                platform: "whatsapp",
                name: msg.fromName,
                phoneNumber: `+${normalizedHistoryId}`,
              });
            }
          } else {
            // Update existing contact with missing identifiers
            const updates: Record<string, string> = {};
            if (isLid && !contact.whatsappLid) {
              updates.whatsappLid = normalizedHistoryId;
            } else if (!isLid && !contact.phoneNumber) {
              updates.phoneNumber = `+${normalizedHistoryId}`;
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateContact(contact.id, updates);
            }
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

  // WhatsApp will only connect when user explicitly clicks "Scan QR" button
  // No auto-connect on server startup

  app.get("/api/whatsapp/status", (req, res) => {
    res.json({
      status: whatsappService.getConnectionState(),
      qr: currentQR,
    });
  });

  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      await whatsappService.connect();
      res.json({ success: true, status: whatsappService.getConnectionState() });
    } catch (error) {
      console.error("Error connecting WhatsApp:", error);
      res.status(500).json({ error: "Failed to connect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      await whatsappService.disconnect();
      res.json({ success: true });
    } catch (error) {
      console.error("Error disconnecting WhatsApp:", error);
      res.status(500).json({ error: "Failed to disconnect WhatsApp" });
    }
  });

  app.post("/api/whatsapp/logout", async (req, res) => {
    try {
      await whatsappService.logout();
      res.json({ success: true });
    } catch (error) {
      console.error("Error logging out WhatsApp:", error);
      res.status(500).json({ error: "Failed to logout WhatsApp" });
    }
  });

  app.post("/api/whatsapp/send", async (req, res) => {
    try {
      const { to, content } = req.body;
      const result = await whatsappService.sendMessage(to, content);
      res.json(result);
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
      res.status(500).json({ error: "Failed to send message" });
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
