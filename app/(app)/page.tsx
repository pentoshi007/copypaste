import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import Chat from "@/models/Chat";
import AppShell from "@/components/AppShell";
import type { NoteItem, ChatItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  const userId = session!.user.id;

  await dbConnect();

  // Fetch all chats for this user, sorted by updatedAt desc (most recent first)
  // Use .select() projection + .lean() for fast read-only access
  const chats = (await Chat.find(
    { userId },
    { _id: 1, title: 1, createdAt: 1, updatedAt: 1 }
  )
    .sort({ updatedAt: -1 })
    .limit(200) // safety cap
    .lean()) as unknown as ChatItem[];

  const serializedChats: ChatItem[] = chats.map((c) => ({
    _id: String(c._id),
    title: c.title ?? "New Chat",
    createdAt: serializeDate(c.createdAt),
    updatedAt: serializeDate(c.updatedAt),
  }));

  // Fetch notes for the most recently updated chat (if any)
  // Use .select() projection + .lean() + .limit() for fast reads
  let serializedNotes: NoteItem[] = [];
  if (serializedChats.length > 0) {
    const activeChatId = serializedChats[0]._id;
    const notes = (await Note.find(
      { userId, chatId: activeChatId },
      {
        _id: 1,
        chatId: 1,
        type: 1,
        content: 1,
        imageUrl: 1,
        publicId: 1,
        language: 1,
        createdAt: 1,
      }
    )
      .sort({ createdAt: 1 }) // ascending — oldest first, like a chat
      .limit(500) // safety cap
      .lean()) as unknown as NoteItem[];

    serializedNotes = notes.map((n) => ({
      _id: String(n._id),
      chatId: String(n.chatId),
      type: n.type,
      content: n.content ?? "",
      imageUrl: n.imageUrl ?? "",
      publicId: n.publicId ?? "",
      language: n.language ?? "",
      createdAt: serializeDate(n.createdAt),
    }));
  }

  return (
    <AppShell
      initialChats={serializedChats}
      initialNotes={serializedNotes}
    />
  );
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
