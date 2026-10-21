"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/client/hooks";

export default function CopyButton({
  text,
  label = "Copy",
  className = "",
  showLabel = false,
}: {
  text: string;
  label?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={async (event) => {
        event.stopPropagation();
        if (await copyToClipboard(text)) {
          setCopied(true);
          toast.success("Copied to clipboard");
        } else {
          toast.error("Couldn't copy — your browser blocked clipboard access");
        }
      }}
      className={`inline-flex items-center gap-1 rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${className}`}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
      {showLabel && <span className="text-xs">{copied ? "Copied" : label}</span>}
    </button>
  );
}
