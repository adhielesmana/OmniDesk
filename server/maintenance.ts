import { db } from "./db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const TEMP_DIRS = [
  "/tmp",
  "./node_modules/.cache",
  "./dist",
];

const MAX_AGE_HOURS = 24;

async function cleanupOldFiles() {
  const now = Date.now();
  const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000;
  let totalDeleted = 0;
  let totalBytesFreed = 0;

  for (const dir of TEMP_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      
      const files = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        
        try {
          const stats = fs.statSync(filePath);
          const age = now - stats.mtimeMs;
          
          if (age > maxAge && file.isFile()) {
            if (file.name.endsWith('.log') || 
                file.name.endsWith('.tmp') || 
                file.name.startsWith('tmp-')) {
              totalBytesFreed += stats.size;
              fs.unlinkSync(filePath);
              totalDeleted++;
            }
          }
        } catch (err) {
          // Skip files we can't access
        }
      }
    } catch (err) {
      console.log(`[Maintenance] Cannot access ${dir}:`, err);
    }
  }

  return { totalDeleted, totalBytesFreed };
}

async function vacuumDatabase() {
  try {
    await db.execute(sql`VACUUM ANALYZE`);
    console.log("[Maintenance] Database VACUUM ANALYZE completed");
    return true;
  } catch (err) {
    console.error("[Maintenance] Database vacuum failed:", err);
    return false;
  }
}

async function getDatabaseSize() {
  try {
    const result = await db.execute(sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    return (result.rows[0] as any)?.size || "unknown";
  } catch (err) {
    return "unknown";
  }
}

export async function runMaintenance() {
  console.log("[Maintenance] Starting scheduled maintenance...");
  const startTime = Date.now();

  const dbSizeBefore = await getDatabaseSize();
  
  const { totalDeleted, totalBytesFreed } = await cleanupOldFiles();
  console.log(`[Maintenance] Cleaned up ${totalDeleted} old files (${(totalBytesFreed / 1024).toFixed(2)} KB freed)`);

  const vacuumSuccess = await vacuumDatabase();
  
  const dbSizeAfter = await getDatabaseSize();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Maintenance] Completed in ${duration}s`);
  console.log(`[Maintenance] Database size: ${dbSizeBefore} -> ${dbSizeAfter}`);

  return {
    filesDeleted: totalDeleted,
    bytesFreed: totalBytesFreed,
    vacuumSuccess,
    dbSizeBefore,
    dbSizeAfter,
    duration,
  };
}

let maintenanceInterval: NodeJS.Timeout | null = null;

export function startMaintenanceScheduler() {
  const INTERVAL_HOURS = 24;
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;

  console.log(`[Maintenance] Scheduler started - will run every ${INTERVAL_HOURS} hours`);

  setTimeout(() => {
    runMaintenance();
  }, 60 * 1000);

  maintenanceInterval = setInterval(() => {
    runMaintenance();
  }, intervalMs);
}

export function stopMaintenanceScheduler() {
  if (maintenanceInterval) {
    clearInterval(maintenanceInterval);
    maintenanceInterval = null;
    console.log("[Maintenance] Scheduler stopped");
  }
}
