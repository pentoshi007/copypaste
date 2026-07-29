import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import Chat from "@/models/Chat";
import AppShell from "@/components/AppShell";
import {
  CHATS_LIMIT,
  CHAT_PROJECTION,
  NOTES_LIMIT,
  NOTE_PROJECTION,
  serializeChat,
  serializeNote,
} from "@/lib/serialize";
import type { NoteItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Middleware and the layout both gate this route, but don't rely on a
  // non-null assertion for an authorization guarantee — if either ever stops
  // matching this path, this must still fail closed.
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  await dbConnect();

  // Chats for this user, most recently active first.
  // Projection + .lean() skip Mongoose document hydration; the compound index
  // { userId, updatedAt: -1 } serves the sort without an in-memory pass.
  const chats = await Chat.find({ userId }, CHAT_PROJECTION)
    .sort({ updatedAt: -1 })
    .limit(CHATS_LIMIT)
    .lean();

  const serializedChats = chats.map(serializeChat);

  // Notes for the chat that opens by default.
  let serializedNotes: NoteItem[] = [];
  if (serializedChats.length > 0) {
    const notes = await Note.find(
      { userId, chatId: serializedChats[0]._id },
      NOTE_PROJECTION
    )
      // Newest-first so the cap keeps recent notes, then reversed for display.
      .sort({ createdAt: -1 })
      .limit(NOTES_LIMIT)
      .lean();

    serializedNotes = notes.map(serializeNote).reverse();
  }

  return (
    <AppShell initialChats={serializedChats} initialNotes={serializedNotes} />
  );
}
