import makeWASocket, {
  DisconnectReason,
  WASocket,
  BaileysEventMap,
  proto,
  downloadContentFromMessage,
  MediaType,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as QRCode from "qrcode";
import pino from "pino";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
import { useDbAuthState, hasDbAuthCreds, clearDbAuthCreds } from "./whatsapp-db-auth";
import { db } from "./db";
import { whatsappAuthState } from "@shared/schema";
import { eq } from "drizzle-orm";

export type WhatsAppConnectionState = "disconnected" | "connecting" | "qr" | "connected";

export interface WhatsAppChat {
  jid: string;
  name: string;
  lastMessageTime: Date;
  unreadCount: number;
}

export interface WhatsAppMessage {
  from: string;
  fromName: string;
  content: string;
  timestamp: Date;
  messageId: string;
  isGroup: boolean;
  isFromMe: boolean;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document" | "location";
  metadata?: string;
  // Additional identifier if available (e.g., phone when from is LID, or LID when from is phone)
  alternateId?: string;
}

export interface WhatsAppContact {
  jid: string;
  name: string;
  phoneNumber: string;
}

export interface WhatsAppEventHandlers {
  onQR: (qrDataUrl: string) => void;
  onConnectionUpdate: (state: WhatsAppConnectionState) => void;
  onMessage: (message: WhatsAppMessage) => void;
  onMessageSent: (messageId: string, status: "sent" | "delivered" | "read") => void;
  onChatsSync?: (chats: WhatsAppChat[]) => void;
  onHistorySync?: (messages: WhatsAppMessage[]) => void;
  onContactsSync?: (contacts: WhatsAppContact[]) => void;
}

class WhatsAppService {
  private socket: WASocket | null = null;
  private connectionState: WhatsAppConnectionState = "disconnected";
  private eventHandlers: WhatsAppEventHandlers | null = null;
  private mediaFolder = path.join(process.cwd(), "media", "whatsapp");
  private reconnectAttempts = 0;
  private reconnectDelay = 5000; // Start with 5 seconds (increased from 3s)
  private maxReconnectDelay = 120000; // Max 2 minutes between retries (increased from 60s)
  private maxReconnectAttempts = 10; // Max 10 reconnect attempts before requiring manual intervention
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private stopReconnect = false; // Flag to stop auto-reconnection
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private qrTimeout: NodeJS.Timeout | null = null; // 5-minute timeout for QR scanning
  private readonly QR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private clearCredsFunc: (() => Promise<void>) | null = null; // Store clearCreds function
  
  // Rate limiting to prevent WhatsApp bans - CONSERVATIVE limits
  private messageSendTimes: number[] = []; // Timestamps of recent sends
  private readonly MAX_MESSAGES_PER_MINUTE = 10; // Max 10 messages per minute (reduced from 20)
  private readonly MAX_MESSAGES_PER_HOUR = 100; // Max 100 messages per hour (reduced from 200)
  private readonly MAX_MESSAGES_PER_DAY = 500; // Max 500 messages per day
  private rateLimitWarningShown = false;
  private dailyMessageCount = 0;
  private lastDailyResetJakarta: { year: number; month: number; day: number } = { year: 0, month: 0, day: 0 };
  
  // Per-conversation spacing to prevent rapid automated messages
  private lastMessagePerContact: Map<string, number> = new Map();
  private readonly MIN_MESSAGE_INTERVAL_MS = 5000; // Min 5 seconds between messages to same contact
  
  // Session fingerprint - randomized to avoid detection
  private sessionFingerprint: { browser: string; version: string } | null = null;

  constructor() {
    // Ensure media folder exists
    if (!fs.existsSync(this.mediaFolder)) {
      fs.mkdirSync(this.mediaFolder, { recursive: true });
    }
  }

  // Add jitter to delay to prevent thundering herd and look more human
  private addJitter(baseDelay: number): number {
    // Add 0-50% random jitter
    const jitter = Math.random() * 0.5 * baseDelay;
    return Math.floor(baseDelay + jitter);
  }

  // Generate randomized browser fingerprint for session
  private generateFingerprint(): { browser: string; version: string } {
    const browsers = ["Chrome", "Firefox", "Safari", "Edge"];
    const chromeVersions = ["120.0.0", "121.0.0", "122.0.0", "123.0.0", "124.0.0"];
    const firefoxVersions = ["120.0", "121.0", "122.0", "123.0"];
    const safariVersions = ["17.0", "17.1", "17.2", "17.3"];
    const edgeVersions = ["120.0.0", "121.0.0", "122.0.0"];
    
    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    let version: string;
    
    switch (browser) {
      case "Firefox":
        version = firefoxVersions[Math.floor(Math.random() * firefoxVersions.length)];
        break;
      case "Safari":
        version = safariVersions[Math.floor(Math.random() * safariVersions.length)];
        break;
      case "Edge":
        version = edgeVersions[Math.floor(Math.random() * edgeVersions.length)];
        break;
      default:
        version = chromeVersions[Math.floor(Math.random() * chromeVersions.length)];
    }
    
    return { browser, version };
  }

  // Get current date in Jakarta timezone (Asia/Jakarta, UTC+7)
  private getJakartaDate(): { year: number; month: number; day: number } {
    const now = new Date();
    const jakartaStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD format
    const [year, month, day] = jakartaStr.split("-").map(Number);
    return { year, month, day };
  }

  // Reset daily counter if new day in Jakarta timezone
  private checkDailyReset(): void {
    const jakartaNow = this.getJakartaDate();
    const jakartaLast = this.lastDailyResetJakarta;
    
    if (jakartaNow.year !== jakartaLast.year || 
        jakartaNow.month !== jakartaLast.month ||
        jakartaNow.day !== jakartaLast.day) {
      this.dailyMessageCount = 0;
      this.lastDailyResetJakarta = jakartaNow;
      console.log(`WhatsApp daily message counter reset (Jakarta: ${jakartaNow.year}-${jakartaNow.month}-${jakartaNow.day})`);
    }
  }

  // Check if we can send a message (rate limiting with per-contact spacing)
  private canSendMessage(contactJid?: string): { allowed: boolean; waitMs?: number; reason?: string } {
    const now = Date.now();
    
    // Check daily reset
    this.checkDailyReset();
    
    // Check daily limit first
    if (this.dailyMessageCount >= this.MAX_MESSAGES_PER_DAY) {
      const msUntilMidnight = this.getMsUntilMidnight();
      return { 
        allowed: false, 
        waitMs: msUntilMidnight,
        reason: `Rate limit: ${this.MAX_MESSAGES_PER_DAY} messages/day exceeded. Resets at midnight.` 
      };
    }
    
    // Check per-contact spacing (prevent rapid messages to same person)
    if (contactJid) {
      const lastSent = this.lastMessagePerContact.get(contactJid);
      if (lastSent && (now - lastSent) < this.MIN_MESSAGE_INTERVAL_MS) {
        const waitMs = this.MIN_MESSAGE_INTERVAL_MS - (now - lastSent) + 500;
        return { 
          allowed: false, 
          waitMs,
          reason: `Per-contact spacing: wait ${Math.ceil(waitMs / 1000)}s before messaging this contact again` 
        };
      }
    }
    
    // Clean up old timestamps (older than 1 hour)
    this.messageSendTimes = this.messageSendTimes.filter(t => now - t < 3600000);
    
    // Clean up old per-contact timestamps (older than 1 hour)
    const entriesToDelete: string[] = [];
    this.lastMessagePerContact.forEach((timestamp, jid) => {
      if (now - timestamp > 3600000) {
        entriesToDelete.push(jid);
      }
    });
    entriesToDelete.forEach(jid => this.lastMessagePerContact.delete(jid));
    
    // Check per-minute limit
    const lastMinute = this.messageSendTimes.filter(t => now - t < 60000);
    if (lastMinute.length >= this.MAX_MESSAGES_PER_MINUTE) {
      const oldestInMinute = Math.min(...lastMinute);
      const waitMs = 60000 - (now - oldestInMinute) + 1000; // Wait until a slot opens + 1s buffer
      return { 
        allowed: false, 
        waitMs,
        reason: `Rate limit: ${this.MAX_MESSAGES_PER_MINUTE} messages/minute exceeded` 
      };
    }
    
    // Check per-hour limit
    if (this.messageSendTimes.length >= this.MAX_MESSAGES_PER_HOUR) {
      const oldestInHour = Math.min(...this.messageSendTimes);
      const waitMs = 3600000 - (now - oldestInHour) + 1000;
      return { 
        allowed: false, 
        waitMs,
        reason: `Rate limit: ${this.MAX_MESSAGES_PER_HOUR} messages/hour exceeded` 
      };
    }
    
    return { allowed: true };
  }
  
  // Get milliseconds until midnight (Jakarta time / UTC+7)
  private getMsUntilMidnight(): number {
    const now = Date.now();
    const jakartaOffsetMs = 7 * 60 * 60 * 1000; // UTC+7 in milliseconds
    
    // Current time in Jakarta (as UTC timestamp adjusted for Jakarta)
    const jakartaNow = now + jakartaOffsetMs;
    
    // Milliseconds since midnight Jakarta = jakartaNow % 86400000 (ms per day)
    const msSinceMidnightJakarta = jakartaNow % 86400000;
    
    // Milliseconds until next midnight Jakarta
    const msUntilMidnight = 86400000 - msSinceMidnightJakarta;
    
    return msUntilMidnight;
  }

  // Record a message send for rate limiting
  private recordMessageSend(contactJid?: string): void {
    const now = Date.now();
    this.messageSendTimes.push(now);
    this.dailyMessageCount++;
    
    // Track per-contact last message time
    if (contactJid) {
      this.lastMessagePerContact.set(contactJid, now);
    }
  }

  // Mark session as successfully connected in database (for auto-reconnect on restart)
  private async setConnectedFlag(): Promise<void> {
    try {
      await db.insert(whatsappAuthState)
        .values({ key: "_connected", value: new Date().toISOString(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: whatsappAuthState.key,
          set: { value: new Date().toISOString(), updatedAt: new Date() }
        });
    } catch (error) {
      console.error("Failed to set connected flag:", error);
    }
  }

  // Clear connected flag from database (on logout or manual disconnect)
  private async clearConnectedFlag(): Promise<void> {
    try {
      await db.delete(whatsappAuthState).where(eq(whatsappAuthState.key, "_connected"));
    } catch (error) {
      console.error("Failed to clear connected flag:", error);
    }
  }

  // Check if session was previously connected (should auto-reconnect)
  private async wasConnected(): Promise<boolean> {
    try {
      const result = await db.select()
        .from(whatsappAuthState)
        .where(eq(whatsappAuthState.key, "_connected"))
        .limit(1);
      return result.length > 0;
    } catch {
      return false;
    }
  }

  private getExtensionFromMimetype(mimetype: string | null | undefined): string {
    if (!mimetype) return "bin";
    const mimeToExt: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "video/3gpp": "3gp",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/aac": "aac",
      "application/pdf": "pdf",
    };
    return mimeToExt[mimetype] || mimetype.split("/").pop() || "bin";
  }

  private async downloadMedia(
    message: proto.IMessage,
    messageId: string
  ): Promise<{ filePath: string; mediaType: "image" | "video" | "audio" | "document"; mimetype: string } | null> {
    try {
      let mediaMessage: proto.Message.IImageMessage | proto.Message.IVideoMessage | proto.Message.IAudioMessage | proto.Message.IDocumentMessage | null = null;
      let mediaType: "image" | "video" | "audio" | "document" = "image";
      let mimetype = "application/octet-stream";

      if (message.imageMessage) {
        mediaMessage = message.imageMessage;
        mediaType = "image";
        mimetype = message.imageMessage.mimetype || "image/jpeg";
      } else if (message.videoMessage) {
        mediaMessage = message.videoMessage;
        mediaType = "video";
        mimetype = message.videoMessage.mimetype || "video/mp4";
      } else if (message.audioMessage) {
        mediaMessage = message.audioMessage;
        mediaType = "audio";
        mimetype = message.audioMessage.mimetype || "audio/ogg";
      } else if (message.documentMessage) {
        mediaMessage = message.documentMessage;
        mediaType = "document";
        mimetype = message.documentMessage.mimetype || "application/octet-stream";
      }

      if (!mediaMessage) return null;

      const extension = this.getExtensionFromMimetype(mimetype);
      const stream = await downloadContentFromMessage(
        mediaMessage as any,
        mediaType as MediaType
      );

      const buffer = await this.streamToBuffer(stream);
      const fileName = `${messageId}.${extension}`;
      const filePath = path.join(this.mediaFolder, fileName);
      
      fs.writeFileSync(filePath, buffer);
      
      return { filePath: `/api/media/${fileName}`, mediaType, mimetype };
    } catch (error) {
      console.error("Error downloading media:", error);
      return null;
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private startHealthCheck() {
    this.stopHealthCheck();
    // Check connection health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      if (this.connectionState === "connected") {
        // Check if socket is still usable
        if (!this.socket || !this.socket.user) {
          console.log("Health check detected disconnected socket, triggering reconnect");
          this.connectionState = "disconnected";
          this.eventHandlers?.onConnectionUpdate("disconnected");
          this.stopHealthCheck();
          setTimeout(() => this.connect(), 1000);
        }
      }
    }, 30000);
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private startQrTimeout() {
    // Clear any existing timeout
    this.clearQrTimeout();
    
    console.log("Starting 5-minute QR timeout...");
    this.qrTimeout = setTimeout(() => {
      if (this.connectionState === "qr" || this.connectionState === "connecting") {
        console.log("QR timeout reached (5 minutes). Stopping connection attempt.");
        this.stopReconnect = true;
        this.disconnect();
      }
    }, this.QR_TIMEOUT_MS);
  }

  private clearQrTimeout() {
    if (this.qrTimeout) {
      clearTimeout(this.qrTimeout);
      this.qrTimeout = null;
    }
  }

  getConnectionState(): WhatsAppConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && this.socket !== null;
  }

  getMyJid(): string | null {
    if (!this.socket?.user?.id) return null;
    // Return normalized JID (remove device suffix like :0@s.whatsapp.net)
    const jid = this.socket.user.id;
    // Extract just the number part (before : or @)
    const match = jid.match(/^(\d+)/);
    return match ? match[1] : null;
  }

  async hasExistingAuth(): Promise<boolean> {
    try {
      return await hasDbAuthCreds();
    } catch {
      return false;
    }
  }

  // Auto-connect if session was previously connected (called on server startup)
  async autoConnect(): Promise<boolean> {
    const hasAuth = await this.hasExistingAuth();
    const wasConn = await this.wasConnected();
    
    if (hasAuth && wasConn) {
      console.log("Found existing WhatsApp session in database, auto-reconnecting...");
      try {
        await this.connect();
        return true;
      } catch (error) {
        console.error("Failed to auto-connect WhatsApp:", error);
        return false;
      }
    }
    if (hasAuth && !wasConn) {
      console.log("Found WhatsApp auth in database but session was logged out, skipping auto-connect");
    } else {
      console.log("No existing WhatsApp session found in database, skipping auto-connect");
    }
    return false;
  }

  setEventHandlers(handlers: WhatsAppEventHandlers) {
    this.eventHandlers = handlers;
  }

  async connect(): Promise<void> {
    if (this.connectionState === "connecting" || this.connectionState === "qr") {
      return;
    }

    // Reset stop flag when manually connecting
    this.stopReconnect = false;
    this.connectionState = "connecting";
    this.eventHandlers?.onConnectionUpdate("connecting");

    try {
      // Use database-backed auth state for persistence across restarts
      const { state, saveCreds, clearCreds } = await useDbAuthState();
      this.clearCredsFunc = clearCreds;

      const logger = pino({ level: "silent" });

      // Generate or reuse session fingerprint for consistent device identity
      if (!this.sessionFingerprint) {
        this.sessionFingerprint = this.generateFingerprint();
        console.log(`WhatsApp session fingerprint: ${this.sessionFingerprint.browser} ${this.sessionFingerprint.version}`);
      }
      
      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ["OmniDesk", this.sessionFingerprint.browser, this.sessionFingerprint.version],
        syncFullHistory: true,
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.connectionState = "qr";
          this.eventHandlers?.onConnectionUpdate("qr");
          
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.eventHandlers?.onQR(qrDataUrl);
          
          // Start 5-minute timeout for QR scanning
          this.startQrTimeout();
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const errorMessage = (lastDisconnect?.error as Boom)?.message || "Unknown error";
          
          // Determine if we should clear credentials based on error type
          const isFatalAuthError = statusCode === DisconnectReason.loggedOut || 
                                   statusCode === 401 || 
                                   statusCode === 403;

          this.connectionState = "disconnected";
          this.eventHandlers?.onConnectionUpdate("disconnected");
          this.stopHealthCheck();

          if (isFatalAuthError) {
            // Fatal auth errors - clear credentials and require manual re-login
            console.log(`WhatsApp fatal auth error (${statusCode}: ${errorMessage}), clearing auth data`);
            this.reconnectAttempts = 0;
            this.reconnectDelay = 5000;
            this.stopReconnect = true;
            this.clearConnectedFlag();
            await this.clearAuthData();
          } else if (!this.stopReconnect) {
            this.reconnectAttempts++;
            
            // Check if we've exceeded max attempts
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              console.log(`WhatsApp: Max reconnect attempts (${this.maxReconnectAttempts}) exceeded. Manual intervention required.`);
              this.stopReconnect = true;
              this.clearConnectedFlag(); // Don't auto-reconnect on restart
              return;
            }
            
            // Exponential backoff with jitter: 5s, 10s, 20s, 40s, 80s, max 120s
            const baseDelay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
            const delayWithJitter = this.addJitter(baseDelay);
            
            console.log(`WhatsApp disconnected (${statusCode}: ${errorMessage}). Reconnecting in ${Math.round(delayWithJitter / 1000)}s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.reconnectTimeout = setTimeout(() => this.connect(), delayWithJitter);
          } else {
            console.log("WhatsApp disconnected. Auto-reconnect disabled.");
          }
        } else if (connection === "open") {
          // Clear QR timeout - successfully connected
          this.clearQrTimeout();
          
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.reconnectDelay = 5000;
          this.rateLimitWarningShown = false;
          this.eventHandlers?.onConnectionUpdate("connected");
          console.log("WhatsApp connected successfully");
          
          // Mark as connected for auto-reconnect on restart
          this.setConnectedFlag();
          
          // Start health check to detect silent disconnects
          this.startHealthCheck();
          
          // Fetch recent chats after connection is established
          setTimeout(() => this.fetchAllChatsWithMessages(), 2000);
        }
      });

      // Helper function to process contacts from phone book
      const processContacts = (contactList: { id: string; name?: string | null; notify?: string | null }[]) => {
        const syncedContacts: WhatsAppContact[] = contactList
          .filter((contact) => {
            if (!contact.id) return false;
            if (contact.id.endsWith("@g.us")) return false;
            if (contact.id === "status@broadcast") return false;
            if (contact.id.includes("broadcast")) return false;
            return true;
          })
          .map((contact) => {
            const phoneNumber = contact.id.replace("@s.whatsapp.net", "");
            return {
              jid: contact.id,
              name: contact.name || contact.notify || phoneNumber,
              phoneNumber: `+${phoneNumber}`,
            };
          });

        if (syncedContacts.length > 0) {
          console.log(`Syncing ${syncedContacts.length} contacts from phone book`);
          this.eventHandlers?.onContactsSync?.(syncedContacts);
        }
      };

      // Handle historical message sync
      this.socket.ev.on("messaging-history.set", ({ chats, contacts: waContacts, messages: historyMessages, isLatest }) => {
        console.log(`History sync received: ${chats.length} chats, ${waContacts?.length || 0} contacts, ${historyMessages.length} messages, isLatest: ${isLatest}`);
        
        // Sync contacts from history sync
        if (waContacts && waContacts.length > 0) {
          processContacts(waContacts);
        }
        
        const parsedMessages: WhatsAppMessage[] = [];
        
        for (const msg of historyMessages) {
          if (msg.message) {
            const from = msg.key.remoteJid || "";
            const isGroup = from.endsWith("@g.us");
            const isFromMe = msg.key.fromMe || false;
            
            let content = "";
            if (msg.message.conversation) {
              content = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
              content = msg.message.extendedTextMessage.text;
            } else if (msg.message.imageMessage) {
              content = "[Image]";
            } else if (msg.message.videoMessage) {
              content = "[Video]";
            } else if (msg.message.audioMessage) {
              content = "[Audio]";
            } else if (msg.message.documentMessage) {
              content = "[Document]";
            } else if (msg.message.stickerMessage) {
              content = "[Sticker]";
            } else if (msg.message.locationMessage) {
              content = "[Location]";
            } else if (msg.message.liveLocationMessage) {
              content = "[Live Location]";
            }

            if (content && !isGroup) {
              parsedMessages.push({
                from: from.replace("@s.whatsapp.net", "").replace("@g.us", ""),
                fromName: msg.pushName || from,
                content,
                timestamp: new Date((msg.messageTimestamp as number) * 1000),
                messageId: msg.key.id || "",
                isGroup,
                isFromMe,
              });
            }
          }
        }

        if (parsedMessages.length > 0) {
          console.log(`Syncing ${parsedMessages.length} historical messages`);
          this.eventHandlers?.onHistorySync?.(parsedMessages);
        }
      });

      // Sync existing chats when they're loaded
      this.socket.ev.on("chats.upsert", (chats) => {
        const syncedChats: WhatsAppChat[] = chats
          .filter((chat) => {
            // Skip groups, status broadcasts, and invalid chats
            if (!chat.id) return false;
            if (chat.id.endsWith("@g.us")) return false;
            if (chat.id === "status@broadcast") return false;
            if (chat.id.includes("broadcast")) return false;
            return true;
          })
          .map((chat) => ({
            jid: chat.id!,
            name: chat.name || chat.id!.replace("@s.whatsapp.net", ""),
            lastMessageTime: new Date((chat.conversationTimestamp as number || 0) * 1000),
            unreadCount: chat.unreadCount || 0,
          }));
        
        if (syncedChats.length > 0) {
          this.eventHandlers?.onChatsSync?.(syncedChats);
        }
      });

      // contacts.upsert fires when contacts are updated
      this.socket.ev.on("contacts.upsert", (contacts) => {
        processContacts(contacts);
      });

      this.socket.ev.on("messages.upsert", async (messageUpdate) => {
        for (const msg of messageUpdate.messages) {
          if (msg.message) {
            const from = msg.key.remoteJid || "";
            
            // Skip status broadcasts and groups
            if (from === "status@broadcast" || from.includes("broadcast")) continue;
            
            const isGroup = from.endsWith("@g.us");
            const isFromMe = msg.key.fromMe || false;
            const messageId = msg.key.id || "";
            
            // Try to extract alternate identifier (phone from LID context or vice versa)
            // Baileys sometimes provides participant info that differs from remoteJid
            let alternateId: string | undefined;
            const participant = (msg.key as any).participant;
            if (participant && participant !== from) {
              // participant is different from remoteJid - might be the phone/LID pair
              alternateId = participant.replace("@s.whatsapp.net", "").replace("@lid", "").replace("@c.us", "");
            }
            
            let content = "";
            let mediaUrl: string | undefined;
            let mediaType: "image" | "video" | "audio" | "document" | "location" | undefined;

            if (msg.message.conversation) {
              content = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
              content = msg.message.extendedTextMessage.text;
            } else if (msg.message.imageMessage) {
              content = msg.message.imageMessage.caption || "Photo";
              const media = await this.downloadMedia(msg.message, messageId);
              if (media) {
                mediaUrl = media.filePath;
                mediaType = media.mediaType;
              }
            } else if (msg.message.videoMessage) {
              content = msg.message.videoMessage.caption || "Video";
              const media = await this.downloadMedia(msg.message, messageId);
              if (media) {
                mediaUrl = media.filePath;
                mediaType = media.mediaType;
              }
            } else if (msg.message.audioMessage) {
              content = "Voice message";
              // Skip audio downloads for now to save space
            } else if (msg.message.documentMessage) {
              content = msg.message.documentMessage.fileName || "Document";
              // Skip document downloads for now
            } else if (msg.message.stickerMessage) {
              content = "Sticker";
              // Skip sticker downloads
            } else if (msg.message.locationMessage) {
              const loc = msg.message.locationMessage;
              content = loc.name || loc.address || "Location";
              mediaType = "location";
              const locationMeta = {
                latitude: loc.degreesLatitude,
                longitude: loc.degreesLongitude,
                name: loc.name || undefined,
                address: loc.address || undefined,
              };
              if (content) {
                this.eventHandlers?.onMessage({
                  from: from.replace("@s.whatsapp.net", "").replace("@g.us", ""),
                  fromName: msg.pushName || from,
                  content,
                  timestamp: new Date((msg.messageTimestamp as number) * 1000),
                  messageId,
                  isGroup,
                  isFromMe,
                  mediaType,
                  metadata: JSON.stringify(locationMeta),
                  alternateId,
                });
              }
              continue;
            } else if (msg.message.liveLocationMessage) {
              const loc = msg.message.liveLocationMessage;
              content = "Live Location";
              mediaType = "location";
              const locationMeta = {
                latitude: loc.degreesLatitude,
                longitude: loc.degreesLongitude,
                isLive: true,
              };
              if (content) {
                this.eventHandlers?.onMessage({
                  from: from.replace("@s.whatsapp.net", "").replace("@g.us", ""),
                  fromName: msg.pushName || from,
                  content,
                  timestamp: new Date((msg.messageTimestamp as number) * 1000),
                  messageId,
                  isGroup,
                  isFromMe,
                  mediaType,
                  metadata: JSON.stringify(locationMeta),
                  alternateId,
                });
              }
              continue;
            }

            if (content) {
              this.eventHandlers?.onMessage({
                from: from.replace("@s.whatsapp.net", "").replace("@g.us", ""),
                fromName: msg.pushName || from,
                content,
                timestamp: new Date((msg.messageTimestamp as number) * 1000),
                messageId,
                isGroup,
                isFromMe,
                mediaUrl,
                mediaType,
                alternateId,
              });
            }
          }
        }
      });

      this.socket.ev.on("messages.update", (updates) => {
        for (const update of updates) {
          if (update.update.status) {
            const status = update.update.status;
            let statusStr: "sent" | "delivered" | "read" = "sent";
            if (status === 3) statusStr = "delivered";
            if (status === 4) statusStr = "read";
            
            this.eventHandlers?.onMessageSent(update.key.id || "", statusStr);
          }
        }
      });

    } catch (error) {
      console.error("WhatsApp connection error:", error);
      this.connectionState = "disconnected";
      this.eventHandlers?.onConnectionUpdate("disconnected");
    }
  }

  private async fetchAllChatsWithMessages(): Promise<void> {
    // This is a placeholder - the actual message fetching happens via 
    // messaging-history.set event which fires on fresh login
    // For existing sessions, we log that a full sync requires re-authentication
    console.log("Connected to existing session. For full history sync, logout and scan QR again.");
  }

  async disconnect(): Promise<void> {
    // Stop auto-reconnection and clear all timeouts
    this.stopReconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearQrTimeout();
    this.stopHealthCheck();
    
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.connectionState = "disconnected";
    this.eventHandlers?.onConnectionUpdate("disconnected");
    console.log("WhatsApp disconnected manually. Auto-reconnect disabled.");
  }

  async logout(): Promise<void> {
    // Stop auto-reconnection and clear all timeouts
    this.stopReconnect = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearQrTimeout();
    this.stopHealthCheck();
    
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    this.clearConnectedFlag();
    await this.clearAuthData();
    this.connectionState = "disconnected";
    this.eventHandlers?.onConnectionUpdate("disconnected");
    console.log("WhatsApp logged out. Credentials cleared.");
  }

  private async clearAuthData(): Promise<void> {
    try {
      // Use the database-backed clear function if available
      if (this.clearCredsFunc) {
        await this.clearCredsFunc();
      } else {
        // Fallback to direct database clear
        await clearDbAuthCreds();
      }
    } catch (error) {
      console.error("Error clearing auth data:", error);
    }
  }

  async sendMessage(to: string, content: string, options?: { bypassRateLimit?: boolean }): Promise<{ messageId: string; success: boolean; rateLimited?: boolean; waitMs?: number }> {
    if (!this.socket || this.connectionState !== "connected") {
      return { messageId: "", success: false };
    }

    const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;

    // Check rate limit (unless bypassed for system messages)
    if (!options?.bypassRateLimit) {
      const rateCheck = this.canSendMessage(jid);
      if (!rateCheck.allowed) {
        if (!this.rateLimitWarningShown) {
          console.warn(`WhatsApp rate limit active: ${rateCheck.reason}. Wait ${Math.round((rateCheck.waitMs || 0) / 1000)}s`);
          this.rateLimitWarningShown = true;
        }
        return { 
          messageId: "", 
          success: false, 
          rateLimited: true, 
          waitMs: rateCheck.waitMs 
        };
      }
    }

    try {
      const result = await this.socket.sendMessage(jid, { text: content });
      
      // Record send for rate limiting (with contact JID for per-contact spacing)
      this.recordMessageSend(jid);
      
      // Reset rate limit warning flag after successful send
      this.rateLimitWarningShown = false;
      
      return {
        messageId: result?.key?.id || "",
        success: true,
      };
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
      return { messageId: "", success: false };
    }
  }

  // Get current rate limit status for monitoring
  getRateLimitStatus(): { 
    messagesLastMinute: number; 
    messagesLastHour: number; 
    messagesLastDay: number;
    dailyLimit: number;
    minuteLimit: number;
    hourLimit: number;
    canSend: boolean;
  } {
    const now = Date.now();
    this.checkDailyReset();
    const messagesLastMinute = this.messageSendTimes.filter(t => now - t < 60000).length;
    const messagesLastHour = this.messageSendTimes.filter(t => now - t < 3600000).length;
    const canSend = this.canSendMessage().allowed;
    return { 
      messagesLastMinute, 
      messagesLastHour, 
      messagesLastDay: this.dailyMessageCount,
      dailyLimit: this.MAX_MESSAGES_PER_DAY,
      minuteLimit: this.MAX_MESSAGES_PER_MINUTE,
      hourLimit: this.MAX_MESSAGES_PER_HOUR,
      canSend 
    };
  }

  async getProfilePicture(jid: string): Promise<string | null> {
    if (!this.socket || this.connectionState !== "connected") {
      return null;
    }

    try {
      const fullJid = jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
      const url = await this.socket.profilePictureUrl(fullJid, "image");
      return url || null;
    } catch {
      return null;
    }
  }
}

export const whatsappService = new WhatsAppService();
