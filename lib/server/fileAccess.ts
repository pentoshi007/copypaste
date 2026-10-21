import dbConnect from "@/lib/db";
import Block from "@/models/Block";
import { currentUserId } from "@/lib/server/auth";

export type ResolveResult = { ok: true; storageKey: string } | { ok: false; status: number; error: string };

interface FileHolder {
  storageKey?: string | null;
  attachments?: { index?: number | null; kind?: string | null; storageKey?: string | null }[] | null;
}

const NOT_FOUND: ResolveResult = { ok: false, status: 404, error: "File not found" };

export async function resolveFileKey(blockId: string, index: number | null): Promise<ResolveResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  try {
    await dbConnect();

    const block = await Block.findOne(
      { _id: blockId, userId },
      { storageKey: 1, "attachments.index": 1, "attachments.kind": 1, "attachments.storageKey": 1 },
    ).lean<FileHolder>();

    if (!block) return NOT_FOUND;

    if (index !== null) {
      const match = block.attachments?.find((attachment) => attachment.index === index);
      if (!match || match.kind !== "file" || !match.storageKey) return NOT_FOUND;
      return { ok: true, storageKey: match.storageKey };
    }

    return block.storageKey ? { ok: true, storageKey: block.storageKey } : NOT_FOUND;
  } catch {
    return { ok: false, status: 500, error: "Could not read the attachment" };
  }
}
