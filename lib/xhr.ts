/**
 * Upload transport with progress reporting.
 *
 * `fetch` still cannot report request-upload progress. On a mobile connection
 * the upload is by far the longest part of sending an attachment, and without
 * progress the UI just looks frozen. XMLHttpRequest exposes
 * `upload.onprogress`, so it's used for uploads only.
 */

export type ProgressCallback = (percent: number) => void;

export type SendOptions = {
  method: "POST" | "PUT";
  url: string;
  body: Blob | FormData;
  /** Sent verbatim. Do not set forbidden headers (Content-Length, Host, ...). */
  headers?: Record<string, string>;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
};

/** Resolves with the raw response body on 2xx, rejects otherwise. */
export function sendWithProgress(options: SendOptions): Promise<string> {
  const { method, url, body, headers, onProgress, signal } = options;

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = "text";

    for (const [name, value] of Object.entries(headers ?? {})) {
      xhr.setRequestHeader(name, value);
    }

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          // Hold at 99 until the server actually confirms.
          onProgress(
            Math.min(99, Math.round((event.loaded / event.total) * 100))
          );
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(xhr.responseText);
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

    xhr.send(body);
  });
}
