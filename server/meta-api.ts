import type { Platform } from "@shared/schema";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface MetaApiConfig {
  accessToken: string;
  phoneNumberId?: string;
  pageId?: string;
  businessId?: string;
}

interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface WebhookMessage {
  platform: Platform;
  senderId: string;
  senderName?: string;
  recipientId?: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
  timestamp: Date;
  externalId: string;
  isEcho?: boolean;
}

export class MetaApiService {
  private config: MetaApiConfig;
  private platform: Platform;

  constructor(platform: Platform, config: MetaApiConfig) {
    this.platform = platform;
    this.config = config;
  }

  validateConfig(): { valid: boolean; error?: string } {
    if (!this.config.accessToken) {
      return { valid: false, error: "Access token is required" };
    }

    switch (this.platform) {
      case "whatsapp":
        if (!this.config.phoneNumberId) {
          return { valid: false, error: "Phone Number ID is required for WhatsApp" };
        }
        break;
      case "instagram":
        // Instagram can use either businessId or pageId (when same Page is connected to Instagram)
        if (!this.config.businessId && !this.config.pageId) {
          return { valid: false, error: "Instagram Business Account ID or Page ID is required for Instagram" };
        }
        break;
      case "facebook":
        if (!this.config.pageId) {
          return { valid: false, error: "Page ID is required for Facebook" };
        }
        break;
    }

    return { valid: true };
  }

  async sendMessage(recipientId: string, content: string): Promise<SendMessageResult> {
    const validation = this.validateConfig();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      let url: string;
      let payload: Record<string, unknown>;

      switch (this.platform) {
        case "whatsapp":
          url = `${GRAPH_API_BASE}/${this.config.phoneNumberId}/messages`;
          payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientId,
            type: "text",
            text: { 
              preview_url: false,
              body: content 
            },
          };
          break;

        case "instagram":
          // Instagram uses Page ID or Instagram Business Account ID
          // Fall back to pageId if businessId is not set (common when using same Page for both)
          const instagramAccountId = this.config.businessId || this.config.pageId;
          if (!instagramAccountId) {
            return { success: false, error: "Instagram Business Account ID or Page ID is required" };
          }
          url = `${GRAPH_API_BASE}/${instagramAccountId}/messages`;
          payload = {
            recipient: { id: recipientId },
            message: { text: content },
          };
          console.log(`Sending Instagram message to ${recipientId} via account ${instagramAccountId}`);
          break;

        case "facebook":
          url = `${GRAPH_API_BASE}/${this.config.pageId}/messages`;
          payload = {
            recipient: { id: recipientId },
            messaging_type: "RESPONSE",
            message: { text: content },
          };
          console.log(`[Meta API] Sending Facebook message to ${recipientId} via page ${this.config.pageId}`);
          break;

        default:
          return { success: false, error: "Unsupported platform" };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(`[Meta API] Error sending ${this.platform} message:`, JSON.stringify(data, null, 2));
        const errorCode = data.error?.code;
        const errorSubcode = data.error?.error_subcode;
        let errorMessage = data.error?.message || `API Error: ${response.status}`;
        
        // Add more helpful error context
        if (errorCode === 10 || errorCode === 200) {
          errorMessage = `Permission denied: ${errorMessage}. Check that your access token has the 'pages_messaging' permission.`;
        } else if (errorCode === 190) {
          errorMessage = `Access token expired or invalid. Please update your Facebook access token in Settings.`;
        } else if (errorCode === 100 && errorSubcode === 2018109) {
          errorMessage = `Cannot message this user: They haven't messaged your page recently or haven't opted in. Users must initiate contact first.`;
        }
        
        return {
          success: false,
          error: errorMessage,
        };
      }

