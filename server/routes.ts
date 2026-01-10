import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { MetaApiService, type WebhookMessage } from "./meta-api";
import type { Platform } from "@shared/schema";

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

      // Get platform settings
      const settings = await storage.getPlatformSetting(conversation.platform);
      if (!settings?.isConnected || !settings.accessToken) {
        // Create message anyway but mark as failed
        const message = await storage.createMessage({
          conversationId,
          direction: "outbound",
          content,
          mediaUrl,
          status: "failed",
          timestamp: new Date(),
        });
        return res.json(message);
      }

      // Send via Meta API
      const metaApi = new MetaApiService(conversation.platform, {
        accessToken: settings.accessToken,
        phoneNumberId: settings.phoneNumberId || undefined,
        pageId: settings.pageId || undefined,
        businessId: settings.businessId || undefined,
      });

      const result = await metaApi.sendMessage(conversation.contact.platformId, content);

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

  return httpServer;
}
