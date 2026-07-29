"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatItem, NoteItem } from "@/lib/types";
import { buildSnippet } from "@/lib/highlight";
import { formatBytes } from "@/lib/format";
import LocalTime from "./LocalTime";
import {
  Code2,
  File as FileIcon,
  Image as ImageIcon,
  Link2,
  Loader2,
  Search,
  Type,
  X,
} from "lucide-react";

/**
 * Search overlay.
 *
 * Mounted only while open (AppShell renders it conditionally), so closing it
 * discards all state — no reset logic needed.
 *
 * "Is a search in flight" is *derived* by comparing the current query with the
 * query the last completed response was for, rather than kept in its own state.
 * That means one state update per completed request instead of a set-on-start /
 * set-on-finish pair, and a stale response can never leave the spinner stuck.
 */

const DEBOUNCE_MS = 180;
const MIN_QUERY_LENGTH = 2;

type Outcome = {
  /** The trimmed query this outcome belongs to. */
  query: string;
  results: NoteItem[];
  truncated: boolean;
  error: string | null;
};

function typeIcon(type: NoteItem["type"]) {
  const className = "w-4 h-4 shrink-0 text-slate-400";
  if (type === "code") return <Code2 className={className} />;
  if (type === "link") return <Link2 className={className} />;
  if (type === "image") return <ImageIcon className={className} />;
  if (type === "file") return <FileIcon className={className} />;
  return <Type className={className} />;
}

/** Renders a snippet with the matched runs emphasised. */
function Snippet({ text, query }: { text: string; query: string }) {
  const { segments, clippedStart, clippedEnd } = useMemo(
    () => buildSnippet(text, query),
    [text, query]
  );

  return (
    <span className="text-sm text-slate-600 dark:text-slate-300 break-words">
      {clippedStart && "… "}
      {segments.map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className="rounded bg-amber-200 dark:bg-amber-500/40 text-slate-900 dark:text-amber-50 px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
      {clippedEnd && " …"}
    </span>
  );
}

export default function SearchPanel({
  chats,
  onClose,
  onSelectResult,
}: {
  /** Used to label each hit with its chat — saves a server-side join. */
  chats: ChatItem[];
  onClose: () => void;
  onSelectResult: (chatId: string, noteId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;
  const current = outcome?.query === trimmed ? outcome : null;
  const loading = !tooShort && current === null;
  const results = current?.results ?? [];
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));

  const chatTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const chat of chats) map.set(chat._id, chat.title);
    return map;
  }, [chats]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch. Every keystroke aborts the request in flight, so a slow
  // response for "re" can't overwrite the results for "report".
  useEffect(() => {
    if (tooShort) return;

    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then((res) =>
          res.ok ? res.json() : Promise.reject(new Error(String(res.status)))
        )
        .then((data: { results?: NoteItem[]; truncated?: boolean }) => {
          setOutcome({
            query: trimmed,
            results: data.results ?? [],
            truncated: Boolean(data.truncated),
            error: null,
          });
          setActive(0);
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setOutcome({
            query: trimmed,
            results: [],
            truncated: false,
            error: "Search failed. Try again.",
          });
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [trimmed, tooShort]);

  const choose = useCallback(
    (note: NoteItem) => {
      onSelectResult(note.chatId, note._id);
      onClose();
    },
    [onSelectResult, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const note = results[activeIndex];
      if (note) choose(note);
    }
  };

  // Keep the keyboard-selected row visible. DOM-only, no state involved.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const showEmpty = current !== null && !current.error && results.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 sm:p-6 sm:pt-[10vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
    >
      <div
        // Full-bleed on phones, floating dialog from sm up. Height follows the
        // visual-viewport variable so the keyboard can't push it off-screen.
        className="w-full sm:max-w-2xl flex flex-col bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl overflow-hidden h-[var(--app-height,100dvh)] sm:h-auto sm:max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 border-b border-slate-200 dark:border-slate-800 pt-[env(safe-area-inset-top,0px)]">
          <Search className="w-4 h-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages, captions, filenames…"
            maxLength={100}
            enterKeyHint="search"
            autoComplete="off"
            // text-base on mobile stops iOS Safari zooming on focus.
            className="flex-1 min-w-0 h-14 bg-transparent text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none"
            aria-label="Search query"
          />
          {loading && (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-slate-400" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-none-y pb-[env(safe-area-inset-bottom,0px)]"
        >
          {tooShort && (
            <p className="p-4 text-sm text-slate-400">
              Type at least {MIN_QUERY_LENGTH} characters. Searches every chat —
              message text, image and file captions, and attachment filenames.
            </p>
          )}

          {current?.error && (
            <p className="p-4 text-sm text-red-500">{current.error}</p>
          )}

          {showEmpty && (
            <p className="p-4 text-sm text-slate-400">
              No matches for &ldquo;{trimmed}&rdquo;.
            </p>
          )}

          {results.length > 0 && (
            <ul>
              {results.map((note, index) => {
                const heading =
                  note.type === "file" ? note.fileName || "Attachment" : null;
                const body = note.content;

                return (
                  <li key={note._id}>
                    <button
                      type="button"
                      data-index={index}
                      onClick={() => choose(note)}
                      onMouseEnter={() => setActive(index)}
                      className={`w-full text-left px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition ${
                        index === activeIndex
                          ? "bg-blue-50 dark:bg-blue-950/40"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {typeIcon(note.type)}
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                          {chatTitles.get(note.chatId) ?? "Chat"}
                        </span>
                        <span className="text-xs text-slate-300 dark:text-slate-600">
                          ·
                        </span>
                        <LocalTime
                          iso={note.createdAt}
                          className="text-xs text-slate-400 whitespace-nowrap"
                        />
                      </div>

                      {heading && (
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          <Snippet text={heading} query={trimmed} />
                          {note.fileSize ? (
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              {formatBytes(note.fileSize)}
                            </span>
                          ) : null}
                        </p>
                      )}

                      {body && (
                        <p className={heading ? "mt-0.5" : ""}>
                          <Snippet text={body} query={trimmed} />
                        </p>
                      )}

                      {!heading && !body && (
                        <p className="text-sm text-slate-400 italic">
                          {note.type === "image" ? "Image" : "Attachment"} with no
                          caption
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {current?.truncated && (
            <p className="p-4 text-xs text-slate-400">
              Showing the most recent matches only — narrow the search to see
              older ones.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
