"use client";

import { AlertCircle, Loader2, RotateCcw, X } from "lucide-react";
import { useEditor } from "@/components/editor/EditorContext";
import type { LocalBlock, UploadState } from "@/lib/client/blockStore";

export function UploadProgressBar({ upload }: { upload: UploadState }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
      role="progressbar"
      aria-valuenow={upload.progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Uploading ${upload.file.name}`}
    >
      <div
        className="h-full bg-blue-600 transition-[width] duration-200"
        style={{ width: `${upload.progress}%` }}
      />
    </div>
  );
}

export default function UploadStatus({ block }: { block: LocalBlock & { upload: UploadState } }) {
  const api = useEditor();
  const { upload } = block;

  if (upload.error) {
    return (
      <div className="flex items-start gap-2 text-xs">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <p className="min-w-0 flex-1 break-words text-red-600 dark:text-red-400">{upload.error}</p>
        <button
          type="button"
          onClick={() => api.store.retryUpload(block.key)}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </button>
        <button
          type="button"
          aria-label="Remove upload"
          onClick={() => api.store.remove([block.key], { undoable: false })}
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <div className="min-w-0 flex-1">
        <UploadProgressBar upload={upload} />
      </div>
      <span className="w-10 shrink-0 text-right tabular-nums">
        {upload.result ? "Saving" : `${upload.progress}%`}
      </span>
      <button
        type="button"
        aria-label="Cancel upload"
        onClick={() => api.store.remove([block.key], { undoable: false })}
        className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
