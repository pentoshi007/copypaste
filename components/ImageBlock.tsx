"use client";

import { Copy, Download, Maximize2, X, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export default function ImageBlock({
  imageUrl,
  caption,
}: {
  imageUrl: string;
  caption: string;
}) {
  const [showFull, setShowFull] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);

  // Cloudinary resizes/reformats on delivery, so we ask for exactly what the
  // layout needs (plus a 2x variant) instead of the full-resolution original.
  const thumbnailUrl = buildCloudinaryTransform(imageUrl, "c_limit,w_520,f_auto,q_auto");
  const thumbnailUrl2x = buildCloudinaryTransform(imageUrl, "c_limit,w_1040,f_auto,q_auto");
  const fullUrl = buildCloudinaryTransform(imageUrl, "f_auto,q_auto");

  const handleCopy = useCallback(async () => {
    setBusy("copy");
    try {
      const res = await fetch(thumbnailUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Image copied to clipboard");
    } catch {
      try {
        await navigator.clipboard.writeText(imageUrl);
        toast.success("Image URL copied (this browser can't copy images)");
      } catch {
        toast.error("Failed to copy image");
      }
    } finally {
      setBusy(null);
    }
  }, [imageUrl, thumbnailUrl]);

  const handleDownload = useCallback(async () => {
    setBusy("download");
    try {
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `copypaste-${Date.now()}.${blob.type.split("/")[1] || "png"}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Image downloaded");
    } catch {
      toast.error("Failed to download");
    } finally {
      setBusy(null);
    }
  }, [fullUrl]);

  // Escape closes the lightbox, and the page behind it shouldn't scroll.
  useEffect(() => {
    if (!showFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowFull(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [showFull]);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setShowFull(true)}
        aria-label="View image full size"
        className="group block w-full relative cursor-zoom-in rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
      >
        {/* min-height reserves space before the image decodes, so the notes list
            doesn't jump as images stream in. */}
        <div className="w-full min-h-32 max-h-80 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailUrl}
            srcSet={`${thumbnailUrl} 1x, ${thumbnailUrl2x} 2x`}
            alt={caption || "Note image"}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            className={`w-full h-auto max-h-80 object-contain transition-opacity duration-200 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
        <span className="absolute inset-0 hidden lg:flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition">
          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition" />
        </span>
      </button>

      {caption && (
        <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap break-words">
          {caption}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-sm transition"
        >
          {busy === "copy" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          Copy
        </button>
        <button
          onClick={handleDownload}
          disabled={busy !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-sm transition"
        >
          {busy === "download" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Download
        </button>
      </div>

      {showFull && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setShowFull(false)}
          role="dialog"
          aria-modal="true"
          aria-label={caption || "Image preview"}
        >
          <button
            onClick={() => setShowFull(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            aria-label="Close image preview"
          >
            <X className="w-6 h-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fullUrl}
            alt={caption || "Full image"}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[85dvh] object-contain rounded-lg"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Insert Cloudinary transform params into an upload URL.
 * upload URL format: https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>.<ext>
 * We insert the transform string after "/upload/".
 */
function buildCloudinaryTransform(url: string, transform: string): string {
  if (!url) return url;
  // Only transform Cloudinary URLs
  if (!url.includes("res.cloudinary.com")) return url;
  return url.replace("/upload/", `/upload/${transform}/`);
}
