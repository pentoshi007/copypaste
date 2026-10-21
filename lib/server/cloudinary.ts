import { v2 as cloudinary } from "cloudinary";

export const IMAGE_FORMATS = "jpg,jpeg,png,gif,webp,avif,bmp,ico,heic,heif,tif,tiff,jfif";

const DELETE_BATCH = 100;

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

let configured = false;

export function cloudinaryCredentials(): CloudinaryCredentials | null {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

function client(): typeof cloudinary | null {
  const credentials = cloudinaryCredentials();
  if (!credentials) return null;
  if (!configured) {
    cloudinary.config({
      cloud_name: credentials.cloudName,
      api_key: credentials.apiKey,
      api_secret: credentials.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

export function signUploadParams(params: Record<string, string | number | boolean>): string | null {
  const credentials = cloudinaryCredentials();
  return credentials ? cloudinary.utils.api_sign_request(params, credentials.apiSecret) : null;
}

export function isGenuineUploadResponse(publicId: string, version: number, signature: string): boolean {
  const expected = signUploadParams({ public_id: publicId, version });
  return Boolean(expected) && expected === signature;
}

export type ImageLookup =
  | { status: "found"; bytes: number; secureUrl: string; format: string }
  | { status: "missing" }
  | { status: "unavailable" };

export async function lookupImage(publicId: string): Promise<ImageLookup> {
  const api = client();
  if (!api) return { status: "unavailable" };
  try {
    const resource = (await api.api.resource(publicId, { resource_type: "image" })) as {
      bytes?: number;
      secure_url?: string;
      format?: string;
    };
    if (!resource.secure_url) return { status: "missing" };
    return {
      status: "found",
      bytes: Number(resource.bytes ?? 0),
      secureUrl: resource.secure_url,
      format: resource.format ?? "",
    };
  } catch (error) {
    const failure = error as { http_code?: number; error?: { http_code?: number } };
    const code = failure?.error?.http_code ?? failure?.http_code;
    return code === 404 ? { status: "missing" } : { status: "unavailable" };
  }
}

export async function destroyImages(publicIds: readonly string[]): Promise<void> {
  const api = client();
  if (!api || publicIds.length === 0) return;
  for (let i = 0; i < publicIds.length; i += DELETE_BATCH) {
    await api.api
      .delete_resources(publicIds.slice(i, i + DELETE_BATCH), { resource_type: "image" })
      .catch(() => undefined);
  }
}
