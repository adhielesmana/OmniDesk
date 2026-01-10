import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  BaileysEventMap,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as QRCode from "qrcode";
import pino from "pino";
import path from "path";
import fs from "fs";

export type WhatsAppConnectionState = "disconnected" | "connecting" | "qr" | "connected";

export interface WhatsAppEventHandlers {
  onQR: (qrDataUrl: string) => void;
  onConnectionUpdate: (state: WhatsAppConnectionState) => void;
  onMessage: (message: {
    from: string;
    fromName: string;
    content: string;
    timestamp: Date;
    messageId: string;
    isGroup: boolean;
  }) => void;
  onMessageSent: (messageId: string, status: "sent" | "delivered" | "read") => void;
}

class WhatsAppService {
  private socket: WASocket | null = null;
  private connectionState: WhatsAppConnectionState = "disconnected";
  private eventHandlers: WhatsAppEventHandlers | null = null;
  private authFolder = path.join(process.cwd(), ".whatsapp-auth");
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  getConnectionState(): WhatsAppConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return this.connectionState === "connected" && this.socket !== null;
  }

  setEventHandlers(handlers: WhatsAppEventHandlers) {
    this.eventHandlers = handlers;
  }

  async connect(): Promise<void> {
    if (this.connectionState === "connecting" || this.connectionState === "qr") {
      return;
    }

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
        browser: ["Unified Inbox", "Chrome", "1.0.0"],
      });

      this.socket.ev.on("creds.update", saveCreds);

      this.socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.connectionState = "qr";
          this.eventHandlers?.onConnectionUpdate("qr");
          
          const qrDataUrl = await QRCode.toDataURL(qr);
          this.eventHandlers?.onQR(qrDataUrl);
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.connectionState = "disconnected";
          this.eventHandlers?.onConnectionUpdate("disconnected");

          if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`WhatsApp reconnecting... attempt ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(), 3000);
          } else if (statusCode === DisconnectReason.loggedOut) {
            console.log("WhatsApp logged out, clearing auth data");
            await this.clearAuthData();
          }
        } else if (connection === "open") {
          this.connectionState = "connected";
          this.reconnectAttempts = 0;
          this.eventHandlers?.onConnectionUpdate("connected");
          console.log("WhatsApp connected successfully");
        }
      });

      this.socket.ev.on("messages.upsert", async (messageUpdate) => {
        for (const msg of messageUpdate.messages) {
          if (!msg.key.fromMe && msg.message) {
            const from = msg.key.remoteJid || "";
            const isGroup = from.endsWith("@g.us");
            
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
            }

            if (content) {
              this.eventHandlers?.onMessage({
                from: from.replace("@s.whatsapp.net", "").replace("@g.us", ""),
                fromName: msg.pushName || from,
                content,
                timestamp: new Date((msg.messageTimestamp as number) * 1000),
                messageId: msg.key.id || "",
                isGroup,
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

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this.connectionState = "disconnected";
    this.eventHandlers?.onConnectionUpdate("disconnected");
  }

  async logout(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    await this.clearAuthData();
    this.connectionState = "disconnected";
    this.eventHandlers?.onConnectionUpdate("disconnected");
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
