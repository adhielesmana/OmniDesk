import { db } from "./db";
import { whatsappAuthState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { 
  AuthenticationCreds, 
  AuthenticationState, 
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
  proto
} from "@whiskeysockets/baileys";

const KEY_PREFIX = "auth_";
const CREDS_KEY = "creds";

export async function useDbAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearCreds: () => Promise<void>;
}> {
  
  const writeData = async (key: string, data: any): Promise<void> => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await db.insert(whatsappAuthState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: whatsappAuthState.key,
        set: { value, updatedAt: new Date() }
      });
  };

  const readData = async (key: string): Promise<any | null> => {
    const result = await db.select()
      .from(whatsappAuthState)
      .where(eq(whatsappAuthState.key, key))
      .limit(1);
    
    if (result.length === 0) return null;
    return JSON.parse(result[0].value, BufferJSON.reviver);
  };

  const removeData = async (key: string): Promise<void> => {
    await db.delete(whatsappAuthState)
      .where(eq(whatsappAuthState.key, key));
  };

  const clearAllData = async (): Promise<void> => {
    await db.delete(whatsappAuthState);
  };

  // Load or initialize credentials
  const creds: AuthenticationCreds = await readData(CREDS_KEY) || initAuthCreds();

  // Create state object first so saveCreds can reference state.creds (which Baileys mutates)
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        const data: { [id: string]: SignalDataTypeMap[T] } = {};
        await Promise.all(
          ids.map(async (id) => {
            const key = `${KEY_PREFIX}${type}-${id}`;
            let value = await readData(key);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            if (value) {
              data[id] = value;
            }
          })
        );
        return data;
      },
      set: async (data: any): Promise<void> => {
        const tasks: Promise<void>[] = [];
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${KEY_PREFIX}${category}-${id}`;
            tasks.push(
              value ? writeData(key, value) : removeData(key)
            );
          }
        }
        await Promise.all(tasks);
      }
    }
  };

  return {
    state,
    // saveCreds must write state.creds (not the original creds variable) because Baileys mutates state.creds directly
    saveCreds: async (): Promise<void> => {
      await writeData(CREDS_KEY, state.creds);
    },
    clearCreds: async (): Promise<void> => {
      await clearAllData();
    }
  };
}

export async function hasDbAuthCreds(): Promise<boolean> {
  const result = await db.select()
    .from(whatsappAuthState)
    .where(eq(whatsappAuthState.key, CREDS_KEY))
    .limit(1);
  return result.length > 0;
}

export async function clearDbAuthCreds(): Promise<void> {
  await db.delete(whatsappAuthState);
}
