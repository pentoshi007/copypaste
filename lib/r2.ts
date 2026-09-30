import { AwsClient } from "aws4fetch";
import { isInlineViewable } from "@/lib/preview";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024;

function parseMaxFileBytes(): number {
  const raw = process.env.R2_MAX_FILE_BYTES;
  if (!raw) return DEFAULT_MAX_FILE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_FILE_BYTES;
  return Math.floor(parsed);
}

export const MAX_FILE_BYTES = parseMaxFileBytes();

let cachedClient: AwsClient | null = null;

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function getClient(config: R2Config): AwsClient {
  if (!cachedClient) {
    cachedClient = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }
  return cachedClient;
}

function objectEndpoint(config: R2Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encoded}`;
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f"'\\/]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned.replace(/^\.+/, "").slice(0, 120);
  return safe || "file";
}

export function buildFileKey(userId: string, fileName: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return `f/${userId}/${id}/${sanitizeFileName(fileName)}`;
}

export function contentDispositionFor(
  fileName: string,
  mimeType = ""
): string {
  const safe = sanitizeFileName(fileName);
  const ascii = safe.replace(/[^\u0020-\u007e]/g, "_");
  const kind = isInlineViewable(mimeType, safe) ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    safe
  )}`;
}

export async function getObjectRange(
  config: R2Config,
  key: string,
  maxBytes: number
): Promise<{ body: string; truncated: boolean } | null> {
  const client = getClient(config);
  try {
    const res = await client.fetch(objectEndpoint(config, key), {
      method: "GET",
      headers: { Range: `bytes=0-${maxBytes - 1}` },
    });

    if (res.status !== 200 && res.status !== 206) return null;
    const body = await res.text();
    return { body, truncated: res.status === 206 };
  } catch {
    return null;
  }
}

export function isOwnedFileKey(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  if (key.length > 512) return false;

  if (!/^[a-f0-9]{24}$/i.test(userId)) return false;

  if (key.includes("..") || key.includes("//") || key.startsWith("/")) {
    return false;
  }
  return key.startsWith(`f/${userId}/`);
}

export type ObjectMetadata = {
  size: number;
  contentType: string;
};

export async function headObject(
  config: R2Config,
  key: string
): Promise<ObjectMetadata | null> {
  const client = getClient(config);
  try {
    const res = await client.fetch(objectEndpoint(config, key), {
      method: "HEAD",
    });
    if (!res.ok) return null;
    return {
      size: Number(res.headers.get("content-length") ?? 0),
      contentType:
        res.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function presignPut(
  config: R2Config,
  key: string,
  expiresInSeconds = 900
): Promise<string> {
  const client = getClient(config);
  const url = `${objectEndpoint(config, key)}?X-Amz-Expires=${expiresInSeconds}`;
  const signed = await client.sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url.toString();
}

export async function presignGet(
  config: R2Config,
  key: string,
  expiresInSeconds = 300
): Promise<string> {
  const client = getClient(config);
  const url = `${objectEndpoint(config, key)}?X-Amz-Expires=${expiresInSeconds}`;
  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url.toString();
}

export async function deleteObjects(
  config: R2Config,
  keys: string[]
): Promise<void> {
  const client = getClient(config);
  await Promise.allSettled(
    keys
      .filter(Boolean)
      .map((key) =>
        client.fetch(objectEndpoint(config, key), { method: "DELETE" })
      )
  );
}
