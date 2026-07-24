import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import type { NoteItem } from "@/lib/types";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  if (!chatId) {
    return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR — never trust client chatId alone
    const notes = (await Note.find({ chatId, userId: session.user.id })
      .sort({ createdAt: 1 }) // ascending — oldest first, like a chat
      .lean()) as unknown as NoteItem[];

    const serialized: NoteItem[] = notes.map((n) => ({
      _id: String(n._id),
      chatId: String(n.chatId),
      type: n.type,
      content: n.content ?? "",
      imageUrl: n.imageUrl ?? "",
      publicId: n.publicId ?? "",
      language: n.language ?? "",
      createdAt:
        typeof n.createdAt === "string"
          ? n.createdAt
          : new Date(n.createdAt as unknown as string).toISOString(),
    }));

    return NextResponse.json({ notes: serialized });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}
