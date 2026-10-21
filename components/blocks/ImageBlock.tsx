"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Loader2, Maximize2, X } from "lucide-react";
import { toast } from "sonner";
import Caption from "./Caption";
import UploadStatus from "./UploadStatus";
import type { LocalBlock, UploadState } from "@/lib/client/blockStore";

function cloudinaryTransform(url: string, transform: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "res.cloudinary.com") return url;
    return url.replace("/upload/", `/upload/${transform}/`);
  } catch {
    return url;
  }
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image preview"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top,0px))] rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-6 w-6" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88dvh] max-w-full rounded-lg object-contain"
      />
    </div>,
    document.body,
  );
}

export default function ImageBlock({ block }: { block: LocalBlock }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);

  const remote = block.imageUrl;
  const source = remote || block.upload?.previewUrl || "";
  const thumbnail = remote ? cloudinaryTransform(remote, "c_limit,w_900,f_auto,q_auto") : source;
  const thumbnail2x = remote ? cloudinaryTransform(remote, "c_limit,w_1800,f_auto,q_auto") : source;
  const full = remote ? cloudinaryTransform(remote, "f_auto,q_auto") : source;
  const alt = block.content || block.fileName || "Image";
  const close = useCallback(() => setOpen(false), []);

  const copyImage = async () => {
    setBusy("copy");
    try {
      const response = await fetch(cloudinaryTransform(remote, "f_png"));
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Image copied to clipboard");
    } catch {
      try {
        await navigator.clipboard.writeText(remote);
        toast.success("Image link copied (this browser can't copy images)");
      } catch {
        toast.error("Couldn't copy the image");
      }
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    try {
      const response = await fetch(full);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = block.fileName || `image.${blob.type.split("/")[1] || "png"}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't download the image");
    } finally {
      setBusy(null);
    }
  };

  return (
    <figure className="m-0">
      <div className="group/image relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900">
        {source ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="View image full size"
            className="block w-full cursor-zoom-in"
          >
            <img
              src={thumbnail}
              srcSet={remote ? `${thumbnail} 1x, ${thumbnail2x} 2x` : undefined}
              alt={alt}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
              className={`mx-auto max-h-[28rem] w-auto max-w-full object-contain transition-opacity duration-200 ${
                loaded || !remote ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-neutral-400">
            Image unavailable
          </div>
        )}

        {remote && (
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover/image:opacity-100 pointer-coarse:opacity-100">
            {[
              { id: "copy", label: "Copy image", icon: Copy, action: copyImage },
              { id: "download", label: "Download image", icon: Download, action: download },
              { id: "open", label: "View full size", icon: Maximize2, action: async () => setOpen(true) },
            ].map(({ id, label, icon: Icon, action }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                title={label}
                disabled={busy !== null}
                onClick={() => void action()}
                className="rounded-md bg-black/55 p-1.5 text-white backdrop-blur hover:bg-black/75 disabled:opacity-60"
              >
                {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {block.upload && (
        <div className="mt-2">
          <UploadStatus block={block as LocalBlock & { upload: UploadState }} />
        </div>
      )}
      <Caption block={block} />
      {open && source && <Lightbox src={full} alt={alt} onClose={close} />}
    </figure>
  );
}
