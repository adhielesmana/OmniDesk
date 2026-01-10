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

// Legacy user types (keeping for compatibility)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
