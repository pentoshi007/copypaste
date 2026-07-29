"use client";

import { Copy, Check } from "lucide-react";
import { useState, lazy, Suspense } from "react";
import { toast } from "sonner";

// Loaded in its own chunk, so pages without code notes never download Prism.
const CodeHighlighter = lazy(() => import("./CodeHighlighter"));

/**
 * Unhighlighted view of the same code, styled to match the oneDark theme.
 *
 * Rendered on the server and while the highlighter chunk is still in flight, so
 * the code itself is readable immediately rather than after a JS round-trip.
 */
function PlainCode({ content }: { content: string }) {
  return (
    <pre
      className="m-0 p-4 overflow-x-auto text-[0.8125rem] leading-normal font-mono text-slate-200"
      style={{ background: "#282c34" }}
    >
      <code className="whitespace-pre-wrap break-words">{content}</code>
    </pre>
  );
}

export default function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {language || "plaintext"}
        </span>
        <button
          onClick={handleCopy}
          aria-label="Copy code"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-green-500" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" /> Copy
            </>
          )}
        </button>
      </div>

      <Suspense fallback={<PlainCode content={content} />}>
        <CodeHighlighter content={content} language={language} />
      </Suspense>
    </div>
  );
}