      return {
        success: true,
        messageId: data.messages?.[0]?.id || data.message_id,
      };
    } catch (error) {
      console.error("Meta API request error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendMedia(
    recipientId: string,
    mediaUrl: string,
    mediaType: "image" | "video" | "document" | "audio",
    caption?: string
  ): Promise<SendMessageResult> {
    const validation = this.validateConfig();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      if (this.platform === "whatsapp") {
        const url = `${GRAPH_API_BASE}/${this.config.phoneNumberId}/messages`;
        const payload = {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientId,
          type: mediaType,
          [mediaType]: {
            link: mediaUrl,
            ...(caption && { caption }),
          },
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: data.error?.message || "Failed to send media",
          };
        }

        return {
          success: true,
          messageId: data.messages?.[0]?.id,
        };
      } else if (this.platform === "facebook" || this.platform === "instagram") {
        const url = this.platform === "facebook" 
          ? `${GRAPH_API_BASE}/${this.config.pageId}/messages`
          : `${GRAPH_API_BASE}/${this.config.businessId}/messages`;
        
        const payload = {
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message: {
            attachment: {
              type: mediaType === "document" ? "file" : mediaType,
              payload: { url: mediaUrl, is_reusable: false },
            },
          },
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          return {
            success: false,
            error: data.error?.message || "Failed to send media",
          };
        }

        return {
          success: true,
          messageId: data.message_id,
        };
      }

      return { success: false, error: "Media sending not supported for this platform" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string; details?: unknown }> {
    const validation = this.validateConfig();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      let url: string;
      let fields: string;

      switch (this.platform) {
        case "whatsapp":
          url = `${GRAPH_API_BASE}/${this.config.phoneNumberId}`;
          fields = "display_phone_number,verified_name,quality_rating";
          break;
        case "instagram":
          url = `${GRAPH_API_BASE}/${this.config.businessId}`;
          fields = "name,username,profile_picture_url";
          break;
        case "facebook":
          url = `${GRAPH_API_BASE}/${this.config.pageId}`;
          fields = "name,id,access_token";
          break;
        default:
          return { success: false, error: "Unsupported platform" };
      }

      const response = await fetch(`${url}?fields=${fields}`, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error?.message || "Connection test failed",
        };
      }

      return { success: true, details: data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Fetch user profile info from Meta Graph API
  async getUserProfile(userId: string): Promise<{ name?: string; profilePicture?: string } | null> {
    try {
      let fields = "name";
      
      // For Messenger/Instagram, we can try to get profile picture
      if (this.platform === "facebook") {
        fields = "name,profile_pic";
      } else if (this.platform === "instagram") {
        fields = "name,username,profile_picture_url";
      }

      const url = `${GRAPH_API_BASE}/${userId}?fields=${fields}`;
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!response.ok) {
        console.error("Failed to fetch user profile:", await response.text());
        return null;
      }

      const data = await response.json();
      
      return {
        name: data.name || data.username,
        profilePicture: data.profile_pic || data.profile_picture_url,
      };
    } catch (error) {
      console.error("Error fetching user profile:", error);
      return null;
    }
  }

  // Fetch Facebook/Instagram conversations with messages
  async fetchConversations(limit: number = 25): Promise<{
    conversations: Array<{
      id: string;
      participants: Array<{ id: string; name?: string; email?: string }>;
      messages: Array<{
        id: string;
        message: string;
        from: { id: string; name?: string; email?: string };
        to: { data: Array<{ id: string; name?: string }> };
        created_time: string;
      }>;
      updated_time: string;
    }>;
    error?: string;
  }> {
    try {
      if (this.platform !== "facebook" && this.platform !== "instagram") {
        return { conversations: [], error: "Only Facebook and Instagram support conversation sync" };
      }

      const entityId = this.platform === "facebook" ? this.config.pageId : this.config.businessId;
      
      // First fetch conversations
      const conversationsUrl = `${GRAPH_API_BASE}/${entityId}/conversations?fields=participants,updated_time,messages.limit(50){id,message,from,to,created_time}&limit=${limit}`;
      
      console.log(`Fetching ${this.platform} conversations from: ${conversationsUrl}`);
      
      const response = await fetch(conversationsUrl, {
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error fetching conversations:", errorData);
        return { 
          conversations: [], 
          error: errorData.error?.message || `API error: ${response.status}` 
        };
      }

      const data = await response.json();
      return { conversations: data.data || [] };
    } catch (error) {
      console.error("Error in fetchConversations:", error);
      return { 
        conversations: [], 
        error: error instanceof Error ? error.message : "Unknown error" 
      };
    }
  }

  static parseWhatsAppWebhook(body: any): WebhookMessage | null {
    try {
      const entry = body.entry?.[0];
      if (!entry) return null;

      const changes = entry.changes?.[0];
      if (!changes) return null;

      const value = changes.value;
      if (!value) return null;

      const messages = value.messages;
      if (!messages || messages.length === 0) return null;

      const message = messages[0];
      const contact = value.contacts?.[0];

      let content: string | undefined;
      let mediaUrl: string | undefined;
      let mediaType: string | undefined;

      switch (message.type) {
        case "text":
          content = message.text?.body;
          break;
        case "image":
          mediaType = "image";
          mediaUrl = message.image?.id;
          content = message.image?.caption;
          break;
        case "video":
          mediaType = "video";
          mediaUrl = message.video?.id;
          content = message.video?.caption;
          break;
        case "audio":
          mediaType = "audio";
          mediaUrl = message.audio?.id;
          break;
        case "document":
          mediaType = "document";
          mediaUrl = message.document?.id;
          content = message.document?.caption || message.document?.filename;
          break;
        case "sticker":
          mediaType = "sticker";
          mediaUrl = message.sticker?.id;
          break;
        case "location":
          content = `Location: ${message.location?.latitude}, ${message.location?.longitude}`;
          break;
        case "contacts":
          content = `Contact: ${message.contacts?.[0]?.name?.formatted_name || "Unknown"}`;
          break;
        default:
          content = `[${message.type} message]`;
      }

      return {
        platform: "whatsapp",
        senderId: message.from,
        senderName: contact?.profile?.name,
        content,
        mediaUrl,
        mediaType,
        timestamp: new Date(parseInt(message.timestamp) * 1000),
        externalId: message.id,
      };
    } catch (error) {
      console.error("Error parsing WhatsApp webhook:", error);
      return null;
    }
  }

  static parseInstagramWebhook(body: any): WebhookMessage | null {
    try {
      const entry = body.entry?.[0];
      if (!entry) return null;

      const messaging = entry.messaging?.[0];
      if (!messaging || !messaging.message) return null;

      const message = messaging.message;
      let content: string | undefined;
      let mediaUrl: string | undefined;
      let mediaType: string | undefined;

      if (message.text) {
        content = message.text;
      }

      if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0];
        mediaType = attachment.type;
        mediaUrl = attachment.payload?.url;
      }

      if (message.is_deleted) {
        content = "[Message deleted]";
      }

      if (message.is_unsupported) {
        content = "[Unsupported message type]";
      }

      return {
        platform: "instagram",
        senderId: messaging.sender.id,
        content,
        mediaUrl,
        mediaType,
        timestamp: new Date(messaging.timestamp),
        externalId: message.mid,
      };
    } catch (error) {
      console.error("Error parsing Instagram webhook:", error);
      return null;
    }
  }

  static parseFacebookWebhook(body: any): WebhookMessage | null {
    try {
      const entry = body.entry?.[0];
      if (!entry) return null;

      const messaging = entry.messaging?.[0];
      if (!messaging || !messaging.message) return null;

      const message = messaging.message;
      let content: string | undefined;
      let mediaUrl: string | undefined;
      let mediaType: string | undefined;

      if (message.text) {
        content = message.text;
      }

      if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0];
        mediaType = attachment.type;
        mediaUrl = attachment.payload?.url;
        
        if (attachment.type === "fallback") {
          content = attachment.title || attachment.url || "[Shared content]";
        }
      }

      if (message.sticker_id) {
        mediaType = "sticker";
        content = "[Sticker]";
      }

      if (message.is_deleted) {
        content = "[Message deleted]";
      }

      const isEcho = message.is_echo === true;

      return {
        platform: "facebook",
        senderId: messaging.sender.id,
        recipientId: messaging.recipient?.id,
        content,
        mediaUrl,
        mediaType,
        timestamp: new Date(messaging.timestamp),
        externalId: message.mid,
        isEcho,
      };
    } catch (error) {
      console.error("Error parsing Facebook webhook:", error);
      return null;
    }
  }
}

export type { WebhookMessage, SendMessageResult };
