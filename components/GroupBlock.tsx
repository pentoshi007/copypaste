"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  ChevronDown,
  Download,
  Eye,
  Images,
  Loader2,
  Pencil,
} from "lucide-react";
import type { NoteAttachment } from "@/lib/types";
import { formatBytes, fileExtension } from "@/lib/format";
import { previewKind, TEXT_PREVIEW_MAX_BYTES } from "@/lib/preview";
import { FileTypeIcon } from "./FileTypeIcon";

const subscribeNever = () => () => {};

function getPdfViewerSnapshot() {
  const nav = navigator as Navigator & { pdfViewerEnabled?: boolean };

  return nav.pdfViewerEnabled !== false;
}

function getPdfViewerServerSnapshot() {
  return true;
}

function TextPreview({ noteId, index }: { noteId: string; index: number }) {
  const [state, setState] = useState<{
    text: string;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/files/${noteId}/text?i=${index}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data: { text: string; truncated: boolean }) => {
        if (!cancelled)
          setState({ text: data.text, truncated: data.truncated });
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, index]);

  if (error) {
    return (
      <p className="text-xs text-slate-400 p-3">
        Couldn&apos;t load a preview.
      </p>
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
      <pre className="max-h-64 overflow-auto p-3 text-xs leading-relaxed font-mono text-slate-700 dark:text-slate-200">
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

function Caption({
  value,
  disabled,
  onSave,
  onCommitted,
}: {
  value: string;
  disabled: boolean;

  onSave: (next: string) => Promise<boolean>;

  onCommitted: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isPending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="min-h-5">
        {value ? (
          <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
            {value}
          </p>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 disabled:opacity-50 transition"
          >
            <Pencil className="w-3 h-3" />
            Add a caption
          </button>
        )}
      </div>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === value) return;
    startTransition(async () => {

      if (await onSave(next)) onCommitted(next);
    });
  };

  return (
    <div className="flex items-center gap-1">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
        maxLength={1000}
        placeholder="Caption this file…"
        aria-label="Attachment caption"
        className="flex-1 min-w-0 px-1.5 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-blue-500"
      />
      {isPending && <Loader2 className="w-3 h-3 shrink-0 animate-spin" />}
    </div>
  );
}

export default function GroupBlock({
  noteId,
  attachments,
  pending = false,
  saveCaption,
  onUpdated,
}: {
  noteId: string;
  attachments: NoteAttachment[];
  pending?: boolean;

  saveCaption: (index: number, caption: string) => Promise<boolean>;
  onUpdated: (index: number, caption: string) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  const canEmbedPdf = useSyncExternalStore(
    subscribeNever,
    getPdfViewerSnapshot,
    getPdfViewerServerSnapshot,
  );

  const totalSize = attachments.reduce((sum, a) => sum + (a.fileSize || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Images className="w-3.5 h-3.5" />
        <span>
          {attachments.length} file{attachments.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(totalSize)}</span>
      </div>

      <ul className="space-y-2">
        {attachments.map((attachment) => {
          const isOpen = expanded === attachment.index;
          const kind = previewKind(attachment.mimeType, attachment.fileName);
          const isImage = attachment.kind === "image";
          const href = isImage
            ? ""
            : `/api/files/${noteId}?i=${attachment.index}`;

          const opensExternally = kind === "pdf" && !canEmbedPdf;
          const canPreview = !pending && kind !== "none" && !isImage;
          const ext = fileExtension(attachment.fileName);

          return (
            <li
              key={attachment.index}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 overflow-hidden"
            >
              <div className="flex items-start gap-3 p-3">
                <div className="relative shrink-0 w-11 h-11 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 overflow-hidden flex items-center justify-center">
                  {isImage && attachment.imageUrl ? (
                    <Thumb url={attachment.imageUrl} />
                  ) : (
                    <FileTypeIcon
                      fileName={attachment.fileName}
                      mimeType={attachment.mimeType}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate"
                    title={attachment.fileName}
                  >
                    {attachment.fileName || "Attachment"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatBytes(attachment.fileSize)}
                    {ext ? ` · ${ext.toUpperCase()}` : ""}
                  </p>

                  {!pending && (
                    <Caption
                      value={attachment.caption ?? ""}
                      disabled={pending}
                      onSave={(next) => saveCaption(attachment.index, next)}
                      onCommitted={(next) => onUpdated(attachment.index, next)}
                    />
                  )}
                </div>

                {!pending && (
                  <div className="shrink-0 flex items-center gap-1.5">
                    {canPreview && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded(isOpen ? null : attachment.index)
                        }
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen
                            ? `Hide preview of ${attachment.fileName}`
                            : `Preview ${attachment.fileName}`
                        }
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-500 hover:bg-white dark:hover:bg-slate-700 transition"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    )}
                    {!isImage && (
                      <a
                        href={href}
                        download={attachment.fileName || true}
                        aria-label={`Download ${attachment.fileName || "attachment"}`}
                        className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-white dark:hover:bg-slate-700 transition"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                )}
              </div>


              {isOpen && canPreview && (
                <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                  {kind === "pdf" &&
                    (opensExternally ? (
                      <p className="p-3 text-xs text-slate-400">
                        PDFs can&apos;t be shown inline here —{" "}
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          open in a new tab
                        </a>
                        .
                      </p>
                    ) : (
                      <iframe
                        src={href}
                        title={attachment.fileName}

                        className="w-full h-[60vh] min-h-64 border-0 bg-slate-100 dark:bg-slate-800"
                      />
                    ))}
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
                      <audio
                        src={href}
                        controls
                        preload="metadata"
                        className="w-full"
                      />
                    </div>
                  )}
                  {kind === "text" && (
                    <TextPreview noteId={noteId} index={attachment.index} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thumb({ url }: { url: string }) {
  const transformed = url.replace(
    "/upload/",
    "/upload/c_limit,w_96,h_96,c_fill,f_auto,q_auto/",
  );
  return (
    <img
      src={transformed}
      alt=""
      loading="lazy"
      decoding="async"
      className="w-full h-full object-cover"
    />
  );
}
