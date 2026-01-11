import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, pgEnum, index } from "drizzle-orm/pg-core";
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
]);

// Conversations table - represents a thread with a contact
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contactId: varchar("contact_id").notNull().references(() => contacts.id),
  platform: platformEnum("platform").notNull(),
  departmentId: varchar("department_id"),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: text("last_message_preview"),
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
export const blastMessageStatusEnum = pgEnum("blast_message_status", ["pending", "generating", "queued", "sending", "sent", "failed"]);

// Blast campaigns table - stores campaign metadata and AI prompt
export const blastCampaigns = pgTable("blast_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  status: blastCampaignStatusEnum("status").notNull().default("draft"),
  totalRecipients: integer("total_recipients").default(0),
  sentCount: integer("sent_count").default(0),
  failedCount: integer("failed_count").default(0),
  minIntervalSeconds: integer("min_interval_seconds").default(120),
  maxIntervalSeconds: integer("max_interval_seconds").default(180),
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
export type BlastMessageStatus = "pending" | "generating" | "queued" | "sending" | "sent" | "failed";

export type BlastCampaignWithRecipients = BlastCampaign & {
  recipients: (BlastRecipient & { contact: Contact })[];
};

export type BlastCampaignWithStats = BlastCampaign & {
  pendingCount: number;
  generatingCount: number;
  queuedCount: number;
  sendingCount: number;
};
