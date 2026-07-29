import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import { getObjectRange, getR2Config } from "@/lib/r2";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/preview";

/**
 * Returns the head of a text attachment for in-app preview.
 *
 * Text files are the one case we proxy rather than redirect. Serving them inline
 * straight from the storage origin would make an uploaded `.html` file a
 * stored-XSS vector on that hostname, so instead this route reads a bounded
 * Range and hands it back as JSON — the client renders it as escaped text.
 *
 * A Range request keeps this cheap: previewing a 50MB log costs one 512KB read.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { noteId } = await params;
  if (!OBJECT_ID.test(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: "File storage isn't configured" },
      { status: 503 }
    );
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId — the note id alone must never grant access.
    const note = await Note.findOne(
      { _id: noteId, userId: session.user.id },
      { storageKey: 1, storage: 1 }
    ).lean();

    if (!note?.storageKey || note.storage !== "r2") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const result = await getObjectRange(
      config,
      note.storageKey,
      TEXT_PREVIEW_MAX_BYTES
    );
    if (!result) {
      return NextResponse.json(
        { error: "Could not read the file" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { text: result.body, truncated: result.truncated },
      {
        headers: {
          "Cache-Control": "private, no-store",
          // Belt and braces: this is JSON, never a document to render.
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read the file" },
      { status: 500 }
    );
  }
}
