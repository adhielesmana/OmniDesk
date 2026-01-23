import { storage } from "./storage";
import { MetaApiService } from "./meta-api";
import type { Platform } from "@shared/schema";

const VALIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function validatePlatformToken(platform: Platform): Promise<{
  valid: boolean;
  status: string;
  error?: string;
  expiresAt?: Date | null;
  scopes?: string[];
  missingPermissions?: string[];
}> {
  const settings = await storage.getPlatformSetting(platform);
  
  // For Instagram, always check if Facebook token is available (required for Instagram Messaging API)
  if (platform === "instagram") {
    const fbSettings = await storage.getPlatformSetting("facebook");
    
    if (!settings?.businessId) {
      await storage.updatePlatformSetting(platform, {
        tokenStatus: "no_token",
        tokenError: "Instagram Business Account ID is not configured",
        lastTokenValidatedAt: new Date(),
      });
      return { valid: false, status: "no_token", error: "Instagram Business Account ID is not configured" };
    }
    
    if (!fbSettings?.accessToken) {
      await storage.updatePlatformSetting(platform, {
        tokenStatus: "no_token",
        tokenError: "Instagram requires Facebook Page Access Token. Please configure Facebook first.",
        lastTokenValidatedAt: new Date(),
      });
      return { valid: false, status: "no_token", error: "Instagram requires Facebook Page Access Token. Please configure Facebook first." };
    }
  }
  
  if (!settings?.accessToken && platform !== "instagram") {
    return { valid: false, status: "no_token", error: "No access token configured" };
  }

  try {
    let tokenToValidate = settings?.accessToken || "";
    let businessIdToUse = settings?.businessId || undefined;
    
    // For Instagram, always use Facebook Page Access Token
    if (platform === "instagram") {
      const fbSettings = await storage.getPlatformSetting("facebook");
      if (fbSettings?.accessToken) {
        tokenToValidate = fbSettings.accessToken;
        console.log(`[Token Validator] Instagram using Facebook Page Access Token`);
      }
    }
    
    const metaApi = new MetaApiService(platform, {
      accessToken: tokenToValidate,
      pageId: settings?.pageId || undefined,
      businessId: businessIdToUse,
      phoneNumberId: settings?.phoneNumberId || undefined,
    });

    const result = await metaApi.validateToken();
    
    let status = "valid";
    if (!result.valid) {
      status = result.isExpired ? "expired" : "invalid";
    } else if (result.missingPermissions && result.missingPermissions.length > 0) {
      status = "missing_permissions";
    }

    // Update platform settings with validation results
    await storage.updatePlatformSetting(platform, {
      tokenStatus: status,
      tokenError: result.error || null,
      tokenExpiresAt: result.expiresAt || null,
      tokenScopes: result.scopes ? JSON.stringify(result.scopes) : null,
      tokenMissingPermissions: result.missingPermissions ? JSON.stringify(result.missingPermissions) : null,
      lastTokenValidatedAt: new Date(),
    });

    console.log(`[Token Validator] ${platform}: status=${status}${result.error ? `, error=${result.error}` : ""}`);
    
    return {
      valid: result.valid,
      status,
      error: result.error,
      expiresAt: result.expiresAt,
      scopes: result.scopes,
      missingPermissions: result.missingPermissions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Validation failed";
    
    await storage.updatePlatformSetting(platform, {
      tokenStatus: "error",
      tokenError: errorMessage,
      lastTokenValidatedAt: new Date(),
    });
    
    console.error(`[Token Validator] ${platform} error:`, errorMessage);
    return { valid: false, status: "error", error: errorMessage };
  }
}

export async function validateAllPlatformTokens(): Promise<void> {
  console.log("[Token Validator] Starting validation of all platform tokens...");
  
  const platforms: Platform[] = ["facebook", "instagram", "whatsapp"];
  
  for (const platform of platforms) {
    const settings = await storage.getPlatformSetting(platform);
    
    // Skip WhatsApp as it uses a different auth mechanism (QR code or Twilio)
    if (platform === "whatsapp") {
      continue;
    }
    
    // Only validate if there's a token configured
    if (settings?.accessToken) {
      await validatePlatformToken(platform);
    } else {
      console.log(`[Token Validator] ${platform}: No token configured, skipping`);
    }
  }
  
  console.log("[Token Validator] Completed validation of all platform tokens");
}

let validationInterval: NodeJS.Timeout | null = null;

export function startTokenValidationScheduler(): void {
  console.log("[Token Validator] Starting automatic token validation scheduler");
  console.log(`[Token Validator] Will validate tokens every 6 hours`);
  
  // Run initial validation after 10 seconds (allow server to fully start)
  setTimeout(() => {
    validateAllPlatformTokens().catch((err) => {
      console.error("[Token Validator] Initial validation error:", err);
    });
  }, 10000);
  
  // Schedule periodic validation
  validationInterval = setInterval(() => {
    validateAllPlatformTokens().catch((err) => {
      console.error("[Token Validator] Scheduled validation error:", err);
    });
  }, VALIDATION_INTERVAL_MS);
}

export function stopTokenValidationScheduler(): void {
  if (validationInterval) {
    clearInterval(validationInterval);
    validationInterval = null;
    console.log("[Token Validator] Stopped automatic token validation scheduler");
  }
}
