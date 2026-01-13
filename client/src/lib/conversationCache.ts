import type { ConversationWithMessages } from "@shared/schema";

const CACHE_PREFIX = "omnidesk_conv_";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHED_CONVERSATIONS = 50;

interface CachedConversation {
  data: ConversationWithMessages;
  timestamp: number;
}

export function getCachedConversation(conversationId: string): ConversationWithMessages | null {
  try {
    const key = CACHE_PREFIX + conversationId;
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const parsed: CachedConversation = JSON.parse(cached);
    
    // Check if cache is expired
    if (Date.now() - parsed.timestamp > CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export function setCachedConversation(conversation: ConversationWithMessages): void {
  try {
    const key = CACHE_PREFIX + conversation.id;
    const cached: CachedConversation = {
      data: conversation,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(cached));
    
    // Clean up old cache entries if we have too many
    cleanupOldCacheEntries();
  } catch (e) {
    // localStorage might be full or unavailable
    console.warn("Failed to cache conversation:", e);
  }
}

export function updateCachedMessages(conversationId: string, updatedConversation: ConversationWithMessages): void {
  try {
    const key = CACHE_PREFIX + conversationId;
    const cached: CachedConversation = {
      data: updatedConversation,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(cached));
  } catch (e) {
    console.warn("Failed to update cached conversation:", e);
  }
}

export function removeCachedConversation(conversationId: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + conversationId);
  } catch {
    // Ignore errors
  }
}

function cleanupOldCacheEntries(): void {
  try {
    const cacheEntries: { key: string; timestamp: number }[] = [];
    
    // Collect all cache entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const item = localStorage.getItem(key);
          if (item) {
            const parsed: CachedConversation = JSON.parse(item);
            cacheEntries.push({ key, timestamp: parsed.timestamp });
          }
        } catch {
          // Remove corrupted entries
          localStorage.removeItem(key);
        }
      }
    }

    // If we have too many, remove the oldest ones
    if (cacheEntries.length > MAX_CACHED_CONVERSATIONS) {
      cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = cacheEntries.slice(0, cacheEntries.length - MAX_CACHED_CONVERSATIONS);
      toRemove.forEach(entry => localStorage.removeItem(entry.key));
    }
  } catch {
    // Ignore cleanup errors
  }
}

export function clearAllConversationCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch {
    // Ignore errors
  }
}
