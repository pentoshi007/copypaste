import { sendWithProgress, type ProgressCallback } from "@/lib/xhr";
import {
  attachmentKind,
  MAX_FILES_PER_NOTE,
  MAX_IMAGE_BYTES,
  type AttachmentKind,
  type AttachmentRef,
} from "@/lib/attachments";

export type UploadResult = AttachmentRef & {
  id: string;
  index: number;
  state: "ready" | "error";
  error: string;
};

export type UploadCandidate = Pick<File, "name" | "size" | "type">;

export type Rejection = { index: number; error: string };

export type BatchUploadResult = {
  uploaded: UploadResult[];
  rejections: Rejection[];
};

export type BatchProgress = (index: number, percent: number) => void;

export function splitSelection(files: UploadCandidate[]): {
  images: UploadCandidate[];
  others: UploadCandidate[];
  rejections: Rejection[];
} {
  const images: UploadCandidate[] = [];
  const others: UploadCandidate[] = [];
  const rejections: Rejection[] = [];
  let kept = 0;

  for (const [index, file] of files.entries()) {
    const kind = attachmentKind(file.type, file.name);

    if (file.size === 0) {
      rejections.push({ index, error: "That file is empty" });
      continue;
    }
    if (kind === "image" && file.size > MAX_IMAGE_BYTES) {
      rejections.push({ index, error: "Image is too large (max 10MB)" });
      continue;
    }
    if (kept >= MAX_FILES_PER_NOTE) {
      rejections.push({
        index,
        error: `Only the first ${MAX_FILES_PER_NOTE} files can be attached at once`,
      });
      continue;
    }

    kept++;
    (kind === "image" ? images : others).push(file);
  }

  return { images, others, rejections };
}

export async function uploadBatch(
  files: File[],
  onProgress: BatchProgress,
  signal?: AbortSignal
): Promise<BatchUploadResult> {
  const { images, others, rejections: preflight } = splitSelection(files);

  const [imageBatch, fileBatch] = await Promise.all([
    images.length ? uploadImages(files, onProgress, signal) : null,
    others.length ? uploadToR2(files, onProgress, signal) : null,
  ]);

  return {
    uploaded: [
      ...(imageBatch?.uploaded ?? []),
      ...(fileBatch?.uploaded ?? []),
    ].sort((a, b) => a.index - b.index),
    rejections: [
      ...preflight,
      ...(imageBatch?.rejections ?? []),
      ...(fileBatch?.rejections ?? []),
    ].sort((a, b) => a.index - b.index),
  };
}

function indicesOfKind(files: File[], kind: AttachmentKind): number[] {
  const out: number[] = [];
  for (const [index, file] of files.entries()) {
    if (attachmentKind(file.type, file.name) === kind) out.push(index);
  }
  return out;
}

type CloudinarySign = {
  index: number;
  signature: string;
  timestamp: number;
  publicId: string;
};

type SignResponse = {
  signs?: CloudinarySign[];
  errors?: Rejection[];
  apiKey?: string;
  cloudName?: string;
  error?: string;
};

async function uploadImages(
  all: File[],
  onProgress: BatchProgress,
  signal?: AbortSignal
): Promise<BatchUploadResult> {
  const indices = indicesOfKind(all, "image");
  const files = indices.map((index) => all[index]);

  const res = await fetch("/api/upload-sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({ fileName: f.name, contentType: f.type })),
    }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as SignResponse | null;

  if (!res.ok || !body?.apiKey || !body?.cloudName) {
    return failAll(indices, body?.error ?? "Upload authorization failed");
  }

  const { uploaded, rejections } = await transferAll(
    (body.signs ?? []).map((sign) => ({
      index: indices[sign.index],
      run: putToCloudinary(
        files[sign.index],
        sign,
        body.apiKey as string,
        body.cloudName as string,
        (percent) => onProgress(indices[sign.index], percent),
        signal
      ),
    }))
  );

  return {
    uploaded,
    rejections: mergeByIndex(rejections, remap(body.errors ?? [], indices)),
  };
}

