import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, pgEnum, index, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Platform enum for messaging channels
export const platformEnum = pgEnum("platform", ["whatsapp", "instagram", "facebook"]);

// Message direction enum
export const messageDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);

// Message status enum
export const messageStatusEnum = pgEnum("message_status", ["sent", "delivered", "read", "failed"]);

// Contacts table - stores customer/contact information
export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platformId: text("platform_id").notNull(),
  platform: platformEnum("platform").notNull(),
  name: text("name"),
  phoneNumber: text("phone_number"),
  whatsappLid: text("whatsapp_lid"), // WhatsApp Linked ID (internal identifier, separate from phone)
  email: text("email"),
  profilePictureUrl: text("profile_picture_url"),
  isBlocked: boolean("is_blocked").default(false),
  isFavorite: boolean("is_favorite").default(false),
  tags: text("tags").array(),
  notes: text("notes"),
  metadata: text("metadata"),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("contacts_platform_id_idx").on(table.platformId, table.platform),
  index("contacts_name_idx").on(table.name),
  index("contacts_is_favorite_idx").on(table.isFavorite),
  index("contacts_whatsapp_lid_idx").on(table.whatsappLid),
]);

// Conversations table - represents a thread with a contact
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  platform: platformEnum("platform").notNull(),
  departmentId: varchar("department_id"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: text("last_message_preview"),
  lastAutoReplyAt: timestamp("last_auto_reply_at"),
  unreadCount: integer("unread_count").default(0),
  isArchived: boolean("is_archived").default(false),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("conversations_contact_id_idx").on(table.contactId),
  index("conversations_platform_idx").on(table.platform),
  index("conversations_last_message_at_idx").on(table.lastMessageAt),
  index("conversations_department_id_idx").on(table.departmentId),
]);

// Messages table - individual messages in a conversation
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  externalId: text("external_id"),
  direction: messageDirectionEnum("direction").notNull(),
  content: text("content"),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  status: messageStatusEnum("status").default("sent"),
  timestamp: timestamp("timestamp").defaultNow(),
  metadata: text("metadata"),
}, (table) => [
  index("messages_conversation_id_idx").on(table.conversationId),
  index("messages_timestamp_idx").on(table.timestamp),
  index("messages_external_id_idx").on(table.externalId),
  index("messages_conversation_timestamp_idx").on(table.conversationId, table.timestamp),
]);

