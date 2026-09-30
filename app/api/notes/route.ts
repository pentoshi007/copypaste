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

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId || !OBJECT_ID.test(chatId)) {
    return NextResponse.json({ error: "Invalid chatId" }, { status: 400 });
  }

  try {
    await dbConnect();

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

      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}
