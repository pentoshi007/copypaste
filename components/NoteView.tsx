"use client";

import type { NoteItem } from "@/lib/types";
import TextBlock from "./TextBlock";
import CodeBlock from "./CodeBlock";
import LinkBlock from "./LinkBlock";
import ImageBlock from "./ImageBlock";
import { Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { memo, useState, useTransition } from "react";
import { deleteNote, updateNote } from "@/actions/notes";
import { toast } from "sonner";

const LANGUAGES = [
  "plaintext",
  "javascript",
  "typescript",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "sql",
  "bash",
  "html",
  "css",
  "json",
  "yaml",
  "markdown",
];

function NoteView({
  note,
  onDeleted,
  onUpdated,
}: {
  note: NoteItem;
  onDeleted: (id: string) => void;
  onUpdated: (note: NoteItem) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const [editLanguage, setEditLanguage] = useState(note.language || "plaintext");
  const [isPending, startTransition] = useTransition();

  // An optimistically-rendered note has no server id yet, so it can't be
  // edited or deleted until it lands.
  const isPendingNote = Boolean(note.pending);

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteNote(note._id);
      if (result.error) {
        toast.error(result.error);
        setConfirming(false);
      } else {
        onDeleted(note._id);
      }
    });
  };

  const handleSaveEdit = () => {
    const trimmed = editContent.trim();
    if (!trimmed) {
      toast.error("Content cannot be empty");
      return;
    }
    startTransition(async () => {
      const result = await updateNote({
        noteId: note._id,
        content: trimmed,
        language: editLanguage,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.note) onUpdated(result.note);
      setIsEditing(false);
    });
  };

  const startEdit = () => {
    setEditContent(note.content);
    setEditLanguage(note.language || "plaintext");
    setIsEditing(true);
  };

  // Images can't be edited inline (would need re-upload)
  const canEdit = note.type !== "image" && !isPendingNote;

  return (
    <div className="max-w-3xl mx-auto">
      <div
        className={`bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-opacity ${
          isPendingNote ? "opacity-60" : "opacity-100"
        }`}
      >
        <div className="px-3 sm:px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {isPendingNote
                ? "Sending…"
                : new Date(note.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
            </span>
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              {note.type}
            </span>
          </div>

          {isPendingNote ? (
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-slate-400" />
          ) : isEditing ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleSaveEdit}
                disabled={isPending}
                className="p-1.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition"
                aria-label="Save edit"
              >
                {isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                disabled={isPending}
                className="p-1.5 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-label="Cancel edit"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : !confirming ? (
            <div className="flex items-center gap-0.5 shrink-0">
              {canEdit && (
                <button
                  onClick={startEdit}
                  aria-label="Edit note"
                  className="p-1.5 rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setConfirming(true)}
                aria-label="Delete note"
                className="p-1.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition"
              >
                {isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "Delete"
                )}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="px-2 py-1 rounded text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 transition"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="p-3 sm:p-4">
          {isEditing ? (
            <div className="space-y-2">
              {note.type === "code" && (
                <select
                  value={editLanguage}
                  onChange={(e) => setEditLanguage(e.target.value)}
                  aria-label="Code language"
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoFocus
                rows={note.type === "code" ? 8 : 4}
                maxLength={10000}
                // text-base on mobile stops iOS Safari zooming on focus.
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-y font-mono"
              />
            </div>
          ) : (
            <>
              {note.type === "text" && <TextBlock content={note.content} />}
              {note.type === "code" && (
                <CodeBlock content={note.content} language={note.language} />
              )}
              {note.type === "link" && <LinkBlock url={note.content} />}
              {note.type === "image" && (
                <ImageBlock imageUrl={note.imageUrl} caption={note.content} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoised: without this, any AppShell state change (typing in the composer,
 * switching a chat, toggling the sidebar) re-rendered every note in the list —
 * including re-running syntax highlighting for each code note.
 */
export default memo(NoteView);
