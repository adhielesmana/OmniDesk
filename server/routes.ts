import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { storage } from "./storage";
import { MetaApiService, type WebhookMessage } from "./meta-api";
import { whatsappService } from "./whatsapp";
import { updateContactSchema, type Platform } from "@shared/schema";

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

  // Get all conversations
  app.get("/api/conversations", async (req, res) => {
    try {
      const conversations = await storage.getConversations();
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
  app.get("/api/contacts", async (req, res) => {
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

  app.get("/api/contacts/tags", async (req, res) => {
    try {
      const tags = await storage.getAllTags();
      res.json(tags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  app.get("/api/contacts/:id", async (req, res) => {
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

  app.patch("/api/contacts/:id", async (req, res) => {
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

  app.get("/api/contacts/:id/conversations", async (req, res) => {
    try {
      const conversations = await storage.getConversationsByContactId(req.params.id);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching contact conversations:", error);
      res.status(500).json({ error: "Failed to fetch contact conversations" });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      await storage.deleteContact(req.params.id);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting contact:", error);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  app.post("/api/contacts/:id/favorite", async (req, res) => {
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

  app.post("/api/contacts/:id/block", async (req, res) => {
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

  app.post("/api/contacts/:id/tags", async (req, res) => {
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

  app.delete("/api/contacts/:id/tags/:tag", async (req, res) => {
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

        let contact = await storage.getContactByPlatformId(msg.from, "whatsapp");
        if (!contact) {
          contact = await storage.createContact({
            platformId: msg.from,
            platform: "whatsapp",
            name: msg.fromName,
            phoneNumber: `+${msg.from}`,
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
          const phoneNumber = chat.jid.replace("@s.whatsapp.net", "");
          
          let contact = await storage.getContactByPlatformId(phoneNumber, "whatsapp");
          if (!contact) {
            contact = await storage.createContact({
              platformId: phoneNumber,
              platform: "whatsapp",
              name: chat.name,
              phoneNumber: `+${phoneNumber}`,
            });
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

          let contact = await storage.getContactByPlatformId(msg.from, "whatsapp");
          if (!contact) {
            contact = await storage.createContact({
              platformId: msg.from,
              platform: "whatsapp",
              name: msg.fromName,
              phoneNumber: `+${msg.from}`,
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
      
      for (const waContact of contacts) {
        try {
          const phoneNumber = waContact.jid.replace("@s.whatsapp.net", "");
          
          // Find existing contact by platform ID
          const existingContact = await storage.getContactByPlatformId(phoneNumber, "whatsapp");
          
          if (existingContact) {
            const currentName = existingContact.name;
            const newName = waContact.name;
            
            // Skip if new name is just the phone number or looks like a jid
            if (newName.includes("@") || newName === phoneNumber) {
              continue;
            }
            
            // Update if current name is empty, undefined, or looks like a jid/phone number
            const needsUpdate = !currentName || 
              currentName.includes("@") || 
              currentName === `+${phoneNumber}` || 
              currentName === phoneNumber ||
              currentName.match(/^\+?\d+$/);
            
            if (needsUpdate) {
              await storage.updateContact(existingContact.id, {
                name: newName,
              });
              updatedCount++;
            }
          }
        } catch (error) {
          console.error("Error syncing contact:", error);
        }
      }
      
      console.log(`Updated ${updatedCount} contact names from phone book`);
      if (updatedCount > 0) {
        broadcast({ type: "contacts_synced", count: updatedCount });
      }
    },
  });

  // Auto-reconnect WhatsApp if credentials exist on server startup
  if (whatsappService.hasExistingAuth()) {
    console.log("Found existing WhatsApp credentials, auto-connecting...");
    whatsappService.connect().catch((error) => {
      console.error("Auto-connect failed:", error);
    });
  }

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
