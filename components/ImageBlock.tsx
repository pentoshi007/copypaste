"use client";

import { Copy, Download, Maximize2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ImageBlock({
  imageUrl,
  caption,
}: {
  imageUrl: string;
  caption: string;
}) {
  const [showFull, setShowFull] = useState(false);

  // Build a Cloudinary thumbnail URL with on-the-fly transform
  const thumbnailUrl = buildCloudinaryTransform(imageUrl, "w_400,f_auto,q_auto");
  const fullUrl = buildCloudinaryTransform(imageUrl, "f_auto,q_auto");

  const handleCopy = async () => {
    try {
      const res = await fetch(thumbnailUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      toast.success("Image copied to clipboard");
    } catch {
      // Fallback: copy the URL
      try {
        await navigator.clipboard.writeText(imageUrl);
        toast.success("Image URL copied (browser doesn't support image copy)");
      } catch {
        toast.error("Failed to copy image");
      }
    }
  };

  const handleDownload = async () => {
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
    }
  };

  return (
    <div className="space-y-3">
      <div
        className="relative group cursor-pointer rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700"
        onClick={() => setShowFull(true)}
      >
        <div className="w-full max-h-80 flex items-center justify-center bg-slate-50 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailUrl}
            alt={caption || "Note image"}
            className="w-full h-auto max-h-80 object-contain"
          />
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center">
          <Maximize2 className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition" />
        </div>
      </div>

      {caption && (
        <p className="text-sm text-slate-600 dark:text-slate-400">{caption}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition"
        >
          <Copy className="w-4 h-4" /> Copy
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition"
        >
          <Download className="w-4 h-4" /> Download
        </button>
      </div>

      {/* Full image modal */}
      {showFull && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setShowFull(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullUrl}
              alt={caption || "Full image"}
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          </div>
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
