"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Loader2,
} from "lucide-react";
import { formatBytes, fileExtension } from "@/lib/format";
import {
  isOfficeDocument,
  previewKind,
  TEXT_PREVIEW_MAX_BYTES,
} from "@/lib/preview";

/**
 * Picks an icon from the extension rather than the MIME type — browsers report
 * wildly inconsistent MIME types for the same file across platforms.
 *
 * Returns an element rather than a component reference so it composes cleanly
 * inside JSX without looking like a component defined during render.
 */
function fileIcon(fileName: string, mimeType: string) {
  const ext = fileExtension(fileName);
  const className = "w-5 h-5 text-slate-500 dark:text-slate-400";

  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(ext))
    return <FileArchive className={className} />;
  if (/^(pdf|doc|docx|odt|rtf|txt|md|epub)$/.test(ext))
    return <FileText className={className} />;
  if (/^(xls|xlsx|ods|csv|tsv)$/.test(ext))
    return <FileSpreadsheet className={className} />;
  if (/^(mp4|mkv|mov|avi|webm|m4v)$/.test(ext))
    return <FileVideo className={className} />;
  if (/^(mp3|wav|flac|aac|ogg|m4a)$/.test(ext))
    return <FileAudio className={className} />;
  if (
    /^(js|ts|tsx|jsx|py|java|c|cpp|go|rs|rb|php|json|yml|yaml|xml|html|css|sh)$/.test(
      ext
    )
  )
    return <FileCode2 className={className} />;

  if (mimeType.startsWith("video/")) return <FileVideo className={className} />;
  if (mimeType.startsWith("audio/")) return <FileAudio className={className} />;
  if (mimeType.startsWith("text/")) return <FileText className={className} />;

  return <FileIcon className={className} />;
}

/**
 * Whether this browser can display a PDF inside the page.
 *
 * Chrome on Android has no inline PDF viewer for frames — it can only render a
 * PDF as a top-level navigation — so embedding one there produces an empty or
 * blocked frame. `navigator.pdfViewerEnabled` reports this directly, which
 * beats sniffing the user agent.
 *
 * Read through useSyncExternalStore so the server render and the hydration pass
 * both assume "yes" and agree on the markup; the real answer applies after.
 */
function subscribeNever() {
  return () => {};
}

function getPdfViewerSnapshot() {
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };
  // Undefined on older browsers that do embed PDFs, so only false disables it.
  return nav.pdfViewerEnabled !== false;
}

function getPdfViewerServerSnapshot() {
  return true;
}

/** Text preview: fetched on demand, rendered as escaped text. */
function TextPreview({ noteId }: { noteId: string }) {
  const [state, setState] = useState<{
    text: string;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files/${noteId}/text`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { text: string; truncated: boolean }) => {
        if (!cancelled) setState({ text: data.text, truncated: data.truncated });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (error) {
    return (
      <p className="text-xs text-slate-400 p-3">Couldn&apos;t load a preview.</p>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading preview…
      </div>
    );
  }

  return (
    <div>
      <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed font-mono text-slate-700 dark:text-slate-200">
        <code className="whitespace-pre">{state.text}</code>
      </pre>
      {state.truncated && (
        <p className="px-3 pb-2 text-xs text-slate-400">
          Showing the first {formatBytes(TEXT_PREVIEW_MAX_BYTES)} — download for
          the full file.
        </p>
      )}
    </div>
  );
}

export default function FileBlock({
  noteId,
  fileName,
  fileSize,
  mimeType,
  caption,
  pending = false,
}: {
  noteId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  caption: string;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  const canEmbedPdf = useSyncExternalStore(
    subscribeNever,
    getPdfViewerSnapshot,
    getPdfViewerServerSnapshot
  );

  const kind = previewKind(mimeType, fileName);
  const ext = fileExtension(fileName);
  const officeDoc = isOfficeDocument(mimeType, fileName);
  const canPreview = !pending && kind !== "none";

  // Where a PDF can't be embedded, "Preview" opens it in a new tab instead —
  // Chrome on Android renders PDFs fine as a top-level document.
  const opensExternally = kind === "pdf" && !canEmbedPdf;

  // Navigating to this route is a top-level request, so the browser handles the
  // transfer natively: no CORS, no buffering the file through JS memory, and it
  // works for large files. The route checks ownership before redirecting to a
  // short-lived signed URL, and the object carries the right
  // Content-Disposition so the original filename is preserved.
  const href = `/api/files/${noteId}`;

  const handleDownloadClick = useCallback(() => {
    setStarting(true);
    window.setTimeout(() => setStarting(false), 2500);
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 overflow-hidden">
        <div className="flex items-center gap-3 p-3">
          <div className="relative shrink-0 w-11 h-11 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
            {fileIcon(fileName, mimeType)}
          </div>

          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate"
              title={fileName}
            >
              {fileName || "Attachment"}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatBytes(fileSize)}
              {ext ? ` · ${ext.toUpperCase()}` : ""}
            </p>
          </div>

          {pending ? (
            <span className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="hidden sm:inline">Uploading</span>
            </span>
          ) : (
            <div className="shrink-0 flex items-center gap-1.5">
              {canPreview && opensExternally && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${fileName || "attachment"}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="hidden sm:inline">Open</span>
                </a>
              )}

              {canPreview && !opensExternally && (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  aria-label={open ? "Hide preview" : "Show preview"}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium transition"
                >
                  {open ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {open ? "Hide" : "Preview"}
                  </span>
                </button>
              )}

              <a
                href={href}
                download={fileName || true}
                onClick={handleDownloadClick}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium transition"
                aria-label={`Download ${fileName || "attachment"}`}
              >
                {starting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Download</span>
              </a>
            </div>
          )}
        </div>

        {/* Previews mount only once requested. Rendering an <iframe> or <video>
            for every attachment in a chat would fetch every file on load. */}
        {open && canPreview && !opensExternally && (
          <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {kind === "pdf" && (
              <>
                <iframe
                  src={href}
                  title={fileName || "PDF preview"}
                  // Streams straight from Cloudflare's edge with range requests,
                  // so page 1 renders without downloading the whole document.
                  className="w-full h-[60vh] min-h-64 border-0 bg-slate-100 dark:bg-slate-800"
                />
                <div className="p-2 flex justify-end">
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open full screen
                  </a>
                </div>
              </>
            )}

            {kind === "image" && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={href}
                alt={fileName || "Preview"}
                loading="lazy"
                decoding="async"
                className="w-full max-h-80 object-contain bg-slate-100 dark:bg-slate-800"
              />
            )}

            {kind === "video" && (
              <video
                src={href}
                controls
                preload="metadata"
                className="w-full max-h-80 bg-black"
              />
            )}

            {kind === "audio" && (
              <div className="p-3">
                <audio src={href} controls preload="metadata" className="w-full" />
              </div>
            )}

            {kind === "text" && <TextPreview noteId={noteId} />}
          </div>
        )}

        {/* Be explicit about why Office files have no preview, rather than
            silently showing nothing. */}
        {!pending && !canPreview && officeDoc && (
          <p className="px-3 pb-3 -mt-1 text-xs text-slate-400">
            Word, Excel and PowerPoint files can&apos;t be previewed in a browser
            without uploading them to a third-party viewer, so this one is
            download-only.
          </p>
        )}
      </div>

      {caption && (
        <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
          {caption}
        </p>
      )}
    </div>
  );
}
