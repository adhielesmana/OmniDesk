import {
  type User,
  type InsertUser,
  type Contact,
  type InsertContact,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type PlatformSettings,
  type InsertPlatformSettings,
  type QuickReply,
  type InsertQuickReply,
  type Department,
  type InsertDepartment,
  type ConversationWithContact,
  type ConversationWithMessages,
  type Platform,
  users,
  contacts,
  conversations,
  messages,
  platformSettings,
  quickReplies,
  departments,
  userDepartments,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, sql, asc, inArray } from "drizzle-orm";

// Helper to extract canonical phone number from WhatsApp JID
function getCanonicalPhoneNumber(id: string): string {
  // Remove all WhatsApp suffixes
  let stripped = id
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "")
    .replace("@c.us", "")
    .replace("+", "");
  
  // Return just the digits
  return stripped;
}

// Helper to normalize WhatsApp JIDs to consistent phone number format
function normalizeWhatsAppId(id: string): string[] {
  const canonical = getCanonicalPhoneNumber(id);
  
  // Generate all possible variants for lookup
  const variants = new Set<string>();
  variants.add(canonical);
  variants.add(`${canonical}@s.whatsapp.net`);
  variants.add(`${canonical}@lid`);
  variants.add(`${canonical}@c.us`);
  variants.add(`+${canonical}`);
  
  return Array.from(variants);
}

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;

  // Departments
  getDepartment(id: string): Promise<Department | undefined>;
  getAllDepartments(): Promise<Department[]>;
  createDepartment(department: InsertDepartment): Promise<Department>;
  updateDepartment(id: string, department: Partial<InsertDepartment>): Promise<Department | undefined>;
  deleteDepartment(id: string): Promise<boolean>;

  // User-Department relationships
  getUserDepartments(userId: string): Promise<Department[]>;
  addUserToDepartment(userId: string, departmentId: string): Promise<void>;
  removeUserFromDepartment(userId: string, departmentId: string): Promise<void>;
  setUserDepartments(userId: string, departmentIds: string[]): Promise<void>;

  // Contacts
  getContact(id: string): Promise<Contact | undefined>;
  getContactByPlatformId(platformId: string, platform: Platform): Promise<Contact | undefined>;
  getAllContacts(options?: {
    search?: string;
    platform?: Platform;
    isFavorite?: boolean;
    isBlocked?: boolean;
    tag?: string;
    sortBy?: "name" | "lastContacted" | "createdAt";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<{ contacts: Contact[]; total: number }>;
  createContact(contact: InsertContact): Promise<Contact>;
  updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact | undefined>;
  deleteContact(id: string): Promise<void>;
  toggleFavorite(id: string): Promise<Contact | undefined>;
  toggleBlocked(id: string): Promise<Contact | undefined>;
  addTagToContact(id: string, tag: string): Promise<Contact | undefined>;
  removeTagFromContact(id: string, tag: string): Promise<Contact | undefined>;
  getAllTags(): Promise<string[]>;

  // Conversations
  getConversations(departmentIds?: string[]): Promise<ConversationWithContact[]>;
  getConversation(id: string): Promise<ConversationWithMessages | undefined>;
  getConversationByContactId(contactId: string): Promise<Conversation | undefined>;
  getConversationsByContactId(contactId: string): Promise<Conversation[]>;
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  updateConversation(id: string, conversation: Partial<InsertConversation>): Promise<Conversation | undefined>;
  markConversationAsRead(conversationId: string): Promise<void>;

  // Messages
  getMessages(conversationId: string): Promise<Message[]>;
  getMessage(id: string): Promise<Message | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  updateMessageStatus(id: string, status: Message["status"]): Promise<Message | undefined>;
  updateMessageStatusByExternalId(externalId: string, status: Message["status"]): Promise<Message | undefined>;

  // Platform Settings
  getPlatformSettings(): Promise<PlatformSettings[]>;
  getPlatformSetting(platform: Platform): Promise<PlatformSettings | undefined>;
  upsertPlatformSettings(settings: InsertPlatformSettings): Promise<PlatformSettings>;

  // Quick Replies
  getQuickReplies(): Promise<QuickReply[]>;
  createQuickReply(quickReply: InsertQuickReply): Promise<QuickReply>;
  deleteQuickReply(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(asc(users.username));
  }

  async updateUser(id: string, userData: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...userData, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.getUser(id);
    if (!user || !user.isDeletable) {
      return false;
    }
    await db.delete(users).where(eq(users.id, id));
    return true;
  }

  // Departments
  async getDepartment(id: string): Promise<Department | undefined> {
    const [dept] = await db.select().from(departments).where(eq(departments.id, id));
    return dept || undefined;
  }

  async getAllDepartments(): Promise<Department[]> {
    return db.select().from(departments).orderBy(asc(departments.name));
  }

  async createDepartment(department: InsertDepartment): Promise<Department> {
    const [newDept] = await db.insert(departments).values(department).returning();
    return newDept;
  }

  async updateDepartment(id: string, department: Partial<InsertDepartment>): Promise<Department | undefined> {
    const [updated] = await db
      .update(departments)
      .set({ ...department, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteDepartment(id: string): Promise<boolean> {
    await db.delete(departments).where(eq(departments.id, id));
    return true;
  }

  // User-Department relationships
  async getUserDepartments(userId: string): Promise<Department[]> {
    const result = await db
      .select({ department: departments })
      .from(userDepartments)
      .innerJoin(departments, eq(userDepartments.departmentId, departments.id))
      .where(eq(userDepartments.userId, userId));
    return result.map((r) => r.department);
  }

  async addUserToDepartment(userId: string, departmentId: string): Promise<void> {
    const existing = await db
      .select()
      .from(userDepartments)
      .where(and(eq(userDepartments.userId, userId), eq(userDepartments.departmentId, departmentId)));
    if (existing.length === 0) {
      await db.insert(userDepartments).values({ userId, departmentId });
    }
  }

  async removeUserFromDepartment(userId: string, departmentId: string): Promise<void> {
    await db
      .delete(userDepartments)
      .where(and(eq(userDepartments.userId, userId), eq(userDepartments.departmentId, departmentId)));
  }

  async setUserDepartments(userId: string, departmentIds: string[]): Promise<void> {
    await db.delete(userDepartments).where(eq(userDepartments.userId, userId));
    if (departmentIds.length > 0) {
      await db.insert(userDepartments).values(
        departmentIds.map((departmentId) => ({ userId, departmentId }))
      );
    }
  }

  // Contacts
  async getContact(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
  }

  async getContactByPlatformId(platformId: string, platform: Platform): Promise<Contact | undefined> {
    // For WhatsApp, search using normalized variants to handle different JID formats
    if (platform === "whatsapp") {
      const variants = normalizeWhatsAppId(platformId);
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(
          inArray(contacts.platformId, variants),
          eq(contacts.platform, platform)
        ));
      return contact || undefined;
    }
    
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.platformId, platformId), eq(contacts.platform, platform)));
    return contact || undefined;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [newContact] = await db.insert(contacts).values(contact).returning();
    return newContact;
  }

  async updateContact(id: string, contact: Partial<InsertContact>): Promise<Contact | undefined> {
    const [updated] = await db
      .update(contacts)
      .set({ ...contact, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async getAllContacts(options?: {
    search?: string;
    platform?: Platform;
    isFavorite?: boolean;
    isBlocked?: boolean;
    tag?: string;
    sortBy?: "name" | "lastContacted" | "createdAt";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  }): Promise<{ contacts: Contact[]; total: number }> {
    const conditions = [];

    if (options?.search) {
      conditions.push(
        or(
          ilike(contacts.name, `%${options.search}%`),
          ilike(contacts.phoneNumber, `%${options.search}%`),
          ilike(contacts.email, `%${options.search}%`)
        )
      );
    }

    if (options?.platform) {
      conditions.push(eq(contacts.platform, options.platform));
    }

    if (options?.isFavorite !== undefined) {
      conditions.push(eq(contacts.isFavorite, options.isFavorite));
    }

    if (options?.isBlocked !== undefined) {
      conditions.push(eq(contacts.isBlocked, options.isBlocked));
    }

    if (options?.tag) {
      conditions.push(sql`${options.tag} = ANY(${contacts.tags})`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(whereClause);

    // Determine sort column and order
    const sortColumn = options?.sortBy === "lastContacted" 
      ? contacts.lastContactedAt 
      : options?.sortBy === "name" 
        ? contacts.name 
        : contacts.createdAt;
    
    const sortFn = options?.sortOrder === "asc" ? asc : desc;

    // Get contacts with pagination
    const result = await db
      .select()
      .from(contacts)
      .where(whereClause)
      .orderBy(sortFn(sortColumn))
      .limit(options?.limit || 50)
      .offset(options?.offset || 0);

    return { contacts: result, total: count };
  }

  async deleteContact(id: string): Promise<void> {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  async toggleFavorite(id: string): Promise<Contact | undefined> {
    const contact = await this.getContact(id);
    if (!contact) return undefined;

    const [updated] = await db
      .update(contacts)
      .set({ isFavorite: !contact.isFavorite, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async toggleBlocked(id: string): Promise<Contact | undefined> {
    const contact = await this.getContact(id);
    if (!contact) return undefined;

    const [updated] = await db
      .update(contacts)
      .set({ isBlocked: !contact.isBlocked, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async addTagToContact(id: string, tag: string): Promise<Contact | undefined> {
    const contact = await this.getContact(id);
    if (!contact) return undefined;

    const currentTags = contact.tags || [];
    if (currentTags.includes(tag)) return contact;

    const [updated] = await db
      .update(contacts)
      .set({ tags: [...currentTags, tag], updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async removeTagFromContact(id: string, tag: string): Promise<Contact | undefined> {
    const contact = await this.getContact(id);
    if (!contact) return undefined;

    const currentTags = contact.tags || [];
    const [updated] = await db
      .update(contacts)
      .set({ tags: currentTags.filter(t => t !== tag), updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    return updated || undefined;
  }

  async getAllTags(): Promise<string[]> {
    const result = await db
      .select({ tags: contacts.tags })
      .from(contacts)
      .where(sql`${contacts.tags} IS NOT NULL AND array_length(${contacts.tags}, 1) > 0`);
    
    const allTags = new Set<string>();
    for (const row of result) {
      if (row.tags) {
        for (const tag of row.tags) {
          allTags.add(tag);
        }
      }
    }
    return Array.from(allTags).sort();
  }

  // Conversations
  async getConversations(departmentIds?: string[]): Promise<ConversationWithContact[]> {
    let whereClause = eq(conversations.isArchived, false);

    if (departmentIds !== undefined) {
      if (departmentIds.length === 0) {
        return [];
      }
      whereClause = and(
        eq(conversations.isArchived, false),
        or(
          inArray(conversations.departmentId, departmentIds),
          sql`${conversations.departmentId} IS NULL`
        )
      )!;
    }

    const result = await db
      .select()
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(whereClause)
      .orderBy(desc(conversations.lastMessageAt));

    return result.map((row) => ({
      ...row.conversations,
      contact: row.contacts!,
    }));
  }

  async getConversation(id: string): Promise<ConversationWithMessages | undefined> {
    const [row] = await db
      .select()
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, id));

    if (!row) return undefined;

    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(messages.timestamp);

    return {
      ...row.conversations,
      contact: row.contacts!,
      messages: conversationMessages,
    };
  }

  async getConversationByContactId(contactId: string): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, contactId));
    return conversation || undefined;
  }

  async getConversationsByContactId(contactId: string): Promise<Conversation[]> {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.contactId, contactId))
      .orderBy(desc(conversations.lastMessageAt));
  }

  async createConversation(conversation: InsertConversation): Promise<Conversation> {
    const [newConversation] = await db.insert(conversations).values(conversation).returning();
    return newConversation;
  }

  async updateConversation(
    id: string,
    conversation: Partial<InsertConversation>
  ): Promise<Conversation | undefined> {
    const [updated] = await db
      .update(conversations)
      .set({ ...conversation, updatedAt: new Date() })
      .where(eq(conversations.id, id))
      .returning();
    return updated || undefined;
  }

  // Messages
  async getMessages(conversationId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.timestamp);
  }

  async getMessage(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message || undefined;
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();
    
    // Get current conversation to update unread count
    const [currentConv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, message.conversationId));

    // Update conversation's last message info and unread count
    const updateData: Record<string, unknown> = {
      lastMessageAt: newMessage.timestamp,
      lastMessagePreview: newMessage.content?.slice(0, 100) || "[Media]",
      updatedAt: new Date(),
    };

    // Increment unread count for inbound messages
    if (message.direction === "inbound" && currentConv) {
      updateData.unreadCount = (currentConv.unreadCount || 0) + 1;
    }

    await db
      .update(conversations)
      .set(updateData)
      .where(eq(conversations.id, message.conversationId));

    return newMessage;
  }

  async markConversationAsRead(conversationId: string): Promise<void> {
    await db
      .update(conversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async updateMessageStatus(id: string, status: Message["status"]): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set({ status })
      .where(eq(messages.id, id))
      .returning();
    return updated || undefined;
  }

  async updateMessageStatusByExternalId(externalId: string, status: Message["status"]): Promise<Message | undefined> {
    const [updated] = await db
      .update(messages)
      .set({ status })
      .where(eq(messages.externalId, externalId))
      .returning();
    return updated || undefined;
  }

  async messageExistsByExternalId(externalId: string): Promise<boolean> {
    if (!externalId) return false;
    const [existing] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.externalId, externalId))
      .limit(1);
    return !!existing;
  }

  // Platform Settings
  async getPlatformSettings(): Promise<PlatformSettings[]> {
    return db.select().from(platformSettings);
  }

  async getPlatformSetting(platform: Platform): Promise<PlatformSettings | undefined> {
    const [setting] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.platform, platform));
    return setting || undefined;
  }

  async upsertPlatformSettings(settings: InsertPlatformSettings): Promise<PlatformSettings> {
    const existing = await this.getPlatformSetting(settings.platform!);
    
    if (existing) {
      const [updated] = await db
        .update(platformSettings)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(platformSettings.platform, settings.platform!))
        .returning();
      return updated;
    }

    const [newSettings] = await db.insert(platformSettings).values(settings).returning();
    return newSettings;
  }

  // Quick Replies
  async getQuickReplies(): Promise<QuickReply[]> {
    return db.select().from(quickReplies);
  }

  async createQuickReply(quickReply: InsertQuickReply): Promise<QuickReply> {
    const [newQuickReply] = await db.insert(quickReplies).values(quickReply).returning();
    return newQuickReply;
  }

  async deleteQuickReply(id: string): Promise<void> {
    await db.delete(quickReplies).where(eq(quickReplies.id, id));
  }
}

export const storage = new DatabaseStorage();