// Platform settings table - stores API credentials per platform
export const platformSettings = pgTable("platform_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  platform: platformEnum("platform").notNull().unique(),
  isConnected: boolean("is_connected").default(false),
  accessToken: text("access_token"),
  pageId: text("page_id"),
  phoneNumberId: text("phone_number_id"),
  businessId: text("business_id"),
  webhookVerifyToken: text("webhook_verify_token"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Quick replies table - pre-saved message templates
export const quickReplies = pgTable("quick_replies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  platform: platformEnum("platform"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Session table - used by express-session with connect-pg-simple
// This table is managed by connect-pg-simple, not by our app directly
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => [
  index("IDX_session_expire").on(table.expire),
]);

// Relations
export const contactsRelations = relations(contacts, ({ many }) => ({
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  contact: one(contacts, {
    fields: [conversations.contactId],
    references: [contacts.id],
  }),
  department: one(departments, {
    fields: [conversations.departmentId],
    references: [departments.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// Insert schemas
export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  platformId: true,
  platform: true,
}).partial();

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
});

export const insertPlatformSettingsSchema = createInsertSchema(platformSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertQuickReplySchema = createInsertSchema(quickReplies).omit({
  id: true,
  createdAt: true,
});

// Types
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type PlatformSettings = typeof platformSettings.$inferSelect;
export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;

export type QuickReply = typeof quickReplies.$inferSelect;
export type InsertQuickReply = z.infer<typeof insertQuickReplySchema>;

// Extended types for frontend
export type Platform = "whatsapp" | "instagram" | "facebook";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";

export type ConversationWithContact = Conversation & {
  contact: Contact;
};

export type ConversationWithMessages = Conversation & {
  contact: Contact;
  messages: Message[];
  hasMoreMessages?: boolean;
  totalMessages?: number;
};

// User role enum
export const userRoleEnum = pgEnum("user_role", ["superadmin", "admin", "user"]);

// Users table with roles
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: userRoleEnum("role").notNull().default("user"),
  displayName: text("display_name"),
  email: text("email"),
  isActive: boolean("is_active").default(true),
  isDeletable: boolean("is_deletable").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Departments table
export const departments = pgTable("departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User-Department join table
export const userDepartments = pgTable("user_departments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  departmentId: varchar("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("user_departments_user_idx").on(table.userId),
  index("user_departments_department_idx").on(table.departmentId),
]);

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  userDepartments: many(userDepartments),
}));

// Department relations
export const departmentsRelations = relations(departments, ({ many }) => ({
  userDepartments: many(userDepartments),
  conversations: many(conversations),
}));

// User-Department relations
export const userDepartmentsRelations = relations(userDepartments, ({ one }) => ({
  user: one(users, {
    fields: [userDepartments.userId],
    references: [users.id],
  }),
  department: one(departments, {
    fields: [userDepartments.departmentId],
    references: [departments.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDepartmentSchema = createInsertSchema(departments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserDepartmentSchema = createInsertSchema(userDepartments).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type UserRole = "superadmin" | "admin" | "user";

export type Department = typeof departments.$inferSelect;
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;

export type UserDepartment = typeof userDepartments.$inferSelect;
export type InsertUserDepartment = z.infer<typeof insertUserDepartmentSchema>;

export type UserWithDepartments = User & {
  departments: Department[];
};

// App Settings table - for storing application-wide settings like API keys
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value"),
  isValid: boolean("is_valid"),
  lastValidatedAt: timestamp("last_validated_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAppSettingSchema = createInsertSchema(appSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

// Blast campaign status enum
export const blastCampaignStatusEnum = pgEnum("blast_campaign_status", ["draft", "scheduled", "running", "paused", "completed", "cancelled"]);

// Blast message status enum  
// pending: waiting to be generated, awaiting_review: generated and waiting for admin review
// approved: reviewed and ready to send, sending/sent/failed: final states
export const blastMessageStatusEnum = pgEnum("blast_message_status", ["pending", "generating", "awaiting_review", "approved", "sending", "sent", "failed", "skipped"]);

// Blast campaigns table - stores campaign metadata and AI prompt
export const blastCampaigns = pgTable("blast_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  status: blastCampaignStatusEnum("status").notNull().default("draft"),
  totalRecipients: integer("total_recipients").default(0),
  generatedCount: integer("generated_count").default(0),
  sentCount: integer("sent_count").default(0),
  failedCount: integer("failed_count").default(0),
  generationFailedCount: integer("generation_failed_count").default(0),
  isGenerating: boolean("is_generating").default(false),
  minIntervalSeconds: integer("min_interval_seconds").default(120),
  maxIntervalSeconds: integer("max_interval_seconds").default(180),
  templateId: varchar("template_id").references(() => messageTemplates.id), // Twilio template with {{1}}=name, {{2}}=AI message
  createdBy: varchar("created_by").references(() => users.id),
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("blast_campaigns_status_idx").on(table.status),
  index("blast_campaigns_created_by_idx").on(table.createdBy),
]);

// Blast recipients table - links campaigns to contacts with per-recipient status
export const blastRecipients = pgTable("blast_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => blastCampaigns.id, { onDelete: "cascade" }),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  conversationId: varchar("conversation_id").references(() => conversations.id),
  status: blastMessageStatusEnum("status").notNull().default("pending"),
  generatedMessage: text("generated_message"),
  reviewedMessage: text("reviewed_message"), // Admin-edited message (used instead of generatedMessage if set)
  reviewedBy: varchar("reviewed_by").references(() => users.id), // Who reviewed/approved
  generatedAt: timestamp("generated_at"), // When AI generated the message
  approvedAt: timestamp("approved_at"), // When admin approved for sending
  errorMessage: text("error_message"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("blast_recipients_campaign_idx").on(table.campaignId),
  index("blast_recipients_contact_idx").on(table.contactId),
  index("blast_recipients_status_idx").on(table.status),
  index("blast_recipients_scheduled_idx").on(table.scheduledAt),
  index("blast_recipients_campaign_status_idx").on(table.campaignId, table.status), // For efficient queue queries
]);

// Blast campaign relations
export const blastCampaignsRelations = relations(blastCampaigns, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [blastCampaigns.createdBy],
    references: [users.id],
  }),
  recipients: many(blastRecipients),
}));

// Blast recipient relations
export const blastRecipientsRelations = relations(blastRecipients, ({ one }) => ({
  campaign: one(blastCampaigns, {
    fields: [blastRecipients.campaignId],
    references: [blastCampaigns.id],
  }),
  contact: one(contacts, {
    fields: [blastRecipients.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [blastRecipients.conversationId],
    references: [conversations.id],
  }),
}));

// Insert schemas for blast tables
export const insertBlastCampaignSchema = createInsertSchema(blastCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentCount: true,
  failedCount: true,
  startedAt: true,
  completedAt: true,
});

export const insertBlastRecipientSchema = createInsertSchema(blastRecipients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  generatedMessage: true,
  errorMessage: true,
  sentAt: true,
  retryCount: true,
});

// Types for blast tables
export type BlastCampaign = typeof blastCampaigns.$inferSelect;
export type InsertBlastCampaign = z.infer<typeof insertBlastCampaignSchema>;
export type BlastCampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";

export type BlastRecipient = typeof blastRecipients.$inferSelect;
export type InsertBlastRecipient = z.infer<typeof insertBlastRecipientSchema>;
export type BlastMessageStatus = "pending" | "generating" | "awaiting_review" | "approved" | "sending" | "sent" | "failed" | "skipped";

export type BlastCampaignWithRecipients = BlastCampaign & {
  recipients: (BlastRecipient & { contact: Contact })[];
};

export type BlastCampaignWithStats = BlastCampaign & {
  pendingCount: number;
  generatingCount: number;
  awaitingReviewCount: number;
  approvedCount: number;
  sendingCount: number;
  skippedCount: number;
};

// WhatsApp auth state storage for session persistence
export const whatsappAuthState = pgTable("whatsapp_auth_state", {
  key: varchar("key", { length: 255 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WhatsAppAuthState = typeof whatsappAuthState.$inferSelect;
export type InsertWhatsAppAuthState = typeof whatsappAuthState.$inferInsert;

// ============= EXTERNAL API TABLES =============

// API clients table - stores API keys for external apps
export const apiClients = pgTable("api_clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // Friendly name for the API client
  clientId: text("client_id").notNull().unique(), // Public client ID for X-Client-Id header
  secretHash: text("secret_hash").notNull(), // Hashed secret key (never store plain)
  isActive: boolean("is_active").default(true),
  aiPrompt: text("ai_prompt"), // Custom AI prompt for this client's message personalization
  defaultTemplateId: varchar("default_template_id").references(() => messageTemplates.id), // Default template for this client
  rateLimitPerMinute: integer("rate_limit_per_minute").default(60),
  rateLimitPerDay: integer("rate_limit_per_day").default(1000),
  requestCountToday: integer("request_count_today").default(0),
  lastRequestAt: timestamp("last_request_at"),
  lastResetAt: timestamp("last_reset_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
  ipWhitelist: text("ip_whitelist").array(), // Optional IP whitelist
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("api_clients_client_id_idx").on(table.clientId),
  index("api_clients_is_active_idx").on(table.isActive),
]);

// API message queue status enum
export const apiMessageStatusEnum = pgEnum("api_message_status", [
  "queued",      // Message received and queued
  "processing",  // Being processed
  "sending",     // Being sent via WhatsApp
  "sent",        // Successfully sent
  "failed",      // Failed to send
]);

// API message queue table - external API message queue
export const apiMessageQueue = pgTable("api_message_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  requestId: text("request_id").notNull().unique(), // Unique request ID from external app
  clientId: varchar("client_id").notNull().references(() => apiClients.id),
  phoneNumber: text("phone_number").notNull(), // Destination phone number
  recipientName: text("recipient_name"), // Optional recipient name for AI personalization
  message: text("message").notNull(), // Message content
  status: apiMessageStatusEnum("status").notNull().default("queued"),
  priority: integer("priority").default(0), // Higher = processed first
  contactId: varchar("contact_id").references(() => contacts.id), // Linked contact if found
  conversationId: varchar("conversation_id").references(() => conversations.id), // Linked conversation if found
  templateId: varchar("template_id").references(() => messageTemplates.id), // Template to use for sending (stores twilioContentSid)
  errorMessage: text("error_message"),
  externalMessageId: text("external_message_id"), // WhatsApp message ID after sending
  metadata: text("metadata"), // Optional JSON metadata from API caller
  scheduledAt: timestamp("scheduled_at"), // When to send (null = ASAP within quiet hours)
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("api_message_queue_status_idx").on(table.status),
  index("api_message_queue_client_idx").on(table.clientId),
  index("api_message_queue_request_idx").on(table.requestId),
  index("api_message_queue_scheduled_idx").on(table.scheduledAt),
  index("api_message_queue_priority_status_idx").on(table.priority, table.status),
]);

// API request logs for audit trail
export const apiRequestLogs = pgTable("api_request_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => apiClients.id),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  requestBody: text("request_body"), // Sanitized request body
  responseStatus: integer("response_status"),
  responseBody: text("response_body"), // Sanitized response
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("api_request_logs_client_idx").on(table.clientId),
  index("api_request_logs_created_idx").on(table.createdAt),
]);

// API clients relations
export const apiClientsRelations = relations(apiClients, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [apiClients.createdBy],
    references: [users.id],
  }),
  messageQueue: many(apiMessageQueue),
  requestLogs: many(apiRequestLogs),
}));

// API message queue relations
export const apiMessageQueueRelations = relations(apiMessageQueue, ({ one }) => ({
  client: one(apiClients, {
    fields: [apiMessageQueue.clientId],
    references: [apiClients.id],
  }),
  contact: one(contacts, {
    fields: [apiMessageQueue.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [apiMessageQueue.conversationId],
    references: [conversations.id],
  }),
}));

// API request logs relations
export const apiRequestLogsRelations = relations(apiRequestLogs, ({ one }) => ({
  client: one(apiClients, {
    fields: [apiRequestLogs.clientId],
    references: [apiClients.id],
  }),
}));

// Insert schemas for API tables
export const insertApiClientSchema = createInsertSchema(apiClients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  requestCountToday: true,
  lastRequestAt: true,
  lastResetAt: true,
});

export const insertApiMessageQueueSchema = createInsertSchema(apiMessageQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  contactId: true,
  conversationId: true,
  errorMessage: true,
  externalMessageId: true,
  sentAt: true,
});

// Types for API tables
export type ApiClient = typeof apiClients.$inferSelect;
export type InsertApiClient = z.infer<typeof insertApiClientSchema>;

export type ApiMessageQueue = typeof apiMessageQueue.$inferSelect;
export type InsertApiMessageQueue = z.infer<typeof insertApiMessageQueueSchema>;
export type ApiMessageStatus = "queued" | "processing" | "sending" | "sent" | "failed";

export type ApiRequestLog = typeof apiRequestLogs.$inferSelect;

export type ApiClientWithStats = ApiClient & {
  queuedCount: number;
  sentTodayCount: number;
  failedTodayCount: number;
};

// Shortened URLs table - for masking invoice URLs to avoid WhatsApp detection
export const shortenedUrls = pgTable("shortened_urls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shortCode: varchar("short_code", { length: 10 }).notNull().unique(),
  originalUrl: text("original_url").notNull(),
  clickCount: integer("click_count").default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
  clientId: varchar("client_id").references(() => apiClients.id),
}, (table) => [
  index("shortened_urls_short_code_idx").on(table.shortCode),
  index("shortened_urls_client_id_idx").on(table.clientId),
]);

