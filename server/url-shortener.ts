import { storage } from "./storage";

const SHORT_CODE_LENGTH = 8;
const SHORT_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generateShortCode(): string {
  let result = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    result += SHORT_CODE_CHARS.charAt(Math.floor(Math.random() * SHORT_CODE_CHARS.length));
  }
  return result;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

export async function shortenUrlsInText(
  text: string,
  baseUrl: string,
  clientId?: string
): Promise<string> {
  const urls = text.match(URL_REGEX);
  
  if (!urls || urls.length === 0) {
    return text;
  }

  let shortenedText = text;
  const uniqueUrls = Array.from(new Set(urls));

  for (const originalUrl of uniqueUrls) {
    try {
      let shortCode = generateShortCode();
      let attempts = 0;
      
      while (attempts < 5) {
        const existing = await storage.getShortenedUrlByCode(shortCode);
        if (!existing) break;
        shortCode = generateShortCode();
        attempts++;
      }

      if (attempts >= 5) {
        console.error("Failed to generate unique short code after 5 attempts");
        continue;
      }

      await storage.createShortenedUrl({
        shortCode,
        originalUrl,
        clientId: clientId || null,
        expiresAt: null,
      });

      const shortUrl = `${baseUrl}/s/${shortCode}`;
      shortenedText = shortenedText.split(originalUrl).join(shortUrl);
      
      console.log(`Shortened URL: ${originalUrl.substring(0, 50)}... -> ${shortUrl}`);
    } catch (error) {
      console.error(`Failed to shorten URL ${originalUrl}:`, error);
    }
  }

  return shortenedText;
}

export async function resolveShortUrl(shortCode: string): Promise<string | null> {
  const shortenedUrl = await storage.getShortenedUrlByCode(shortCode);
  
  if (!shortenedUrl) {
    return null;
  }

  if (shortenedUrl.expiresAt && new Date(shortenedUrl.expiresAt) < new Date()) {
    return null;
  }

  await storage.incrementShortenedUrlClickCount(shortCode);
  
  return shortenedUrl.originalUrl;
}
