import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
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
  private authFolder = path.join(process.cwd(), ".whatsapp-auth");
  private mediaFolder = path.join(process.cwd(), "media", "whatsapp");
  private reconnectAttempts = 0;
  private reconnectDelay = 3000; // Start with 3 seconds
  private maxReconnectDelay = 60000; // Max 60 seconds between retries
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private stopReconnect = false; // Flag to stop auto-reconnection
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private qrTimeout: NodeJS.Timeout | null = null; // 5-minute timeout for QR scanning
  private readonly QR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Ensure media folder exists
    if (!fs.existsSync(this.mediaFolder)) {
      fs.mkdirSync(this.mediaFolder, { recursive: true });
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

  hasExistingAuth(): boolean {
    try {
      const credsPath = path.join(this.authFolder, "creds.json");
      return fs.existsSync(credsPath);
    } catch {
      return false;
    }
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
      if (!fs.existsSync(this.authFolder)) {
        fs.mkdirSync(this.authFolder, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);

      const logger = pino({ level: "silent" });

      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: ["OmniDesk", "Chrome", "1.0.0"],
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
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.connectionState = "disconnected";
          this.eventHandlers?.onConnectionUpdate("disconnected");
          this.stopHealthCheck();

          if (statusCode === DisconnectReason.loggedOut) {
            console.log("WhatsApp logged out, clearing auth data");
            this.reconnectAttempts = 0;
            this.reconnectDelay = 3000;
            this.stopReconnect = true;
            await this.clearAuthData();
          } else if (shouldReconnect && !this.stopReconnect) {
            this.reconnectAttempts++;
            // Exponential backoff: 3s, 6s, 12s, 24s, 48s, max 60s
            const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);
            console.log(`WhatsApp disconnected. Reconnecting in ${Math.round(delay / 1000)}s... (attempt ${this.reconnectAttempts})`);
            this.reconnectTimeout = setTimeout(() => this.connect(), delay);
          } else if (this.stopReconnect) {
            console.log("WhatsApp disconnected. Auto-reconnect disabled.");
          }
        } else if (connection === "open") {
          // Clear QR timeout - successfully connected
          this.clearQrTimeout();
          
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.reconnectDelay = 3000;
          this.eventHandlers?.onConnectionUpdate("connected");
          console.log("WhatsApp connected successfully");
          
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
    await this.clearAuthData();
    this.connectionState = "disconnected";
    this.eventHandlers?.onConnectionUpdate("disconnected");
    console.log("WhatsApp logged out. Credentials cleared.");
  }

  private async clearAuthData(): Promise<void> {
    try {
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
      }
    } catch (error) {
      console.error("Error clearing auth data:", error);
    }
  }

  async sendMessage(to: string, content: string): Promise<{ messageId: string; success: boolean }> {
    if (!this.socket || this.connectionState !== "connected") {
      return { messageId: "", success: false };
    }

    try {
      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
      const result = await this.socket.sendMessage(jid, { text: content });
      
      return {
        messageId: result?.key?.id || "",
        success: true,
      };
    } catch (error) {
      console.error("Error sending WhatsApp message:", error);
      return { messageId: "", success: false };
    }
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
