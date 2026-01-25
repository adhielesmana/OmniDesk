import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { storage } from "./storage";
import { Readable } from "stream";

interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint: string;
  usePathStyleEndpoint: boolean;
}

let s3Client: S3Client | null = null;
let currentConfig: S3Config | null = null;

export async function getS3Config(): Promise<S3Config | null> {
  const accessKeyId = await storage.getAppSetting("s3_access_key_id");
  const secretAccessKey = await storage.getAppSetting("s3_secret_access_key");
  const region = await storage.getAppSetting("s3_region");
  const bucket = await storage.getAppSetting("s3_bucket");
  const endpoint = await storage.getAppSetting("s3_endpoint");
  const usePathStyle = await storage.getAppSetting("s3_use_path_style");

  if (!accessKeyId?.value || !secretAccessKey?.value || !bucket?.value) {
    return null;
  }

  return {
    accessKeyId: accessKeyId.value,
    secretAccessKey: secretAccessKey.value,
    region: region?.value || "us-east-1",
    bucket: bucket.value,
    endpoint: endpoint?.value || "",
    usePathStyleEndpoint: usePathStyle?.value === "true",
  };
}

function configsMatch(a: S3Config | null, b: S3Config | null): boolean {
  if (!a || !b) return false;
  return a.accessKeyId === b.accessKeyId &&
    a.secretAccessKey === b.secretAccessKey &&
    a.region === b.region &&
    a.bucket === b.bucket &&
    a.endpoint === b.endpoint &&
    a.usePathStyleEndpoint === b.usePathStyleEndpoint;
}

export async function getS3Client(): Promise<S3Client | null> {
  const config = await getS3Config();
  if (!config) {
    return null;
  }

  if (s3Client && configsMatch(currentConfig, config)) {
    return s3Client;
  }

  const clientConfig: any = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.usePathStyleEndpoint,
  };

  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  s3Client = new S3Client(clientConfig);
  currentConfig = config;
  return s3Client;
}

export async function isS3Configured(): Promise<boolean> {
  const config = await getS3Config();
  return config !== null;
}

export async function testS3Connection(): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await getS3Client();
    const config = await getS3Config();
    
    if (!client || !config) {
      return { success: false, error: "S3 not configured" };
    }

    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { success: true };
  } catch (error: any) {
    console.error("[S3] Connection test failed:", error);
    return { success: false, error: error.message || "Connection failed" };
  }
}

export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const client = await getS3Client();
    const config = await getS3Config();
    
    if (!client || !config) {
      return { success: false, error: "S3 not configured" };
    }

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "public-read",
    }));

    let url: string;
    if (config.usePathStyleEndpoint && config.endpoint) {
      url = `${config.endpoint}/${config.bucket}/${key}`;
    } else if (config.endpoint) {
      const endpointUrl = new URL(config.endpoint);
      url = `${endpointUrl.protocol}//${config.bucket}.${endpointUrl.host}/${key}`;
    } else {
      url = `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
    }

    console.log(`[S3] Uploaded: ${key} -> ${url}`);
    return { success: true, url };
  } catch (error: any) {
    console.error("[S3] Upload failed:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
}

export async function downloadFromS3(key: string): Promise<{ success: boolean; data?: Buffer; contentType?: string; error?: string }> {
  try {
    const client = await getS3Client();
    const config = await getS3Config();
    
    if (!client || !config) {
      return { success: false, error: "S3 not configured" };
    }

    const response = await client.send(new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    if (!response.Body) {
      return { success: false, error: "No body in response" };
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    
    const data = Buffer.concat(chunks);
    return { 
      success: true, 
      data,
      contentType: response.ContentType 
    };
  } catch (error: any) {
    console.error("[S3] Download failed:", error);
    return { success: false, error: error.message || "Download failed" };
  }
}

export async function deleteFromS3(key: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = await getS3Client();
    const config = await getS3Config();
    
    if (!client || !config) {
      return { success: false, error: "S3 not configured" };
    }

    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    console.log(`[S3] Deleted: ${key}`);
    return { success: true };
  } catch (error: any) {
    console.error("[S3] Delete failed:", error);
    return { success: false, error: error.message || "Delete failed" };
  }
}

export async function uploadMediaFromUrl(
  url: string,
  folder: string,
  filenameBase: string,
  authHeaders?: Record<string, string>
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: authHeaders,
    });

    if (!response.ok) {
      return { success: false, error: `Failed to fetch media: ${response.status}` };
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await response.arrayBuffer());
    
    const ext = getExtensionFromContentType(contentType);
    const baseWithoutExt = filenameBase.replace(/\.[^/.]+$/, "");
    const filename = `${baseWithoutExt}${ext}`;
    
    const key = `${folder}/${filename}`;
    return await uploadToS3(key, buffer, contentType);
  } catch (error: any) {
    console.error("[S3] Upload from URL failed:", error);
    return { success: false, error: error.message || "Upload failed" };
  }
}

export function getExtensionFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  };
  return map[contentType] || ".bin";
}
