import {
  attachmentKind,
  MAX_GROUP_BYTES,
  type AttachmentRef,
} from "@/lib/attachments";
import { deleteObjects, getR2Config } from "@/lib/r2";

export type StorageKind = "cloudinary" | "r2" | "mixed" | "none";

export function storageKindFor(
  attachments: { publicId?: string; storageKey?: string }[]
): StorageKind {
  const kinds = new Set<"cloudinary" | "r2">();
  for (const a of attachments) {
    if (a.publicId) kinds.add("cloudinary");
    if (a.storageKey) kinds.add("r2");
  }
  if (kinds.size === 0) return "none";
  if (kinds.size === 1) return kinds.has("r2") ? "r2" : "cloudinary";
  return "mixed";
}

export function isOwnedCloudinaryId(publicId: string, userId: string): boolean {
  if (!publicId || publicId.includes("..")) return false;
  return publicId.startsWith(`u/${userId}/`);
}

export function isCloudinaryDeliveryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com"
    );
  } catch {
    return false;
  }
}

export type VerifiedAttachment = AttachmentRef & { index: number };

export type BlobRefs = { objectKeys: string[]; publicIds: string[] };

export function collectBlobs(note: {
  publicId?: string | null;
  storageKey?: string | null;
  attachments?:
    | ({ publicId?: string | null; storageKey?: string | null } | null)[]
    | null;
}): BlobRefs {
  const objectKeys = new Set<string>();
  const publicIds = new Set<string>();

  if (note.storageKey) objectKeys.add(note.storageKey);
  if (note.publicId) publicIds.add(note.publicId);
  for (const attachment of note.attachments ?? []) {
    if (attachment?.storageKey) objectKeys.add(attachment.storageKey);
    if (attachment?.publicId) publicIds.add(attachment.publicId);
  }

  return { objectKeys: [...objectKeys], publicIds: [...publicIds] };
}

export async function destroyBlobs(refs: BlobRefs): Promise<void> {
  if (refs.objectKeys.length > 0) {
    const config = getR2Config();
    if (config) await deleteObjects(config, refs.objectKeys);
  }

  if (refs.publicIds.length > 0) {
    try {
      const cloudinary = (await import("cloudinary")).default;
      for (let i = 0; i < refs.publicIds.length; i += 100) {
        await cloudinary.v2.api
          .delete_resources(refs.publicIds.slice(i, i + 100))
          .catch(() => {});
      }
    } catch {}
  }
}

export type VerifyFailure = {
  error: string;
  orphanKeys: string[];
};

export async function verifyGroupAttachments(
  attachments: AttachmentRef[],
  userId: string,
  headObject: (
    key: string
  ) => Promise<{ size: number; contentType: string } | null>,
  maxFileBytes: number
): Promise<
  { ok: true; attachments: VerifiedAttachment[] } | ({ ok: false } & VerifyFailure)
> {
  const verified: VerifiedAttachment[] = [];
  let totalBytes = 0;

  for (const [index, a] of attachments.entries()) {
    if (a.kind !== attachmentKind(a.mimeType, a.fileName)) {
      return fail(`"${a.fileName}" doesn't match the file type`);
    }

    if (a.kind === "image") {
      const bad = checkImage(a, userId);
      if (bad) return fail(bad);
      totalBytes += a.fileSize;
      verified.push({ ...imageRecord(a, index) });
      continue;
    }

    const bad = await checkFile(a, maxFileBytes, headObject, (size) => {
      totalBytes += size;
      return totalBytes;
    });
    if (typeof bad === "string") return fail(bad);
    verified.push({ ...bad, index });
  }

  return { ok: true, attachments: verified };

  function fail(error: string) {
    const orphanKeys = attachments
      .filter((a) => a.kind === "file" && a.storageKey)
      .map((a) => a.storageKey as string);
    return { ok: false as const, error, orphanKeys };
  }
}

function checkImage(a: AttachmentRef, userId: string): string | null {
  if (!a.publicId || !a.imageUrl) return "Image upload incomplete";
  if (!isOwnedCloudinaryId(a.publicId, userId)) return "Invalid image reference";
  if (!isCloudinaryDeliveryUrl(a.imageUrl)) return "Invalid image URL";
  return null;
}

function imageRecord(a: AttachmentRef, index: number): VerifiedAttachment {
  return {
    index,
    kind: "image",
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    imageUrl: a.imageUrl,
    publicId: a.publicId,
    caption: a.caption ?? "",
  };
}

async function checkFile(
  a: AttachmentRef,
  maxFileBytes: number,
  headObject: (
    key: string
  ) => Promise<{ size: number; contentType: string } | null>,
  addToTotal: (size: number) => number
): Promise<Omit<VerifiedAttachment, "index"> | string> {
  if (!a.storageKey) return `"${a.fileName}" upload incomplete`;

  const metadata = await headObject(a.storageKey);
  if (!metadata) return "Upload didn't complete — please try again";

  if (metadata.size <= 0) return `"${a.fileName}" is empty`;
  if (metadata.size > maxFileBytes) {
    return `"${a.fileName}" is too large (max ${mb(maxFileBytes)})`;
  }
  if (addToTotal(metadata.size) > MAX_GROUP_BYTES) {
    return `Attachments are too large together (max ${mb(MAX_GROUP_BYTES)} per note)`;
  }

  return {
    kind: "file",
    fileName: a.fileName,
    fileSize: metadata.size,
    mimeType: metadata.contentType,
    storageKey: a.storageKey,
    caption: a.caption ?? "",
  };
}

function mb(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))}MB`;
}
