import { after } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import dbConnect from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import {
  MAX_FILES_PER_UPLOAD,
  MAX_IMAGE_BYTES,
  UPLOAD_AUTHORIZATION_LIMIT,
  attachmentKind,
} from "@/lib/attachments";
import { currentUserId } from "@/lib/server/auth";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";
import {
  uploadAllowance,
  reserveUploads,
  sweepOrphanUploads,
  type PlannedUpload,
} from "@/lib/server/uploads";

const MAX_NAME_LENGTH = 255;

interface Sign {
  index: number;
  signature: string;
  timestamp: number;
  publicId: string;
}

export async function POST(request: Request) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!apiKey || !apiSecret || !cloudName) return jsonError("Image uploads aren't configured", 503);

  const raw = await request.json().catch(() => null);
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return jsonError("Expected { files: [...] }", 400);
  if (files.length === 0 || files.length > MAX_FILES_PER_UPLOAD) {
    return jsonError(`Select between 1 and ${MAX_FILES_PER_UPLOAD} images`, 400);
  }

  if (!rateLimit("upload-sign", userId, UPLOAD_AUTHORIZATION_LIMIT)) {
    return jsonError("Too many uploads. Please wait a moment.", 429);
  }

  try {
    await dbConnect();
    const allowance = await uploadAllowance(userId);
    if (allowance.slots < files.length) {
      return jsonError("Too many unfinished uploads. Please wait a moment.", 429);
    }
    let budget = allowance.bytes;

    const signs: Sign[] = [];
    const planned: PlannedUpload[] = [];
    const errors: { index: number; error: string }[] = [];

    for (const [index, entry] of files.entries()) {
      const record = (entry ?? {}) as Record<string, unknown>;
      const fileName = typeof record.fileName === "string" ? record.fileName.slice(0, MAX_NAME_LENGTH) : "";
      const contentType = typeof record.contentType === "string" ? record.contentType : "";
      const size = typeof record.size === "number" ? record.size : NaN;

      if (!contentType || attachmentKind(contentType, fileName) !== "image") {
        errors.push({ index, error: "That file isn't an image" });
        continue;
      }
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
        errors.push({ index, error: "Image is too large (max 10MB)" });
        continue;
      }
      if (MAX_IMAGE_BYTES > budget) {
        errors.push({ index, error: "Storage quota exceeded — delete some files first" });
        continue;
      }

      const publicId = `u/${userId}/${crypto.randomUUID().replace(/-/g, "")}`;
      const timestamp = Math.round(Date.now() / 1000);

      try {
        const signature = cloudinary.utils.api_sign_request({ public_id: publicId, timestamp }, apiSecret);
        budget -= MAX_IMAGE_BYTES;
        planned.push({ kind: "image", key: publicId, size: MAX_IMAGE_BYTES });
        signs.push({ index, signature, timestamp, publicId });
      } catch {
        errors.push({ index, error: "Failed to authorize upload" });
      }
    }

    await reserveUploads(userId, planned);
    after(sweepOrphanUploads);

    return jsonPrivate({ signs, errors, apiKey, cloudName });
  } catch {
    return jsonError("Failed to authorize upload", 500);
  }
}
