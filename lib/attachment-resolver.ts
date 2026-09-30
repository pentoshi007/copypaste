import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";

export type ResolveResult =
  | { ok: true; storageKey: string }
  | { ok: false; status: number; error: string };

export async function resolveAttachmentKey(
  noteId: string,
  index: number | null
): Promise<ResolveResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  try {
    await dbConnect();

    const note = await Note.findOne(
      { _id: noteId, userId: session.user.id },
      { storageKey: 1, storage: 1, attachments: 1 }
    ).lean();

    if (!note) return { ok: false, status: 404, error: "File not found" };

    if (index !== null) {
      const match = note.attachments?.find(
        (a: { index?: number | null }) => a.index === index
      );
      if (!match || match.kind !== "file" || !match.storageKey) {
        return { ok: false, status: 404, error: "File not found" };
      }
      return { ok: true, storageKey: match.storageKey };
    }

    if (note.storage !== "r2" || !note.storageKey) {
      return { ok: false, status: 404, error: "File not found" };
    }
    return { ok: true, storageKey: note.storageKey };
  } catch {
    return { ok: false, status: 500, error: "Could not read the attachment" };
  }
}