export const insertShortenedUrlSchema = createInsertSchema(shortenedUrls).omit({
  id: true,
  clickCount: true,
  createdAt: true,
});

export type ShortenedUrl = typeof shortenedUrls.$inferSelect;
export type InsertShortenedUrl = z.infer<typeof insertShortenedUrlSchema>;

// ============= MESSAGE TEMPLATES =============

// Trigger rule type for template matching
export type TriggerRule = {
  field: string;       // Field to check (e.g., "message", "variables.invoice_number")
  operator: "contains" | "equals" | "startsWith" | "endsWith" | "exists" | "regex";
  value?: string;      // Value to match (not needed for "exists")
};

// Message templates for external API - reusable templates with variables
export const messageTemplates = pgTable("message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 100 }).notNull().unique(), // Template identifier (e.g., "invoice", "payment_reminder")
  description: text("description"), // Human-readable description
  content: text("content").notNull(), // Template content with {{variable}} placeholders
  variables: text("variables").array(), // List of required variable names
  category: varchar("category", { length: 50 }), // Category for organization (e.g., "billing", "notification")
  isActive: boolean("is_active").default(true),
  isSystemTemplate: boolean("is_system_template").default(false), // System templates cannot be deleted (e.g., blast template)
  createdBy: varchar("created_by").references(() => users.id),
  // Template selection fields (3-tier priority: message type → trigger rules → default)
  messageType: varchar("message_type", { length: 50 }), // Message type this template handles (e.g., "invoice", "reminder")
  triggerRules: json("trigger_rules").$type<TriggerRule[]>(), // Trigger rules for matching messages
  isDefault: boolean("is_default").default(false), // Fallback template when no match found
  priority: integer("priority").default(0), // Higher priority = checked first
  // Twilio Content API sync fields
  twilioContentSid: varchar("twilio_content_sid", { length: 50 }), // Twilio Content SID (HXXX...)
  twilioApprovalStatus: varchar("twilio_approval_status", { length: 20 }), // received, pending, approved, rejected
  twilioRejectionReason: text("twilio_rejection_reason"), // Reason if rejected
  twilioSyncedAt: timestamp("twilio_synced_at"), // When template was synced to Twilio
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("message_templates_name_idx").on(table.name),
  index("message_templates_category_idx").on(table.category),
  index("message_templates_message_type_idx").on(table.messageType),
  index("message_templates_is_default_idx").on(table.isDefault),
]);

export const insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = z.infer<typeof insertMessageTemplateSchema>;
