import { NextResponse } from "next/server";
import { getR2Config, presignGet } from "@/lib/r2";
import {
  isCrossSiteSubresource,
  OBJECT_ID,
  parseAttachmentIndex,
} from "@/lib/attachment-request";
import { resolveAttachmentKey } from "@/lib/attachment-resolver";

const DOWNLOAD_TTL_SECONDS = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  if (isCrossSiteSubresource(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { noteId } = await params;
  if (!OBJECT_ID.test(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const index = parseAttachmentIndex(request.url);
  if (index !== null && index < 0) {
    return NextResponse.json(
      { error: "Invalid attachment index" },
      { status: 400 }
    );
  }

  const resolved = await resolveAttachmentKey(noteId, index);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status }
    );
  }

  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: "File storage isn't configured" },
      { status: 503 }
    );
  }

  try {
    const url = await presignGet(
      config,
      resolved.storageKey,
      DOWNLOAD_TTL_SECONDS
    );

    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not prepare the download" },
      { status: 500 }
    );
  }
}
