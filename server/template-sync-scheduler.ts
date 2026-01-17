import { bidirectionalSync } from './twilio';
import { storage } from './storage';

let syncInterval: NodeJS.Timeout | null = null;
let schedulerActive = false;
let lastSyncResult: {
  timestamp: Date;
  success: boolean;
  fromTwilio: { created: number; updated: number; deleted: number; unchanged: number };
  toTwilio: { synced: number; skipped: number };
  errors: string[];
  source: 'auto' | 'manual';
} | null = null;

function getJakartaTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
}

export function getMillisecondsUntilNextSync(): number {
  const now = getJakartaTime();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 1, 0, 0);
  
  const today = new Date(now);
  today.setHours(0, 1, 0, 0);
  
  if (now < today) {
    return today.getTime() - now.getTime();
  }
  
  return tomorrow.getTime() - now.getTime();
}

export function getNextSyncTime(): Date {
  const msUntilSync = getMillisecondsUntilNextSync();
  return new Date(Date.now() + msUntilSync);
}

async function runScheduledSync(source: 'auto' | 'manual' = 'auto'): Promise<typeof lastSyncResult> {
  const jakartaTime = getJakartaTime();
  console.log(`[Template Sync Scheduler] Running ${source} bidirectional sync at ${jakartaTime.toISOString()} (Jakarta time)`);
  
  try {
    const result = await bidirectionalSync();
    
    lastSyncResult = {
      timestamp: new Date(),
      success: result.success,
      fromTwilio: result.fromTwilio,
      toTwilio: result.toTwilio,
      errors: result.errors,
      source
    };
    
    console.log(`[Template Sync Scheduler] Bidirectional sync completed:`);
    console.log(`  Twilio->App: ${result.fromTwilio.created} created, ${result.fromTwilio.updated} updated, ${result.fromTwilio.deleted} deleted, ${result.fromTwilio.unchanged} unchanged`);
    console.log(`  App->Twilio: ${result.toTwilio.synced} synced, ${result.toTwilio.skipped} skipped`);
    
    if (result.errors.length > 0) {
      console.log(`[Template Sync Scheduler] Errors: ${result.errors.join(', ')}`);
    }
    
    // Persist last sync result to database
    await storage.setAppSetting('template_last_sync', JSON.stringify(lastSyncResult));
    if (source === 'auto') {
      await storage.setAppSetting('template_last_auto_sync', new Date().toISOString());
    }
    
    return lastSyncResult;
  } catch (error: any) {
    console.error(`[Template Sync Scheduler] Error during sync: ${error.message}`);
    lastSyncResult = {
      timestamp: new Date(),
      success: false,
      fromTwilio: { created: 0, updated: 0, deleted: 0, unchanged: 0 },
      toTwilio: { synced: 0, skipped: 0 },
      errors: [error.message],
      source
    };
    
    // Persist error result too
    await storage.setAppSetting('template_last_sync', JSON.stringify(lastSyncResult));
    
    return lastSyncResult;
  }
}

function scheduleNextSync(): void {
  const msUntilSync = getMillisecondsUntilNextSync();
  const hoursUntilSync = Math.floor(msUntilSync / (1000 * 60 * 60));
  const minutesUntilSync = Math.floor((msUntilSync % (1000 * 60 * 60)) / (1000 * 60));
  
  console.log(`[Template Sync Scheduler] Next sync scheduled in ${hoursUntilSync}h ${minutesUntilSync}m (at 00:01 Jakarta time)`);
  
  if (syncInterval) {
    clearTimeout(syncInterval);
  }
  
  syncInterval = setTimeout(async () => {
    await runScheduledSync();
    scheduleNextSync();
  }, msUntilSync);
}

export async function startTemplateSyncScheduler(): Promise<void> {
  console.log('[Template Sync Scheduler] Starting daily template sync scheduler (00:01 AM Jakarta time)');
  schedulerActive = true;
  
  // Try to restore last sync result from database with backward compatibility
  try {
    const savedResult = await storage.getAppSetting('template_last_sync');
    if (savedResult?.value) {
      const parsed = JSON.parse(savedResult.value);
      // Migrate old format to new format
      if (parsed.fromTwilio && parsed.toTwilio) {
        // New format - use as-is
        lastSyncResult = {
          ...parsed,
          timestamp: new Date(parsed.timestamp)
        };
      } else if (parsed.synced !== undefined) {
        // Old format - migrate to new structure
        lastSyncResult = {
          timestamp: new Date(parsed.timestamp),
          success: parsed.success,
          fromTwilio: {
            created: parsed.created || 0,
            updated: parsed.updated || 0,
            deleted: parsed.deleted || 0,
            unchanged: 0
          },
          toTwilio: {
            synced: 0,
            skipped: 0
          },
          errors: parsed.errors || [],
          source: parsed.source || 'auto'
        };
        console.log('[Template Sync Scheduler] Migrated old sync result format to new bidirectional format');
      }
    }
  } catch (e) {
    // Ignore parse errors
  }
  
  scheduleNextSync();
}

export function stopTemplateSyncScheduler(): void {
  if (syncInterval) {
    clearTimeout(syncInterval);
    syncInterval = null;
    schedulerActive = false;
    console.log('[Template Sync Scheduler] Stopped');
  }
}

export function isSchedulerActive(): boolean {
  return schedulerActive;
}

export function getLastSyncResult(): typeof lastSyncResult {
  return lastSyncResult;
}

export async function runManualSync(): Promise<typeof lastSyncResult> {
  console.log('[Template Sync Scheduler] Running manual sync triggered by admin');
  return await runScheduledSync('manual');
}