async function putToCloudinary(
  file: File,
  sign: Omit<CloudinarySign, "index">,
  apiKey: string,
  cloudName: string,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<AttachmentRef> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(sign.timestamp));
  formData.append("public_id", sign.publicId);
  formData.append("signature", sign.signature);

  const raw = await sendWithProgress({
    method: "POST",
    url: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    body: formData,
    onProgress,
    signal,
  });

  return {
    kind: "image",
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    ...parseUploadResponse(raw),
  };
}

function parseUploadResponse(raw: string): {
  secure_url: string;
  public_id: string;
} {
  let parsed: { secure_url?: string; public_id?: string };
  try {
    parsed = JSON.parse(raw) as { secure_url?: string; public_id?: string };
  } catch {
    throw new Error("Could not read the upload response");
  }
  if (!parsed.secure_url || !parsed.public_id) {
    throw new Error("Upload response was incomplete");
  }
  return { secure_url: parsed.secure_url, public_id: parsed.public_id };
}

type PresignEntry = {
  index: number;
  key: string;
  uploadUrl: string;
  fileName: string;
  headers: Record<string, string>;
};

type PresignResponse = {
  presigns?: PresignEntry[];
  errors?: Rejection[];
  error?: string;
};

async function uploadToR2(
  all: File[],
  onProgress: BatchProgress,
  signal?: AbortSignal
): Promise<BatchUploadResult> {
  const indices = indicesOfKind(all, "file");
  const files = indices.map((index) => all[index]);

  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: files.map((f) => ({
        fileName: f.name,
        contentType: f.type,
        size: f.size,
      })),
    }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as PresignResponse | null;

  if (!res.ok || !body) {
    return failAll(indices, body?.error ?? "Upload authorization failed");
  }

  const { uploaded, rejections } = await transferAll(
    (body.presigns ?? []).map((presign) => ({
      index: indices[presign.index],
      run: putToR2(
        files[presign.index],
        presign,
        (percent) => onProgress(indices[presign.index], percent),
        signal
      ),
    }))
  );

  return {
    uploaded,
    rejections: mergeByIndex(rejections, remap(body.errors ?? [], indices)),
  };
}

async function putToR2(
  file: File,
  presign: PresignEntry,
  onProgress: ProgressCallback,
  signal?: AbortSignal
): Promise<AttachmentRef> {
  await sendWithProgress({
    method: "PUT",
    url: presign.uploadUrl,
    body: file,
    headers: presign.headers,
    onProgress,
    signal,
  });

  return {
    kind: "file",
    fileName: presign.fileName,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
    storageKey: presign.key,
  };
}

async function transferAll(
  pending: { index: number; run: Promise<AttachmentRef> }[]
): Promise<{ uploaded: UploadResult[]; rejections: Rejection[] }> {
  const outcomes = await Promise.all(
    pending.map(async ({ index, run }) => {
      try {
        return { index, ref: await run };
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        return { index, error: (err as Error)?.message || "Upload failed" };
      }
    })
  );

  const uploaded: UploadResult[] = [];
  const rejections: Rejection[] = [];
  for (const outcome of outcomes) {
    if (outcome.ref) {
      uploaded.push({
        ...outcome.ref,
        id: `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        index: outcome.index,
        state: "ready",
        error: "",
      });
    } else if (outcome.error) {
      rejections.push({ index: outcome.index, error: outcome.error });
    }
  }

  return { uploaded, rejections };
}

function failAll(indices: number[], error: string): BatchUploadResult {
  return { uploaded: [], rejections: indices.map((index) => ({ index, error })) };
}

function remap(errors: Rejection[], indices: number[]): Rejection[] {
  return errors.map((e) => ({ index: indices[e.index], error: e.error }));
}

function mergeByIndex(...groups: Rejection[][]): Rejection[] {
  const byIndex = new Map<number, string>();
  for (const group of groups) {
    for (const { index, error } of group) {
      if (!byIndex.has(index)) byIndex.set(index, error);
    }
  }
  return [...byIndex.entries()]
    .map(([index, error]) => ({ index, error }))
    .sort((a, b) => a.index - b.index);
}
