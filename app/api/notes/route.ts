import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import {
  NOTES_LIMIT,
  NOTE_PROJECTION,
  serializeNote,
} from "@/lib/serialize";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  // Validate before touching the DB: an unparseable id would otherwise reach
  // Mongoose and surface as a CastError-driven 500 instead of a 400.
  if (!chatId || !OBJECT_ID.test(chatId)) {
    return NextResponse.json({ error: "Invalid chatId" }, { status: 400 });
  }

  // Auth and the connection handshake don't depend on each other.
  const [session] = await Promise.all([auth(), dbConnect()]);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // CRITICAL: scope by userId to prevent IDOR — never trust client chatId alone.
    // Sorted newest-first so the cap keeps the *recent* notes (sorting ascending
    // with a limit silently dropped the newest notes in long chats), then
    // reversed for oldest-first chat order.
    const notes = await Note.find(
      { chatId, userId: session.user.id },
      NOTE_PROJECTION
    )
      .sort({ createdAt: -1 })
      .limit(NOTES_LIMIT)
      .lean();

    const serialized = notes.map(serializeNote).reverse();

    return NextResponse.json(
      { notes: serialized },
      // Per-user data: never store it in a shared or disk cache.
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}
