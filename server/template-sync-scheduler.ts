import { syncTwilioToDatabase } from './twilio';
import { storage } from './storage';

let syncInterval: NodeJS.Timeout | null = null;
let schedulerActive = false;
let lastSyncResult: {
  timestamp: Date;
  success: boolean;
  synced: number;
  created: number;
  updated: number;
  deleted: number;
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
  console.log(`[Template Sync Scheduler] Running ${source} sync at ${jakartaTime.toISOString()} (Jakarta time)`);
  
  try {
    const result = await syncTwilioToDatabase({ deleteOrphans: true });
    
    lastSyncResult = {
      timestamp: new Date(),
      success: result.success,
      synced: result.synced,
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
      errors: result.errors,
      source
    };
    
    console.log(`[Template Sync Scheduler] Sync completed: ${result.synced} synced (${result.created} created, ${result.updated} updated, ${result.deleted} deleted)`);
    
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
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
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
  
  // Try to restore last sync result from database
  try {
    const savedResult = await storage.getAppSetting('template_last_sync');
    if (savedResult?.value) {
      const parsed = JSON.parse(savedResult.value);
      lastSyncResult = {
        ...parsed,
        timestamp: new Date(parsed.timestamp)
      };
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
