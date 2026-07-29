/** Client-side helpers for uploading images to Cloudinary. */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

export type UploadResult = { secure_url: string; public_id: string };

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "That file isn't an image";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image is too large (max 10MB)";
  }
  return null;
}

/**
 * POSTs a FormData body with real upload progress.
 *
 * `fetch` can't report request-upload progress, and on mobile connections an
 * image upload is by far the longest part of sending a note — without progress
 * the UI looks frozen. XMLHttpRequest still exposes `upload.onprogress`, so we
 * use it just for this one request.
 */
export function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as UploadResult;
          if (!parsed.secure_url || !parsed.public_id) {
            reject(new Error("Upload response was incomplete"));
            return;
          }
          onProgress(100);
          resolve(parsed);
        } catch {
          reject(new Error("Could not read upload response"));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}
