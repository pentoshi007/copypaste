import Block from "@/models/Block";
import { deleteObjects, getR2Config } from "@/lib/r2";
import { destroyImages } from "@/lib/server/cloudinary";

export interface BlobRefs {
  objectKeys: string[];
  publicIds: string[];
}

export interface BlobHolder {
  publicId?: string | null;
  storageKey?: string | null;
  attachments?: ({ publicId?: string | null; storageKey?: string | null } | null)[] | null;
}

export const BLOB_PROJECTION = {
  publicId: 1,
  storageKey: 1,
  "attachments.publicId": 1,
  "attachments.storageKey": 1,
} as const;

export function collectBlobs(holders: readonly BlobHolder[]): BlobRefs {
  const objectKeys = new Set<string>();
  const publicIds = new Set<string>();
  for (const holder of holders) {
    if (holder.storageKey) objectKeys.add(holder.storageKey);
    if (holder.publicId) publicIds.add(holder.publicId);
    for (const attachment of holder.attachments ?? []) {
      if (attachment?.storageKey) objectKeys.add(attachment.storageKey);
      if (attachment?.publicId) publicIds.add(attachment.publicId);
    }
  }
  return { objectKeys: [...objectKeys], publicIds: [...publicIds] };
}

export function hasBlobs(refs: BlobRefs): boolean {
  return refs.objectKeys.length > 0 || refs.publicIds.length > 0;
}

async function destroyBlobs(refs: BlobRefs): Promise<void> {
  const config = refs.objectKeys.length > 0 ? getR2Config() : null;
  await Promise.allSettled([
    config ? deleteObjects(config, refs.objectKeys) : Promise.resolve(),
    destroyImages(refs.publicIds),
  ]);
}

export async function releaseBlobs(userId: string, refs: BlobRefs): Promise<void> {
  if (!hasBlobs(refs)) return;

  const stillUsed = await Block.find(
    {
      userId,
      $or: [
        { storageKey: { $in: refs.objectKeys } },
        { "attachments.storageKey": { $in: refs.objectKeys } },
        { publicId: { $in: refs.publicIds } },
        { "attachments.publicId": { $in: refs.publicIds } },
      ],
    },
    BLOB_PROJECTION,
  ).lean<BlobHolder[]>();

  const used = collectBlobs(stillUsed);
  const usedKeys = new Set(used.objectKeys);
  const usedIds = new Set(used.publicIds);

  await destroyBlobs({
    objectKeys: refs.objectKeys.filter((key) => !usedKeys.has(key)),
    publicIds: refs.publicIds.filter((publicId) => !usedIds.has(publicId)),
  });
}
