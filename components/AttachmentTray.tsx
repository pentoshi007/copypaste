"use client";

import { useState } from "react";
import { AlertCircle, File as FileIcon, Loader2, X } from "lucide-react";
import type { UploadResult } from "@/lib/upload";
import { formatBytes, fileExtension } from "@/lib/format";

export type TrayItem = Omit<UploadResult, "state"> & {
  previewUrl: string;
  state: "uploading" | "ready" | "error";
  progress: number;
};

export function trayFromUpload(
  result: UploadResult,
  previewUrl: string,
): TrayItem {
  return { ...result, previewUrl, state: "ready", progress: 100 };
}

function Icon({ item }: { item: TrayItem }) {
  if (item.previewUrl) {
    return (
      <img
        src={item.previewUrl}
        alt=""
        className="w-full h-full object-cover"
      />
    );
  }
  const ext = fileExtension(item.fileName).toUpperCase();
  return (
    <div className="flex flex-col items-center gap-0.5 px-1 text-center">
      <FileIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
      {ext && (
        <span className="text-[9px] font-medium text-slate-500 dark:text-slate-400 leading-none">
          {ext}
        </span>
      )}
    </div>
  );
}

export default function AttachmentTray({
  items,
  onRemove,
  onRetry,
}: {
  items: TrayItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-2">
      <ul className="flex gap-2 overflow-x-auto overscroll-none-x pb-0.5 no-scrollbar">
        {items.map((item) => {
          const failed = item.state === "error";
          const isOpen = expanded === item.id;

          return (
            <li
              key={item.id}
              className={`relative shrink-0 w-16 rounded-md border bg-white dark:bg-slate-900 transition ${
                failed
                  ? "border-red-300 dark:border-red-800"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : item.id)}
                aria-expanded={isOpen}
                title={item.fileName}
                className="block w-full"
              >
                <div className="relative w-full h-14 rounded-t-md overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Icon item={item} />
                  {item.state === "uploading" && (
                    <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                      <Loader2 className="w-4 h-4 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <div className="px-1 py-1">
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 truncate">
                    {failed ? "Failed" : formatBytes(item.fileSize)}
                  </p>
                </div>
                {item.state === "uploading" && (
                  <div
                    className="h-0.5 w-full bg-slate-200 dark:bg-slate-700"
                    role="progressbar"
                    aria-valuenow={item.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${item.fileName}`}
                  >
                    <div
                      className="h-full bg-blue-600 transition-[width] duration-150"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.fileName}`}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-500 text-white shadow hover:bg-red-500 transition"
              >
                <X className="w-3 h-3 mx-auto" />
              </button>
            </li>
          );
        })}
      </ul>


      {expanded &&
        (() => {
          const item = items.find((i) => i.id === expanded);
          if (!item) return null;
          return (
            <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-start gap-2">
              {item.state === "error" ? (
                <>
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-red-600 dark:text-red-400 break-words">
                      {item.error}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRetry(item.id)}
                      className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Retry
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
                  {item.fileName}
                  {item.state === "uploading" &&
                    ` · uploading ${item.progress}%`}
                </p>
              )}
            </div>
          );
        })()}
    </div>
  );
}
