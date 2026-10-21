"use client";

import { lazy, Suspense, useCallback, type KeyboardEvent } from "react";
import AutoTextarea from "./AutoTextarea";
import CopyButton from "./CopyButton";
import { useEditor } from "@/components/editor/EditorContext";
import { caretAtEnd, caretAtStart, insertText } from "@/lib/client/textarea";
import { CODE_LANGUAGES } from "@/lib/editor/blockTypes";
import type { LocalBlock } from "@/lib/client/blockStore";

const CodeHighlighter = lazy(() => import("@/components/CodeHighlighter"));

const CODE_TEXT = "font-mono text-[0.8125rem] leading-6 whitespace-pre-wrap break-words";

function PlainCode({ content }: { content: string }) {
  return <pre className={`m-0 p-4 text-neutral-200 ${CODE_TEXT}`}>{content}</pre>;
}

export default function CodeBlock({ block, editing }: { block: LocalBlock; editing: boolean }) {
  const api = useEditor();
  const key = block.key;
  const registerInput = useCallback(
    (element: HTMLTextAreaElement | null) => api.registerInput(key, element),
    [api, key],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;

    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      insertText(element, "  ");
      return;
    }
    if (mod && event.key === "Enter") {
      event.preventDefault();
      api.insertBelow(key);
      return;
    }
    if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      api.duplicate(key);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      api.escape(key);
      return;
    }
    if (event.key === "Backspace" && caretAtStart(element) && !element.value) {
      event.preventDefault();
      api.convert(key, "text");
      return;
    }
    if (event.key === "ArrowUp" && caretAtStart(element) && api.focusNeighbor(key, -1, "end")) {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown" && caretAtEnd(element) && api.focusNeighbor(key, 1, "start")) {
      event.preventDefault();
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-[#282c34] dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-2 py-1">
        <select
          value={block.language || "plaintext"}
          onChange={(event) => api.store.update(key, { language: event.target.value })}
          aria-label="Code language"
          className="rounded bg-transparent px-1 py-0.5 font-mono text-xs text-neutral-300 outline-none hover:bg-white/10 focus:ring-1 focus:ring-blue-400"
        >
          {CODE_LANGUAGES.map((language) => (
            <option key={language} value={language} className="bg-neutral-900">
              {language}
            </option>
          ))}
        </select>
        <CopyButton
          text={block.content}
          label="Copy code"
          showLabel
          className="px-2 py-1 text-neutral-300 hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
        />
      </div>

      {editing ? (
        <AutoTextarea
          ref={registerInput}
          value={block.content}
          onChange={(event) => api.store.update(key, { content: event.target.value }, { debounce: true })}
          onKeyDown={handleKeyDown}
          onBlur={() => api.stopEditing(key)}
          placeholder="Paste or write code…"
          aria-label="Code"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={20000}
          className={`p-4 text-neutral-100 caret-white ${CODE_TEXT} max-sm:text-base`}
        />
      ) : (
        <div
          role="button"
          tabIndex={-1}
          onClick={(event) => (event.shiftKey ? api.select(key, true) : api.focusBlock(key, "end"))}
          className="cursor-text"
        >
          {block.content ? (
            <Suspense fallback={<PlainCode content={block.content} />}>
              <CodeHighlighter content={block.content} language={block.language} />
            </Suspense>
          ) : (
            <pre className={`m-0 p-4 text-neutral-500 ${CODE_TEXT}`}>Paste or write code…</pre>
          )}
        </div>
      )}
    </div>
  );
}
