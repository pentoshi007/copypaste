"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { TEXT_PREVIEW_MAX_BYTES, type PreviewKind } from "@/lib/preview";

const subscribeNever = () => () => {};

export function usePdfEmbeddable(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false,
    () => true,
  );
}

export function fileHref(blockId: string, index?: number): string {
  const base = `/api/files/${encodeURIComponent(blockId)}`;
  return index === undefined ? base : `${base}?i=${index}`;
}

function TextPreview({ src }: { src: string }) {
  const [state, setState] = useState<{ text: string; truncated: boolean } | "error" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(src, { signal: controller.signal, credentials: "same-origin" })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((data: { text: string; truncated: boolean }) =>
        setState({ text: data.text, truncated: data.truncated }),
      )
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState("error");
      });
    return () => controller.abort();
  }, [src]);

  if (state === "error") return <p className="p-3 text-xs text-neutral-400">Couldn&apos;t load a preview.</p>;
  if (!state) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-neutral-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading preview…
      </div>
    );
  }

  return (
    <div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-neutral-700 dark:text-neutral-200">
        <code className="whitespace-pre">{state.text}</code>
      </pre>
      {state.truncated && (
        <p className="px-3 pb-2 text-xs text-neutral-400">
          Showing the first {formatBytes(TEXT_PREVIEW_MAX_BYTES)} — download for the full file.
        </p>
      )}
    </div>
  );
}

export default function AttachmentPreview({
  kind,
  href,
  textHref,
  title,
}: {
  kind: PreviewKind;
  href: string;
  textHref: string;
  title: string;
}) {
  const canEmbedPdf = usePdfEmbeddable();

  if (kind === "pdf") {
    if (!canEmbedPdf) {
      return (
        <p className="p-3 text-xs text-neutral-400">
          PDFs can&apos;t be shown inline here —{" "}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            open in a new tab
          </a>
          .
        </p>
      );
    }
    return (
      <>
        <iframe
          src={href}
          title={title}
          className="h-[60dvh] min-h-64 w-full border-0 bg-neutral-100 dark:bg-neutral-800"
        />
        <div className="flex justify-end p-2">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open full screen
          </a>
        </div>
      </>
    );
  }
  if (kind === "image") {
    return (
      <img
        src={href}
        alt={title}
        loading="lazy"
        decoding="async"
        className="max-h-80 w-full bg-neutral-100 object-contain dark:bg-neutral-800"
      />
    );
  }
  if (kind === "video") {
    return <video src={href} controls preload="metadata" playsInline className="max-h-96 w-full bg-black" />;
  }
  if (kind === "audio") {
    return (
      <div className="p-3">
        <audio src={href} controls preload="metadata" className="w-full" />
      </div>
    );
  }
  if (kind === "text") return <TextPreview src={textHref} />;
  return null;
}
