import dbConnect from "@/lib/db";
import Block from "@/models/Block";
import PageModel from "@/models/Page";
import { rateLimit } from "@/lib/rateLimit";
import { BLOB_PROJECTION, collectBlobs, releaseBlobs, type BlobHolder } from "@/lib/server/blobs";
import { removePagesPermanently } from "@/lib/server/pages";

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_DAYS = 30;
const DELETED_BLOCK_RETENTION_MS = 7 * DAY_MS;
const PURGE_INTERVAL = { maxAttempts: 1, windowMs: 6 * 60 * 60 * 1000 };

export async function purgeExpired(userId: string): Promise<void> {
  if (!rateLimit("purge", userId, PURGE_INTERVAL)) return;

  try {
    await dbConnect();
    const now = Date.now();

    const expiredPages = await PageModel.find(
      { userId, deletedAt: { $lt: new Date(now - TRASH_RETENTION_DAYS * DAY_MS) } },
      { _id: 1 },
    ).lean<{ _id: unknown }[]>();
    const pageRefs = await removePagesPermanently(
      userId,
      expiredPages.map((page) => String(page._id)),
    );

    const blockFilter = {
      userId,
      deletedAt: { $lt: new Date(now - DELETED_BLOCK_RETENTION_MS) },
    };
    const expiredBlocks = await Block.find(blockFilter, BLOB_PROJECTION).lean<BlobHolder[]>();
    await Block.deleteMany(blockFilter);
    const blockRefs = collectBlobs(expiredBlocks);

    await releaseBlobs(userId, {
      objectKeys: [...pageRefs.objectKeys, ...blockRefs.objectKeys],
      publicIds: [...pageRefs.publicIds, ...blockRefs.publicIds],
    });
  } catch {}
}
