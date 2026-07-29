import { AwsClient } from "aws4fetch";

/**
 * Cloudflare R2 access for file attachments (everything that isn't an image —
 * images stay on Cloudinary, which gives us delivery-time transforms).
 *
 * Design notes:
 *
 * - The bucket stays **private**. Nothing is world-readable, which matters for
 *   a personal clipboard. That means no Public Development URL and no custom
 *   domain are required.
 * - Uploads: we sign a short-lived PUT and the browser sends bytes straight to
 *   R2. They never pass through this server, so upload speed is one hop to
 *   Cloudflare's edge and costs us no bandwidth.
 * - Downloads: we check note ownership, then redirect to a short-lived signed
 *   GET. Because that's a top-level navigation, no CORS is involved.
 * - `Content-Disposition` is stored on the object at upload time (R2 supports it
 *   as PutObject system metadata), so a plain GET downloads with the original
 *   filename. R2 does *not* support the `response-content-disposition` query
 *   override on GetObject, which is why it has to be set on the way in.
 */

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const DEFAULT_MAX_FILE_BYTES = 100 * 1024 * 1024; // 100MB

/**
 * Refuse uploads beyond this. Keeps the 10GB free tier predictable.
 *
 * Parsed defensively: a malformed env value used to produce NaN, and every
 * `size > NaN` comparison is false, which silently disabled the cap entirely.
 */
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
      region: "auto", // R2 ignores the region, but SigV4 requires one
    });
  }
  return cachedClient;
}

/** Path-style object endpoint: https://<account>.r2.cloudflarestorage.com/<bucket>/<key> */
function objectEndpoint(config: R2Config, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${encoded}`;
}

/** Strips anything that could confuse a path, a header, or a filesystem. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    // Control characters, quotes and path separators.
    .replace(/[\u0000-\u001f\u007f"'\\/]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = cleaned.replace(/^\.+/, "").slice(0, 120);
  return safe || "file";
}

/**
 * Object keys are namespaced by the authenticated user id and carry a random
 * segment, so uploads can't collide or be guessed. The sanitized filename is
 * kept as the last segment purely so keys are readable in the dashboard.
 */
export function buildFileKey(userId: string, fileName: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return `f/${userId}/${id}/${sanitizeFileName(fileName)}`;
}

/**
 * Builds a `Content-Disposition` value that survives non-ASCII filenames.
 *
 * The plain `filename=` parameter is ASCII-only for old clients; `filename*`
 * carries the real UTF-8 name per RFC 5987.
 */
export function contentDispositionFor(fileName: string): string {
  const safe = sanitizeFileName(fileName);
  const ascii = safe.replace(/[^\u0020-\u007e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    safe
  )}`;
}

/**
 * Whether an object key belongs to this user.
 *
 * This is the check that stops one user from attaching another user's file.
 * The key arrives from the browser when a note is created, so it must never be
 * trusted: without this, an attacker could submit `f/<victimId>/.../secret.pdf`
 * as their own note and then download it through the ownership-checked route.
 */
export function isOwnedFileKey(key: string, userId: string): boolean {
  if (!key || !userId) return false;
  if (key.length > 512) return false;
  // Defensive: a userId containing a separator would let the prefix check be
  // satisfied by a key in someone else's namespace.
  if (!/^[a-f0-9]{24}$/i.test(userId)) return false;
  // No traversal, no doubled separators, no absolute paths.
  if (key.includes("..") || key.includes("//") || key.startsWith("/")) {
    return false;
  }
  return key.startsWith(`f/${userId}/`);
}

export type ObjectMetadata = {
  size: number;
  contentType: string;
};

/**
 * Reads an object's real size and content type.
 *
 * Used to verify an upload actually landed before a note referencing it is
 * saved, and to record the true size rather than a client-reported number.
 * HeadObject is a Class B operation (10M/month free).
 */
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

/**
 * Presigns a PUT.
 *
 * Only `host` is signed (aws4fetch's default). `Content-Type` and
 * `Content-Disposition` are sent by the browser unsigned — R2 still stores them
 * as system metadata, and leaving them out of the signature means a mangled or
 * proxy-rewritten header can't break the upload. Because the bucket is private
 * and downloads are forced to `attachment`, a wrong stored content type has no
 * security impact here.
 */
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

/** Presigns a GET, used for ownership-checked downloads. */
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

/**
 * Deletes objects, ignoring individual failures.
 *
 * DeleteObject is free on R2, so one request per key costs nothing and avoids
 * hand-rolling the batch-delete XML payload.
 */
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
