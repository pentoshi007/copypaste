"use client";

import { useState } from "react";
import {
  Download,
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
  const [starting, setStarting] = useState(false);
  const ext = fileExtension(fileName);

  // Navigating to this route is a top-level request, so the browser handles the
  // download natively: no CORS, no buffering the file through JS memory, and it
  // works for large files. The route checks ownership before redirecting to a
  // short-lived signed URL.
  const href = `/api/files/${noteId}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-3">
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
          <a
            href={href}
            // Same-origin route, so `download` is honoured; the signed redirect
            // also carries Content-Disposition: attachment as a fallback.
            download={fileName || true}
            onClick={() => {
              setStarting(true);
              window.setTimeout(() => setStarting(false), 2500);
            }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium transition"
            aria-label={`Download ${fileName || "attachment"}`}
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Download</span>
          </a>
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
