import mongoose from "mongoose";
import Block from "@/models/Block";
import Upload from "@/models/Upload";
import { rateLimit } from "@/lib/rateLimit";
import { releaseBlobs } from "@/lib/server/blobs";
import type { AttachmentKind } from "@/lib/attachments";

const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
const ORPHAN_TTL_MS = 60 * 60 * 1000;
const ORPHAN_SWEEP_INTERVAL = { maxAttempts: 1, windowMs: 10 * 60 * 1000 };
const ORPHAN_SWEEP_BATCH = 500;
const MAX_PENDING_UPLOADS = 100;

function parseQuota(): number {
  const parsed = Number(process.env.USER_STORAGE_QUOTA_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_QUOTA_BYTES;
}

export const USER_STORAGE_QUOTA_BYTES = parseQuota();

export interface PlannedUpload {
  kind: AttachmentKind;
  key: string;
  size: number;
}

interface UsageRow {
  total?: number;
}

async function storedBytes(userId: string): Promise<number> {
  const [row] = await Block.aggregate<UsageRow>([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $project: {
        items: {
          $concatArrays: [
            [
              {
                key: { $ifNull: [{ $cond: [{ $gt: ["$storageKey", ""] }, "$storageKey", "$publicId"] }, ""] },
                size: { $ifNull: ["$fileSize", 0] },
              },
            ],
            {
              $map: {
                input: { $ifNull: ["$attachments", []] },
                as: "a",
                in: {
                  key: { $cond: [{ $gt: ["$$a.storageKey", ""] }, "$$a.storageKey", "$$a.publicId"] },
                  size: { $ifNull: ["$$a.fileSize", 0] },
                },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$items" },
    { $match: { "items.key": { $nin: ["", null] } } },
    { $group: { _id: "$items.key", size: { $max: "$items.size" } } },
    { $group: { _id: null, total: { $sum: "$size" } } },
  ]);
  return row?.total ?? 0;
}

interface PendingRow {
  total?: number;
  count?: number;
}

async function pendingUsage(userId: string): Promise<{ bytes: number; count: number }> {
  const [row] = await Upload.aggregate<PendingRow>([
    { $match: { userId: new mongoose.Types.ObjectId(userId), consumedAt: null } },
    { $group: { _id: null, total: { $sum: "$size" }, count: { $sum: 1 } } },
  ]);
  return { bytes: row?.total ?? 0, count: row?.count ?? 0 };
}

export interface UploadAllowance {
  bytes: number;
  slots: number;
}

export async function uploadAllowance(userId: string): Promise<UploadAllowance> {
  const [stored, pending] = await Promise.all([storedBytes(userId), pendingUsage(userId)]);
  return {
    bytes: USER_STORAGE_QUOTA_BYTES - stored - pending.bytes,
    slots: MAX_PENDING_UPLOADS - pending.count,
  };
}

export async function reserveUploads(userId: string, planned: readonly PlannedUpload[]): Promise<void> {
  if (planned.length === 0) return;
  await Upload.insertMany(
    planned.map((upload) => ({ userId, kind: upload.kind, key: upload.key, size: upload.size })),
  );
}

export async function hasPendingUpload(userId: string, key: string): Promise<boolean> {
  return Boolean(await Upload.exists({ userId, key, consumedAt: null }));
}

export async function consumeUploads(userId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await Upload.updateMany(
    { userId, key: { $in: keys }, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
}

interface OrphanRow {
  _id: unknown;
  userId: unknown;
  kind: AttachmentKind;
  key: string;
}

export async function sweepOrphanUploads(): Promise<void> {
  if (!rateLimit("orphan-sweep", "global", ORPHAN_SWEEP_INTERVAL)) return;

  try {
    const orphans = await Upload.find(
      { consumedAt: null, createdAt: { $lt: new Date(Date.now() - ORPHAN_TTL_MS) } },
      { userId: 1, kind: 1, key: 1 },
    )
      .limit(ORPHAN_SWEEP_BATCH)
      .lean<OrphanRow[]>();
    if (orphans.length === 0) return;

    const byUser = new Map<string, OrphanRow[]>();
    for (const orphan of orphans) {
      const owner = String(orphan.userId);
      byUser.set(owner, [...(byUser.get(owner) ?? []), orphan]);
    }

    await Upload.deleteMany({ _id: { $in: orphans.map((orphan) => orphan._id) } });

    for (const [owner, rows] of byUser) {
      await releaseBlobs(owner, {
        objectKeys: rows.filter((row) => row.kind === "file").map((row) => row.key),
        publicIds: rows.filter((row) => row.kind === "image").map((row) => row.key),
      });
    }
  } catch {}
}
