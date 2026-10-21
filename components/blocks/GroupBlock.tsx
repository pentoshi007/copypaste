"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Download, Eye, Images, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import AttachmentPreview, { fileHref, usePdfEmbeddable } from "./AttachmentPreview";
import Caption from "./Caption";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { useEditor } from "@/components/editor/EditorContext";
import { updateAttachmentCaption } from "@/actions/blocks";
import { fileExtension, formatBytes } from "@/lib/format";
import { previewKind } from "@/lib/preview";
import { MAX_CAPTION_LENGTH } from "@/lib/editor/blockTypes";
import type { LocalBlock } from "@/lib/client/blockStore";
import type { BlockAttachment } from "@/lib/types";

function AttachmentCaption({ block, attachment }: { block: LocalBlock; attachment: BlockAttachment }) {
  const api = useEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(attachment.caption);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return attachment.caption ? (
      <button
        type="button"
        onClick={() => {
          setDraft(attachment.caption);
          setEditing(true);
        }}
        className="block w-full text-left text-xs text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200 whitespace-pre-wrap break-words"
      >
        {attachment.caption}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
        className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-blue-500"
      >
        <Pencil className="h-3 w-3" />
        Add a caption
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next === attachment.caption) return;
    const previous = attachment.caption;
    api.store.setAttachmentCaption(block.key, attachment.index, next);
    startTransition(async () => {
      const result = await updateAttachmentCaption({
        blockId: block._id,
        index: attachment.index,
        caption: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        api.store.setAttachmentCaption(block.key, attachment.index, previous);
      }
    });
  };

  return (
    <div className="flex items-center gap-1">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setEditing(false);
        }}
        autoFocus
        maxLength={MAX_CAPTION_LENGTH}
        placeholder="Caption this file…"
        aria-label="Attachment caption"
        className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1.5 py-1 text-base text-neutral-900 outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-white sm:text-xs"
      />
      {pending && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
    </div>
  );
}

function Thumb({ url }: { url: string }) {
  return (
    <img
      src={url.replace("/upload/", "/upload/c_fill,w_96,h_96,f_auto,q_auto/")}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

export default function GroupBlock({ block }: { block: LocalBlock }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const canEmbedPdf = usePdfEmbeddable();
  const attachments = block.attachments ?? [];
  const totalSize = attachments.reduce((sum, attachment) => sum + (attachment.fileSize || 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <Images className="h-3.5 w-3.5" />
        <span>
          {attachments.length} file{attachments.length === 1 ? "" : "s"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(totalSize)}</span>
      </div>

      <ul className="space-y-2">
        {attachments.map((attachment) => {
          const isOpen = expanded === attachment.index;
          const isImage = attachment.kind === "image";
          const kind = previewKind(attachment.mimeType, attachment.fileName);
          const href = isImage ? (attachment.imageUrl ?? "") : fileHref(block._id, attachment.index);
          const textHref = `${fileHref(block._id)}/text?i=${attachment.index}`;
          const canPreview = !isImage && kind !== "none" && !(kind === "pdf" && !canEmbedPdf);
          const extension = fileExtension(attachment.fileName);

          return (
            <li
              key={attachment.index}
              className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-start gap-3 p-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
                  {isImage && attachment.imageUrl ? (
                    <Thumb url={attachment.imageUrl} />
                  ) : (
                    <FileTypeIcon fileName={attachment.fileName} mimeType={attachment.mimeType} />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100"
                    title={attachment.fileName}
                  >
                    {attachment.fileName || "Attachment"}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {formatBytes(attachment.fileSize)}
                    {extension ? ` · ${extension.toUpperCase()}` : ""}
                  </p>
                  <AttachmentCaption block={block} attachment={attachment} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canPreview && (
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : attachment.index)}
                      aria-expanded={isOpen}
                      aria-label={
                        isOpen ? `Hide preview of ${attachment.fileName}` : `Preview ${attachment.fileName}`
                      }
                      className="rounded-md p-1.5 text-neutral-500 hover:bg-white hover:text-blue-500 dark:hover:bg-neutral-800"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                  <a
                    href={href}
                    target={isImage ? "_blank" : undefined}
                    rel={isImage ? "noopener noreferrer" : undefined}
                    download={isImage ? undefined : attachment.fileName || true}
                    aria-label={`${isImage ? "Open" : "Download"} ${attachment.fileName || "attachment"}`}
                    className="rounded-md p-1.5 text-neutral-500 hover:bg-white hover:text-blue-600 dark:hover:bg-neutral-800"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
              {isOpen && canPreview && (
                <div className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
                  <AttachmentPreview
                    kind={kind}
                    href={href}
                    textHref={textHref}
                    title={attachment.fileName}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Caption block={block} />
    </div>
  );
}
