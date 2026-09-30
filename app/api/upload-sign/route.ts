import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rateLimit";
import { attachmentKind, MAX_FILES_PER_NOTE } from "@/lib/attachments";
import { v2 as cloudinary } from "cloudinary";

const MAX_NAME_LENGTH = 255;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!apiKey || !apiSecret || !cloudName) {
    return NextResponse.json(
      { error: "Image uploads aren't configured" },
      { status: 503 }
    );
  }

  const raw = await request.json().catch(() => null);
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) {
    return NextResponse.json(
      { error: "Expected { files: [...] }" },
      { status: 400 }
    );
  }
  if (files.length === 0 || files.length > MAX_FILES_PER_NOTE) {
    return NextResponse.json(
      { error: `Select between 1 and ${MAX_FILES_PER_NOTE} images` },
      { status: 400 }
    );
  }

  if (
    !rateLimit("upload-sign", session.user.id, {
      maxAttempts: MAX_FILES_PER_NOTE,
      windowMs: 60_000,
    })
  ) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429 }
    );
  }

  const signs: {
    index: number;
    signature: string;
    timestamp: number;
    publicId: string;
  }[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, entry] of files.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const fileName =
      typeof record.fileName === "string"
        ? record.fileName.slice(0, MAX_NAME_LENGTH)
        : "";
    const contentType =
      typeof record.contentType === "string" ? record.contentType : "";

    if (!contentType || attachmentKind(contentType, fileName) !== "image") {
      errors.push({ index, error: "That file isn't an image" });
      continue;
    }

    const publicId = `u/${session.user.id}/${crypto
      .randomUUID()
      .replace(/-/g, "")}`;
    const timestamp = Math.round(Date.now() / 1000);

    try {
      const signature = cloudinary.utils.api_sign_request(
        { public_id: publicId, timestamp },
        apiSecret
      );
      signs.push({ index, signature, timestamp, publicId });
    } catch {
      errors.push({ index, error: "Failed to authorize upload" });
    }
  }

  return NextResponse.json(
    { signs, errors, apiKey, cloudName },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
