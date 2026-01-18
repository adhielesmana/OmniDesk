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
  type AppSetting,
  type InsertAppSetting,
  type BlastCampaign,
  type InsertBlastCampaign,
  type BlastRecipient,
  type InsertBlastRecipient,
  type BlastCampaignStatus,
  type BlastMessageStatus,
  type ConversationWithContact,
  type ConversationWithMessages,
  type Platform,
  type ApiClient,
  type InsertApiClient,
  type ApiMessageQueue,
  type InsertApiMessageQueue,
  type ApiMessageStatus,
  type ApiRequestLog,
  shortenedUrls,
  type ShortenedUrl,
  type InsertShortenedUrl,
  messageTemplates,
  type MessageTemplate,
  type InsertMessageTemplate,
  users,
  contacts,
  conversations,
  messages,
  platformSettings,
  quickReplies,
  departments,
  userDepartments,
  appSettings,
  blastCampaigns,
  blastRecipients,
  apiClients,
  apiMessageQueue,
  apiRequestLogs,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, or, ilike, sql, asc, inArray, isNull, lte } from "drizzle-orm";

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
  getContactByPhoneNumber(phoneNumber: string): Promise<Contact | undefined>;
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
  getOlderMessages(conversationId: string, beforeTimestamp: Date, beforeId: string, limit?: number): Promise<{ messages: Message[]; hasMore: boolean }>;
  getMessage(id: string): Promise<Message | undefined>;
  getMessageByExternalId(externalId: string): Promise<Message | undefined>;
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

  // App Settings
  getAppSetting(key: string): Promise<AppSetting | undefined>;
  setAppSetting(key: string, value: string | null, isValid?: boolean): Promise<AppSetting>;
  deleteAppSetting(key: string): Promise<void>;

  // Blast Campaigns
  getBlastCampaigns(): Promise<BlastCampaign[]>;
  getBlastCampaign(id: string): Promise<BlastCampaign | undefined>;
  createBlastCampaign(campaign: InsertBlastCampaign): Promise<BlastCampaign>;
  updateBlastCampaign(id: string, campaign: Partial<InsertBlastCampaign>): Promise<BlastCampaign | undefined>;
  updateBlastCampaignStatus(id: string, status: BlastCampaignStatus): Promise<BlastCampaign | undefined>;
  deleteBlastCampaign(id: string): Promise<void>;
  incrementBlastCampaignSentCount(id: string): Promise<void>;
  incrementBlastCampaignFailedCount(id: string): Promise<void>;
  incrementBlastCampaignGeneratedCount(id: string): Promise<void>;
  incrementBlastCampaignGenerationFailedCount(id: string): Promise<void>;
  setBlastCampaignGenerating(id: string, isGenerating: boolean): Promise<void>;

  // Blast Recipients
  getBlastRecipients(campaignId: string): Promise<(BlastRecipient & { contact: Contact })[]>;
  getBlastRecipient(id: string): Promise<BlastRecipient | undefined>;
  getBlastRecipientWithContact(id: string): Promise<(BlastRecipient & { contact: Contact }) | undefined>;
  createBlastRecipients(recipients: InsertBlastRecipient[]): Promise<BlastRecipient[]>;
  updateBlastRecipient(id: string, data: Partial<BlastRecipient>): Promise<BlastRecipient | undefined>;
  getNextPendingRecipient(campaignId: string): Promise<BlastRecipient | undefined>;
  getPendingGenerationRecipients(campaignId: string, limit: number): Promise<(BlastRecipient & { contact: Contact })[]>;
  getQueuedRecipients(campaignId: string): Promise<(BlastRecipient & { contact: Contact })[]>;
  getApprovedRecipients(campaignId: string, limit: number): Promise<(BlastRecipient & { contact: Contact })[]>;
  getRecipientQueueCounts(campaignId: string): Promise<{ pending: number; generating: number; awaitingReview: number; approved: number }>;
  getDueRecipients(limit?: number): Promise<(BlastRecipient & { contact: Contact; campaign: BlastCampaign })[]>;

  // Cleanup/Maintenance
  mergeDuplicateConversations(): Promise<{ mergedContacts: number; mergedConversations: number }>;
  deleteConversation(id: string): Promise<void>;

  // API Clients
  getApiClients(): Promise<ApiClient[]>;
  getApiClient(id: string): Promise<ApiClient | undefined>;
  getApiClientByClientId(clientId: string): Promise<ApiClient | undefined>;
  createApiClient(client: InsertApiClient): Promise<ApiClient>;
  updateApiClient(id: string, client: Partial<InsertApiClient>): Promise<ApiClient | undefined>;
  deleteApiClient(id: string): Promise<void>;
  incrementApiClientRequestCount(clientId: string): Promise<void>;
  resetApiClientDailyCount(id: string): Promise<void>;

  // API Message Queue
  getApiMessageQueue(clientId?: string): Promise<ApiMessageQueue[]>;
  getApiMessage(id: string): Promise<ApiMessageQueue | undefined>;
  getApiMessageByRequestId(requestId: string): Promise<ApiMessageQueue | undefined>;
  createApiMessage(message: InsertApiMessageQueue): Promise<ApiMessageQueue>;
  updateApiMessage(id: string, data: Partial<ApiMessageQueue>): Promise<ApiMessageQueue | undefined>;
  getQueuedApiMessages(limit: number): Promise<ApiMessageQueue[]>;
  updateApiMessageStatus(id: string, status: ApiMessageStatus, errorMessage?: string): Promise<ApiMessageQueue | undefined>;
  deleteApiMessage(id: string): Promise<void>;
  getApiMessageQueueWithClient(): Promise<(ApiMessageQueue & { clientName: string })[]>;

  // API Request Logs
  createApiRequestLog(log: Omit<ApiRequestLog, "id" | "createdAt">): Promise<ApiRequestLog>;
  getApiRequestLogs(clientId: string, limit?: number): Promise<ApiRequestLog[]>;

  // Shortened URLs
  createShortenedUrl(url: InsertShortenedUrl): Promise<ShortenedUrl>;
  getShortenedUrlByCode(shortCode: string): Promise<ShortenedUrl | undefined>;
  incrementShortenedUrlClickCount(shortCode: string): Promise<void>;

  // Message Templates
  createMessageTemplate(template: InsertMessageTemplate): Promise<MessageTemplate>;
  getMessageTemplateByName(name: string): Promise<MessageTemplate | undefined>;
  getMessageTemplateById(id: string): Promise<MessageTemplate | undefined>;
  getAllMessageTemplates(): Promise<MessageTemplate[]>;
  updateMessageTemplate(id: string, updates: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined>;
  deleteMessageTemplate(id: string): Promise<void>;
  
  // Blast Campaigns by Template
  getBlastCampaignsByTemplateId(templateId: string): Promise<BlastCampaign[]>;
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
    // Also search by whatsappLid field for LID-based lookups
    if (platform === "whatsapp") {
      const variants = normalizeWhatsAppId(platformId);
      const canonical = getCanonicalPhoneNumber(platformId);
      
      // Check if this looks like a LID (16+ digits, no valid country code pattern)
      const isLid = canonical.length >= 15;
      
      const [contact] = await db
        .select()
        .from(contacts)
        .where(and(
          or(
            inArray(contacts.platformId, variants),
            // Also check whatsappLid field for LID matches
            eq(contacts.whatsappLid, canonical),
            eq(contacts.whatsappLid, platformId)
          ),
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

  async getContactByPhoneNumber(phoneNumber: string): Promise<Contact | undefined> {
    // Normalize phone number - strip everything except digits
    const canonical = getCanonicalPhoneNumber(phoneNumber);
    
    // Search for contacts with matching phone number (with or without + prefix)
    const variants = [`+${canonical}`, canonical];
    
    // Also search in platformId for WhatsApp contacts
    const platformVariants = normalizeWhatsAppId(canonical);
    
    const [contact] = await db
      .select()
      .from(contacts)
      .where(or(
        inArray(contacts.phoneNumber, variants),
        and(
          inArray(contacts.platformId, platformVariants),
          eq(contacts.platform, "whatsapp")
        ),
        // Also check whatsapp_lid field for matching LID
        eq(contacts.whatsappLid, canonical)
      ))
      .orderBy(desc(contacts.updatedAt))
      .limit(1);
    
    return contact || undefined;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [newContact] = await db.insert(contacts).values(contact).returning();
    return newContact;
  }

  /**
   * Find a WhatsApp contact by primary ID (phone or LID) and optionally an alternate ID.
   * If two separate contacts are found (one by each ID), merge them into one.
   * This prevents duplicate conversations for the same person.
   */
  async findOrMergeWhatsAppContact(
    primaryId: string,
    alternateId?: string
  ): Promise<Contact | undefined> {
    const primaryCanonical = getCanonicalPhoneNumber(primaryId);
    const primaryIsLid = primaryCanonical.length >= 15;
    
    // Search by primary ID first
    let primaryContact = await this.getContactByPhoneNumber(primaryCanonical);
    if (!primaryContact) {
      primaryContact = await this.getContactByPlatformId(primaryCanonical, "whatsapp");
    }
    
    // If we have an alternate ID, search for that too
    let alternateContact: Contact | undefined;
    if (alternateId) {
      const altCanonical = getCanonicalPhoneNumber(alternateId);
      alternateContact = await this.getContactByPhoneNumber(altCanonical);
      if (!alternateContact) {
        alternateContact = await this.getContactByPlatformId(altCanonical, "whatsapp");
      }
    }
    
    // If both found and they're different contacts, merge them
    if (primaryContact && alternateContact && primaryContact.id !== alternateContact.id) {
      console.log(`Merging duplicate WhatsApp contacts: ${primaryContact.id} <- ${alternateContact.id}`);
      
      // Move all related records from alternate to primary
      // 1. Move conversations
      await db
        .update(conversations)
        .set({ contactId: primaryContact.id })
        .where(eq(conversations.contactId, alternateContact.id));
      
      // 2. Move blast recipients
      await db
        .update(blastRecipients)
        .set({ contactId: primaryContact.id })
        .where(eq(blastRecipients.contactId, alternateContact.id));
      
      // 3. Move API message queue entries
      await db
        .update(apiMessageQueue)
        .set({ contactId: primaryContact.id })
        .where(eq(apiMessageQueue.contactId, alternateContact.id));
      
      // Update primary contact with any missing identifiers from alternate
      const updates: Partial<InsertContact> = {};
      if (!primaryContact.phoneNumber && alternateContact.phoneNumber) {
        updates.phoneNumber = alternateContact.phoneNumber;
      }
      if (!primaryContact.whatsappLid && alternateContact.whatsappLid) {
        updates.whatsappLid = alternateContact.whatsappLid;
      }
      if (!primaryContact.name && alternateContact.name) {
        updates.name = alternateContact.name;
      }
      if (!primaryContact.profilePictureUrl && alternateContact.profilePictureUrl) {
        updates.profilePictureUrl = alternateContact.profilePictureUrl;
      }
      // Merge tags if both have them
      if (alternateContact.tags && alternateContact.tags.length > 0) {
        const existingTags = primaryContact.tags || [];
        const mergedTags = Array.from(new Set([...existingTags, ...alternateContact.tags]));
        updates.tags = mergedTags;
      }
      
      if (Object.keys(updates).length > 0) {
        await this.updateContact(primaryContact.id, updates);
        Object.assign(primaryContact, updates);
      }
      
      // Delete the alternate contact (all FK references have been moved)
      await db.delete(contacts).where(eq(contacts.id, alternateContact.id));
      
      return primaryContact;
    }
    
    // If only alternate contact found, use it but update its identifiers
    if (!primaryContact && alternateContact) {
      const updates: Partial<InsertContact> = {};
      const altCanonical = alternateId ? getCanonicalPhoneNumber(alternateId) : "";
      const altIsLid = altCanonical.length >= 15;
      
      // Add the primary ID as the missing identifier
      if (primaryIsLid && !alternateContact.whatsappLid) {
        updates.whatsappLid = primaryCanonical;
      } else if (!primaryIsLid && !alternateContact.phoneNumber) {
        updates.phoneNumber = `+${primaryCanonical}`;
      }
      
      if (Object.keys(updates).length > 0) {
        await this.updateContact(alternateContact.id, updates);
        Object.assign(alternateContact, updates);
      }
      
      return alternateContact;
    }
    
    // If primary contact found, update with alternate ID if provided
    if (primaryContact && alternateId) {
      const altCanonical = getCanonicalPhoneNumber(alternateId);
      const altIsLid = altCanonical.length >= 15;
      const updates: Partial<InsertContact> = {};
      
      if (altIsLid && !primaryContact.whatsappLid) {
        updates.whatsappLid = altCanonical;
      } else if (!altIsLid && !primaryContact.phoneNumber) {
        updates.phoneNumber = `+${altCanonical}`;
      }
      
      if (Object.keys(updates).length > 0) {
        await this.updateContact(primaryContact.id, updates);
        Object.assign(primaryContact, updates);
      }
    }
    
    return primaryContact;
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
      // If user has departments assigned, show their department's conversations + unassigned ones
      // If user has NO departments assigned, only show unassigned conversations (NULL department)
      if (departmentIds.length === 0) {
        whereClause = and(
          eq(conversations.isArchived, false),
          sql`${conversations.departmentId} IS NULL`
        )!;
      } else {
        whereClause = and(
          eq(conversations.isArchived, false),
          or(
            inArray(conversations.departmentId, departmentIds),
            sql`${conversations.departmentId} IS NULL`
          )
        )!;
      }
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

  async getConversation(id: string, messageLimit: number = 20): Promise<ConversationWithMessages | undefined> {
    const [row] = await db
      .select()
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversations.id, id));

    if (!row) return undefined;

    // Get total message count for this conversation
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.conversationId, id));
    const totalMessages = Number(countResult?.count || 0);

    // Fetch only the most recent messages (ordered by timestamp descending, then reverse for display)
    const conversationMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.timestamp))
      .limit(messageLimit);

    // Reverse to get chronological order for display
    conversationMessages.reverse();

    return {
      ...row.conversations,
      contact: row.contacts!,
      messages: conversationMessages,
      hasMoreMessages: totalMessages > messageLimit,
      totalMessages,
    };
  }

  async getOlderMessages(conversationId: string, beforeTimestamp: Date, beforeId: string, limit: number = 50): Promise<{ messages: Message[]; hasMore: boolean }> {
    // Use (timestamp, id) pair for deterministic cursoring to avoid skipping messages with same timestamp
    const olderMessages = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          or(
            sql`${messages.timestamp} < ${beforeTimestamp}`,
            and(
              sql`${messages.timestamp} = ${beforeTimestamp}`,
              sql`${messages.id} < ${beforeId}`
            )
          )
        )
      )
      .orderBy(desc(messages.timestamp), desc(messages.id))
      .limit(limit + 1); // Fetch one extra to check if there are more

    // Check if there are more messages
    const hasMore = olderMessages.length > limit;
    if (hasMore) {
      olderMessages.pop(); // Remove the extra message
    }

    // Reverse to get chronological order
    olderMessages.reverse();
    return { messages: olderMessages, hasMore };
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

  async getMessageByExternalId(externalId: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.externalId, externalId));
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

  // App Settings
  async getAppSetting(key: string): Promise<AppSetting | undefined> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting || undefined;
  }

  async setAppSetting(key: string, value: string | null, isValid?: boolean): Promise<AppSetting> {
    const existing = await this.getAppSetting(key);
    
    if (existing) {
      const [updated] = await db
        .update(appSettings)
        .set({ 
          value, 
          isValid: isValid ?? null,
          lastValidatedAt: isValid !== undefined ? new Date() : existing.lastValidatedAt,
          updatedAt: new Date() 
        })
        .where(eq(appSettings.key, key))
        .returning();
      return updated;
    }

    const [newSetting] = await db.insert(appSettings).values({
      key,
      value,
      isValid: isValid ?? null,
      lastValidatedAt: isValid !== undefined ? new Date() : null,
    }).returning();
    return newSetting;
  }

  async deleteAppSetting(key: string): Promise<void> {
    await db.delete(appSettings).where(eq(appSettings.key, key));
  }

  // Blast Campaigns
  async getBlastCampaigns(): Promise<BlastCampaign[]> {
    return db.select().from(blastCampaigns).orderBy(desc(blastCampaigns.createdAt));
  }

  async getBlastCampaign(id: string): Promise<BlastCampaign | undefined> {
    const [campaign] = await db.select().from(blastCampaigns).where(eq(blastCampaigns.id, id));
    return campaign || undefined;
  }

  async createBlastCampaign(campaign: InsertBlastCampaign): Promise<BlastCampaign> {
    const [newCampaign] = await db.insert(blastCampaigns).values(campaign).returning();
    return newCampaign;
  }

  async updateBlastCampaign(id: string, campaign: Partial<InsertBlastCampaign>): Promise<BlastCampaign | undefined> {
    const [updated] = await db
      .update(blastCampaigns)
      .set({ ...campaign, updatedAt: new Date() })
      .where(eq(blastCampaigns.id, id))
      .returning();
    return updated || undefined;
  }

  async updateBlastCampaignStatus(id: string, status: BlastCampaignStatus): Promise<BlastCampaign | undefined> {
    const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
    
    if (status === "running") {
      updateData.startedAt = new Date();
    } else if (status === "completed" || status === "cancelled") {
      updateData.completedAt = new Date();
    }

    const [updated] = await db
      .update(blastCampaigns)
      .set(updateData)
      .where(eq(blastCampaigns.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteBlastCampaign(id: string): Promise<void> {
    await db.delete(blastCampaigns).where(eq(blastCampaigns.id, id));
  }

  async incrementBlastCampaignSentCount(id: string): Promise<void> {
    await db
      .update(blastCampaigns)
      .set({ 
        sentCount: sql`${blastCampaigns.sentCount} + 1`,
        updatedAt: new Date() 
      })
      .where(eq(blastCampaigns.id, id));
  }

  async incrementBlastCampaignFailedCount(id: string): Promise<void> {
    await db
      .update(blastCampaigns)
      .set({ 
        failedCount: sql`${blastCampaigns.failedCount} + 1`,
        updatedAt: new Date() 
      })
      .where(eq(blastCampaigns.id, id));
  }

  async incrementBlastCampaignGeneratedCount(id: string): Promise<void> {
    await db
      .update(blastCampaigns)
      .set({ 
        generatedCount: sql`${blastCampaigns.generatedCount} + 1`,
        updatedAt: new Date() 
      })
      .where(eq(blastCampaigns.id, id));
  }

  async incrementBlastCampaignGenerationFailedCount(id: string): Promise<void> {
    await db
      .update(blastCampaigns)
      .set({ 
        generationFailedCount: sql`${blastCampaigns.generationFailedCount} + 1`,
        updatedAt: new Date() 
      })
      .where(eq(blastCampaigns.id, id));
  }

  async setBlastCampaignGenerating(id: string, isGenerating: boolean): Promise<void> {
    await db
      .update(blastCampaigns)
      .set({ 
        isGenerating,
        updatedAt: new Date() 
      })
      .where(eq(blastCampaigns.id, id));
  }

  // Blast Recipients
  async getBlastRecipients(campaignId: string): Promise<(BlastRecipient & { contact: Contact })[]> {
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .where(eq(blastRecipients.campaignId, campaignId))
      .orderBy(asc(blastRecipients.createdAt));

    return result.map((row) => ({
      ...row.blast_recipients,
      contact: row.contacts,
    }));
  }

  async getBlastRecipient(id: string): Promise<BlastRecipient | undefined> {
    const [recipient] = await db.select().from(blastRecipients).where(eq(blastRecipients.id, id));
    return recipient || undefined;
  }

  async createBlastRecipients(recipients: InsertBlastRecipient[]): Promise<BlastRecipient[]> {
    if (recipients.length === 0) return [];
    
    // Batch insert to avoid timeout with large recipient lists (10000+)
    const BATCH_SIZE = 100;
    const results: BlastRecipient[] = [];
    
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const inserted = await db.insert(blastRecipients).values(batch).returning();
      results.push(...inserted);
    }
    
    return results;
  }

  async updateBlastRecipient(id: string, data: Partial<BlastRecipient>): Promise<BlastRecipient | undefined> {
    const [updated] = await db
      .update(blastRecipients)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(blastRecipients.id, id))
      .returning();
    return updated || undefined;
  }

  async getNextPendingRecipient(campaignId: string): Promise<BlastRecipient | undefined> {
    const [recipient] = await db
      .select()
      .from(blastRecipients)
      .where(and(
        eq(blastRecipients.campaignId, campaignId),
        eq(blastRecipients.status, "pending")
      ))
      .orderBy(asc(blastRecipients.createdAt))
      .limit(1);
    return recipient || undefined;
  }

  async getBlastRecipientWithContact(id: string): Promise<(BlastRecipient & { contact: Contact }) | undefined> {
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .where(eq(blastRecipients.id, id))
      .limit(1);
    
    if (result.length === 0) return undefined;
    return {
      ...result[0].blast_recipients,
      contact: result[0].contacts,
    };
  }

  async getPendingGenerationRecipients(campaignId: string, limit: number): Promise<(BlastRecipient & { contact: Contact })[]> {
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .where(and(
        eq(blastRecipients.campaignId, campaignId),
        eq(blastRecipients.status, "pending")
      ))
      .orderBy(asc(blastRecipients.createdAt))
      .limit(limit);

    return result.map((row) => ({
      ...row.blast_recipients,
      contact: row.contacts,
    }));
  }

  async getQueuedRecipients(campaignId: string): Promise<(BlastRecipient & { contact: Contact })[]> {
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .where(and(
        eq(blastRecipients.campaignId, campaignId),
        or(
          eq(blastRecipients.status, "awaiting_review"),
          eq(blastRecipients.status, "approved")
        )
      ))
      .orderBy(asc(blastRecipients.createdAt));

    return result.map((row) => ({
      ...row.blast_recipients,
      contact: row.contacts,
    }));
  }

  async getApprovedRecipients(campaignId: string, limit: number): Promise<(BlastRecipient & { contact: Contact })[]> {
    const now = new Date();
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .where(and(
        eq(blastRecipients.campaignId, campaignId),
        eq(blastRecipients.status, "approved"),
        // Only get recipients whose scheduledAt is null or in the past (respects rate limit delays)
        or(
          isNull(blastRecipients.scheduledAt),
          lte(blastRecipients.scheduledAt, now)
        )
      ))
      // Order by scheduledAt first (soonest first), then approvedAt for tie-breaking
      .orderBy(asc(blastRecipients.scheduledAt), asc(blastRecipients.approvedAt))
      .limit(limit);

    return result.map((row) => ({
      ...row.blast_recipients,
      contact: row.contacts,
    }));
  }

  async getRecipientQueueCounts(campaignId: string): Promise<{ pending: number; generating: number; awaitingReview: number; approved: number }> {
    const result = await db
      .select({
        status: blastRecipients.status,
        count: sql<number>`count(*)::int`,
      })
      .from(blastRecipients)
      .where(eq(blastRecipients.campaignId, campaignId))
      .groupBy(blastRecipients.status);

    const counts = { pending: 0, generating: 0, awaitingReview: 0, approved: 0 };
    for (const row of result) {
      if (row.status === "pending") counts.pending = row.count;
      else if (row.status === "generating") counts.generating = row.count;
      else if (row.status === "awaiting_review") counts.awaitingReview = row.count;
      else if (row.status === "approved") counts.approved = row.count;
    }
    return counts;
  }

  async getDueRecipients(limit: number = 10): Promise<(BlastRecipient & { contact: Contact; campaign: BlastCampaign })[]> {
    const now = new Date();
    const result = await db
      .select()
      .from(blastRecipients)
      .innerJoin(contacts, eq(blastRecipients.contactId, contacts.id))
      .innerJoin(blastCampaigns, eq(blastRecipients.campaignId, blastCampaigns.id))
      .where(and(
        eq(blastRecipients.status, "approved"),
        or(
          isNull(blastRecipients.scheduledAt),
          lte(blastRecipients.scheduledAt, now)
        ),
        eq(blastCampaigns.status, "running")
      ))
      .orderBy(asc(blastRecipients.scheduledAt))
      .limit(limit);

    return result.map((row) => ({
      ...row.blast_recipients,
      contact: row.contacts,
      campaign: row.blast_campaigns,
    }));
  }

  async deleteConversation(id: string): Promise<void> {
    // Delete all messages in the conversation first
    await db.delete(messages).where(eq(messages.conversationId, id));
    // Then delete the conversation
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async mergeDuplicateConversations(): Promise<{ mergedContacts: number; mergedConversations: number }> {
    let mergedContacts = 0;
    let mergedConversations = 0;

    // Get all WhatsApp contacts
    const allContacts = await db.select().from(contacts).where(eq(contacts.platform, "whatsapp"));
    
    // Track which contacts have been merged (to skip processing them again)
    const mergedContactIds = new Set<string>();
    
    // PHASE 1: Merge by phone number (for contacts with actual phone numbers)
    const phoneGroups = new Map<string, typeof allContacts>();
    
    for (const contact of allContacts) {
      if (!contact.phoneNumber) continue;
      
      // Normalize phone number to canonical form (just digits)
      const canonical = getCanonicalPhoneNumber(contact.phoneNumber);
      if (!canonical) continue;
      
      const existing = phoneGroups.get(canonical) || [];
      existing.push(contact);
      phoneGroups.set(canonical, existing);
    }

    // Process phone number duplicates
    const phoneGroupEntries = Array.from(phoneGroups.entries());
    for (const [, contactGroup] of phoneGroupEntries) {
      if (contactGroup.length <= 1) continue;

      // Sort by: prefer real phone numbers over LIDs, then by updatedAt desc
      contactGroup.sort((a: Contact, b: Contact) => {
        // Prefer contacts with shorter phone numbers (real numbers vs LIDs which are often longer)
        const aIsLikeLID = (a.phoneNumber?.length || 0) > 15;
        const bIsLikeLID = (b.phoneNumber?.length || 0) > 15;
        if (aIsLikeLID !== bIsLikeLID) return aIsLikeLID ? 1 : -1;
        return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
      });

      const primaryContact = contactGroup[0];
      const duplicateContacts = contactGroup.slice(1);

      const mergeResult = await this.mergeContactsIntoPrimary(primaryContact, duplicateContacts);
      mergedContacts += mergeResult.mergedContacts;
      mergedConversations += mergeResult.mergedConversations;
      
      duplicateContacts.forEach(c => mergedContactIds.add(c.id));
    }

    // PHASE 2: Merge by exact name for WhatsApp contacts (to catch LID duplicates)
    // This handles cases where the same person has both phone JID and LID entries
    const nameGroups = new Map<string, typeof allContacts>();
    
    for (const contact of allContacts) {
      // Skip if already merged or no name
      if (mergedContactIds.has(contact.id)) continue;
      if (!contact.name || contact.name.trim() === "") continue;
      
      // Normalize name for comparison (lowercase, trim)
      const normalizedName = contact.name.toLowerCase().trim();
      
      const existing = nameGroups.get(normalizedName) || [];
      existing.push(contact);
      nameGroups.set(normalizedName, existing);
    }

    // Process name duplicates
    const nameGroupEntries = Array.from(nameGroups.entries());
    for (const [, contactGroup] of nameGroupEntries) {
      if (contactGroup.length <= 1) continue;

      // Only merge if we're confident these are duplicates:
      // - Same name, same platform
      // - At least one has a real-looking phone number (not a LID)
      const hasRealPhone = contactGroup.some(c => {
        const phone = c.phoneNumber || "";
        return phone.length >= 10 && phone.length <= 15;
      });
      
      if (!hasRealPhone) continue;

      // Sort to prefer real phone numbers over LIDs
      contactGroup.sort((a: Contact, b: Contact) => {
        const aPhone = a.phoneNumber || "";
        const bPhone = b.phoneNumber || "";
        const aIsRealPhone = aPhone.length >= 10 && aPhone.length <= 15;
        const bIsRealPhone = bPhone.length >= 10 && bPhone.length <= 15;
        if (aIsRealPhone !== bIsRealPhone) return aIsRealPhone ? -1 : 1;
        return (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0);
      });

      const primaryContact = contactGroup[0];
      const duplicateContacts = contactGroup.slice(1);

      console.log(`Merging ${duplicateContacts.length} duplicates for "${primaryContact.name}" into primary (${primaryContact.phoneNumber})`);

      const mergeResult = await this.mergeContactsIntoPrimary(primaryContact, duplicateContacts);
      mergedContacts += mergeResult.mergedContacts;
      mergedConversations += mergeResult.mergedConversations;
      
      duplicateContacts.forEach(c => mergedContactIds.add(c.id));
    }

    // PHASE 3: Merge by partial name match for LID contacts
    // This catches cases like "Dany Christian" vs "Dany Christian Mba Vina"
    const remainingContacts = allContacts.filter(c => !mergedContactIds.has(c.id) && c.name);
    
    for (let i = 0; i < remainingContacts.length; i++) {
      const contact1 = remainingContacts[i];
      if (mergedContactIds.has(contact1.id)) continue;
      
      const name1 = (contact1.name || "").toLowerCase().trim();
      if (name1.length < 5) continue; // Skip very short names
      
      for (let j = i + 1; j < remainingContacts.length; j++) {
        const contact2 = remainingContacts[j];
        if (mergedContactIds.has(contact2.id)) continue;
        
        const name2 = (contact2.name || "").toLowerCase().trim();
        if (name2.length < 5) continue;
        
        // Check if one name starts with the other (partial match)
        const isPartialMatch = name1.startsWith(name2) || name2.startsWith(name1);
        if (!isPartialMatch) continue;
        
        // Ensure one has a LID-like number (very long) and one has a real phone
        const phone1 = contact1.phoneNumber || "";
        const phone2 = contact2.phoneNumber || "";
        const phone1IsLID = phone1.length > 15;
        const phone2IsLID = phone2.length > 15;
        const phone1IsReal = phone1.length >= 10 && phone1.length <= 15;
        const phone2IsReal = phone2.length >= 10 && phone2.length <= 15;
        
        // Only merge if one is LID and one is real phone
        if (!((phone1IsLID && phone2IsReal) || (phone1IsReal && phone2IsLID))) continue;
        
        // Primary is the one with real phone number
        const primary = phone1IsReal ? contact1 : contact2;
        const duplicate = phone1IsReal ? contact2 : contact1;
        
        console.log(`Merging partial match "${duplicate.name}" (${duplicate.phoneNumber}) into "${primary.name}" (${primary.phoneNumber})`);
        
        const mergeResult = await this.mergeContactsIntoPrimary(primary, [duplicate]);
        mergedContacts += mergeResult.mergedContacts;
        mergedConversations += mergeResult.mergedConversations;
        
        mergedContactIds.add(duplicate.id);
      }
    }

    return { mergedContacts, mergedConversations };
  }

  async mergeSpecificContacts(primaryContactId: string, duplicateContactId: string): Promise<{ success: boolean; message: string }> {
    const primary = await this.getContact(primaryContactId);
    const duplicate = await this.getContact(duplicateContactId);
    
    if (!primary || !duplicate) {
      return { success: false, message: "One or both contacts not found" };
    }
    
    if (primary.id === duplicate.id) {
      return { success: false, message: "Cannot merge a contact with itself" };
    }
    
    const result = await this.mergeContactsIntoPrimary(primary, [duplicate]);
    
    return { 
      success: true, 
      message: `Merged "${duplicate.name}" into "${primary.name}". Moved ${result.mergedConversations} conversations.` 
    };
  }

  private async mergeContactsIntoPrimary(
    primaryContact: Contact, 
    duplicateContacts: Contact[]
  ): Promise<{ mergedContacts: number; mergedConversations: number }> {
    let mergedContacts = 0;
    let mergedConversations = 0;

    // Get primary conversation
    let primaryConversation = await this.getConversationByContactId(primaryContact.id);

    for (const dupContact of duplicateContacts) {
      // Get all conversations for this duplicate contact
      const dupConversations = await db
        .select()
        .from(conversations)
        .where(eq(conversations.contactId, dupContact.id));

      for (const dupConv of dupConversations) {
        if (!primaryConversation) {
          // No primary conversation yet, reassign this one to the primary contact
          await db
            .update(conversations)
            .set({ contactId: primaryContact.id, updatedAt: new Date() })
            .where(eq(conversations.id, dupConv.id));
          primaryConversation = { ...dupConv, contactId: primaryContact.id };
        } else {
          // Move all messages from duplicate conversation to primary
          await db
            .update(messages)
            .set({ conversationId: primaryConversation.id })
            .where(eq(messages.conversationId, dupConv.id));
          
          // Update primary conversation with latest message info if needed
          if (dupConv.lastMessageAt && (!primaryConversation.lastMessageAt || dupConv.lastMessageAt > primaryConversation.lastMessageAt)) {
            await db
              .update(conversations)
              .set({ 
                lastMessageAt: dupConv.lastMessageAt, 
                lastMessagePreview: dupConv.lastMessagePreview,
                updatedAt: new Date() 
              })
              .where(eq(conversations.id, primaryConversation.id));
          }
          
          // Delete the duplicate conversation
          await db.delete(conversations).where(eq(conversations.id, dupConv.id));
          mergedConversations++;
        }
      }

      // Delete duplicate contact
      await db.delete(contacts).where(eq(contacts.id, dupContact.id));
      mergedContacts++;
    }

    return { mergedContacts, mergedConversations };
  }

  // ============= API CLIENTS =============
  async getApiClients(): Promise<ApiClient[]> {
    return db.select().from(apiClients).orderBy(desc(apiClients.createdAt));
  }

  async getApiClient(id: string): Promise<ApiClient | undefined> {
    const [client] = await db.select().from(apiClients).where(eq(apiClients.id, id));
    return client || undefined;
  }

  async getApiClientByClientId(clientId: string): Promise<ApiClient | undefined> {
    const [client] = await db.select().from(apiClients).where(eq(apiClients.clientId, clientId));
    return client || undefined;
  }

  async createApiClient(client: InsertApiClient): Promise<ApiClient> {
    const [newClient] = await db.insert(apiClients).values(client).returning();
    return newClient;
  }

  async updateApiClient(id: string, client: Partial<InsertApiClient>): Promise<ApiClient | undefined> {
    const [updated] = await db
      .update(apiClients)
      .set({ ...client, updatedAt: new Date() })
      .where(eq(apiClients.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteApiClient(id: string): Promise<void> {
    await db.delete(apiClients).where(eq(apiClients.id, id));
  }

  async incrementApiClientRequestCount(clientId: string): Promise<void> {
    await db
      .update(apiClients)
      .set({
        requestCountToday: sql`${apiClients.requestCountToday} + 1`,
        lastRequestAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(apiClients.clientId, clientId));
  }

  async resetApiClientDailyCount(id: string): Promise<void> {
    await db
      .update(apiClients)
      .set({
        requestCountToday: 0,
        lastResetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(apiClients.id, id));
  }

  // ============= API MESSAGE QUEUE =============
  async getApiMessageQueue(clientId?: string): Promise<ApiMessageQueue[]> {
    if (clientId) {
      return db
        .select()
        .from(apiMessageQueue)
        .where(eq(apiMessageQueue.clientId, clientId))
        .orderBy(desc(apiMessageQueue.createdAt));
    }
    return db.select().from(apiMessageQueue).orderBy(desc(apiMessageQueue.createdAt));
  }

  async getApiMessage(id: string): Promise<ApiMessageQueue | undefined> {
    const [message] = await db.select().from(apiMessageQueue).where(eq(apiMessageQueue.id, id));
    return message || undefined;
  }

  async getApiMessageByRequestId(requestId: string): Promise<ApiMessageQueue | undefined> {
    const [message] = await db
      .select()
      .from(apiMessageQueue)
      .where(eq(apiMessageQueue.requestId, requestId));
    return message || undefined;
  }

  async createApiMessage(message: InsertApiMessageQueue): Promise<ApiMessageQueue> {
    const [newMessage] = await db.insert(apiMessageQueue).values(message).returning();
    return newMessage;
  }

  async updateApiMessage(id: string, data: Partial<ApiMessageQueue>): Promise<ApiMessageQueue | undefined> {
    const [updated] = await db
      .update(apiMessageQueue)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(apiMessageQueue.id, id))
      .returning();
    return updated || undefined;
  }

  async getQueuedApiMessages(limit: number): Promise<ApiMessageQueue[]> {
    return db
      .select()
      .from(apiMessageQueue)
      .where(eq(apiMessageQueue.status, "queued"))
      .orderBy(desc(apiMessageQueue.priority), asc(apiMessageQueue.createdAt))
      .limit(limit);
  }

  async updateApiMessageStatus(
    id: string,
    status: ApiMessageStatus,
    errorMessage?: string
  ): Promise<ApiMessageQueue | undefined> {
    const updateData: Partial<ApiMessageQueue> = {
      status,
      updatedAt: new Date(),
    };
    if (errorMessage !== undefined) {
      updateData.errorMessage = errorMessage;
    }
    if (status === "sent") {
      updateData.sentAt = new Date();
    }
    const [updated] = await db
      .update(apiMessageQueue)
      .set(updateData)
      .where(eq(apiMessageQueue.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteApiMessage(id: string): Promise<void> {
    await db.delete(apiMessageQueue).where(eq(apiMessageQueue.id, id));
  }

  async getApiMessageQueueWithClient(): Promise<(ApiMessageQueue & { clientName: string })[]> {
    const results = await db
      .select({
        id: apiMessageQueue.id,
        requestId: apiMessageQueue.requestId,
        clientId: apiMessageQueue.clientId,
        phoneNumber: apiMessageQueue.phoneNumber,
        recipientName: apiMessageQueue.recipientName,
        message: apiMessageQueue.message,
        status: apiMessageQueue.status,
        priority: apiMessageQueue.priority,
        contactId: apiMessageQueue.contactId,
        conversationId: apiMessageQueue.conversationId,
        errorMessage: apiMessageQueue.errorMessage,
        externalMessageId: apiMessageQueue.externalMessageId,
        metadata: apiMessageQueue.metadata,
        scheduledAt: apiMessageQueue.scheduledAt,
        sentAt: apiMessageQueue.sentAt,
        createdAt: apiMessageQueue.createdAt,
        updatedAt: apiMessageQueue.updatedAt,
        clientName: apiClients.name,
      })
      .from(apiMessageQueue)
      .leftJoin(apiClients, eq(apiMessageQueue.clientId, apiClients.id))
      .orderBy(desc(apiMessageQueue.createdAt));
    
    return results.map(r => ({
      ...r,
      clientName: r.clientName || "Unknown",
    }));
  }

  // ============= API REQUEST LOGS =============
  async createApiRequestLog(log: Omit<ApiRequestLog, "id" | "createdAt">): Promise<ApiRequestLog> {
    const [newLog] = await db.insert(apiRequestLogs).values(log).returning();
    return newLog;
  }

  async getApiRequestLogs(clientId: string, limit: number = 100): Promise<ApiRequestLog[]> {
    return db
      .select()
      .from(apiRequestLogs)
      .where(eq(apiRequestLogs.clientId, clientId))
      .orderBy(desc(apiRequestLogs.createdAt))
      .limit(limit);
  }

  // ============= SHORTENED URLS =============
  async createShortenedUrl(url: InsertShortenedUrl): Promise<ShortenedUrl> {
    const [newUrl] = await db.insert(shortenedUrls).values(url).returning();
    return newUrl;
  }

  async getShortenedUrlByCode(shortCode: string): Promise<ShortenedUrl | undefined> {
    const [url] = await db
      .select()
      .from(shortenedUrls)
      .where(eq(shortenedUrls.shortCode, shortCode));
    return url || undefined;
  }

  async incrementShortenedUrlClickCount(shortCode: string): Promise<void> {
    await db
      .update(shortenedUrls)
      .set({ clickCount: sql`${shortenedUrls.clickCount} + 1` })
      .where(eq(shortenedUrls.shortCode, shortCode));
  }

  // Message Templates
  async createMessageTemplate(template: InsertMessageTemplate): Promise<MessageTemplate> {
    const [newTemplate] = await db.insert(messageTemplates).values(template).returning();
    return newTemplate;
  }

  async getMessageTemplateByName(name: string): Promise<MessageTemplate | undefined> {
    const [template] = await db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.name, name));
    return template || undefined;
  }

  async getMessageTemplateById(id: string): Promise<MessageTemplate | undefined> {
    const [template] = await db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, id));
    return template || undefined;
  }

  async getAllMessageTemplates(): Promise<MessageTemplate[]> {
    return await db
      .select()
      .from(messageTemplates)
      .orderBy(messageTemplates.name);
  }

  async updateMessageTemplate(id: string, updates: Partial<InsertMessageTemplate>): Promise<MessageTemplate | undefined> {
    const [updated] = await db
      .update(messageTemplates)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(messageTemplates.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteMessageTemplate(id: string): Promise<void> {
    await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
  }

  async getBlastCampaignsByTemplateId(templateId: string): Promise<BlastCampaign[]> {
    return await db.select().from(blastCampaigns).where(eq(blastCampaigns.templateId, templateId));
  }
}

export const storage = new DatabaseStorage();
