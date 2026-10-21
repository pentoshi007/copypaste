"use client";

import { useState } from "react";
import { ChevronDown, Download, ExternalLink, Eye } from "lucide-react";
import AttachmentPreview, { fileHref, usePdfEmbeddable } from "./AttachmentPreview";
import Caption from "./Caption";
import UploadStatus from "./UploadStatus";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { fileExtension, formatBytes } from "@/lib/format";
import { isOfficeDocument, previewKind } from "@/lib/preview";
import type { LocalBlock, UploadState } from "@/lib/client/blockStore";

const ACTION = "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition";

export default function FileBlock({ block }: { block: LocalBlock }) {
  const [open, setOpen] = useState(false);
  const canEmbedPdf = usePdfEmbeddable();
  const saved = Boolean(block._id) && !block.upload;

  const kind = previewKind(block.mimeType, block.fileName);
  const extension = fileExtension(block.fileName);
  const href = saved ? fileHref(block._id) : "";
  const canPreview = saved && kind !== "none";
  const opensExternally = kind === "pdf" && !canEmbedPdf;

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
            <FileTypeIcon fileName={block.fileName} mimeType={block.mimeType} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100"
              title={block.fileName}
            >
              {block.fileName || "Attachment"}
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {formatBytes(block.fileSize)}
              {extension ? ` · ${extension.toUpperCase()}` : ""}
            </p>
          </div>

          {saved && (
            <div className="flex shrink-0 items-center gap-1">
              {canPreview && opensExternally && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${block.fileName}`}
                  className={`${ACTION} text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800`}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden sm:inline">Open</span>
                </a>
              )}
              {canPreview && !opensExternally && (
                <button
                  type="button"
                  onClick={() => setOpen((value) => !value)}
                  aria-expanded={open}
                  aria-label={open ? "Hide preview" : "Show preview"}
                  className={`${ACTION} text-neutral-600 hover:bg-neutral-200/70 dark:text-neutral-300 dark:hover:bg-neutral-800`}
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  <span className="hidden sm:inline">{open ? "Hide" : "Preview"}</span>
                </button>
              )}
              <a
                href={href}
                download={block.fileName || true}
                aria-label={`Download ${block.fileName || "attachment"}`}
                className={`${ACTION} bg-blue-600 text-white hover:bg-blue-700`}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </div>
          )}
        </div>

        {block.upload && (
          <div className="px-3 pb-3">
            <UploadStatus block={block as LocalBlock & { upload: UploadState }} />
          </div>
        )}

        {open && canPreview && !opensExternally && (
          <div className="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
            <AttachmentPreview
              kind={kind}
              href={href}
              textHref={`${href}/text`}
              title={block.fileName || "Preview"}
            />
          </div>
        )}

        {saved && !canPreview && isOfficeDocument(block.mimeType, block.fileName) && (
          <p className="-mt-1 px-3 pb-3 text-xs text-neutral-400">
            Office documents can&apos;t be previewed without sending them to a third-party viewer, so this one
            is download-only.
          </p>
        )}
      </div>
      <Caption block={block} />
    </div>
  );
}
