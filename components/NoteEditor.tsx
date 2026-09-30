"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { useDropzone } from "react-dropzone";
import type { DraftAttachment, NoteDraft, NoteType } from "@/lib/types";
import { MAX_FILES_PER_NOTE, attachmentKind } from "@/lib/attachments";
import { splitSelection, uploadBatch, type UploadResult } from "@/lib/upload";
import AttachmentTray, {
  trayFromUpload,
  type TrayItem,
} from "./AttachmentTray";
import { toast } from "sonner";
import {
  Type,
  Code2,
  Link2,
  Send,
  Loader2,
  Paperclip,
  Search,
  MessagesSquare,
} from "lucide-react";

const TYPE_OPTIONS: { value: NoteType; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "code", label: "Code", icon: Code2 },
  { value: "link", label: "Link", icon: Link2 },
];

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

const UPLOAD_CONCURRENCY = 3;

type Pending = {
  id: string;
  file: File;
  previewUrl: string;
  result?: UploadResult;
  state: "uploading" | "ready" | "error";
  progress: number;
  error: string;
};

export default function NoteEditor({
  onSubmitNote,
  onToggleSidebar,
  onOpenSearch,
  sidebarOpen = false,
}: {
  onSubmitNote: (draft: NoteDraft) => Promise<boolean>;
  onToggleSidebar?: () => void;
  onOpenSearch?: () => void;
  sidebarOpen?: boolean;
}) {
  const [type, setType] = useState<NoteType>("text");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [pending, setPending] = useState<Pending[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const pendingCountRef = useRef(0);
  pendingCountRef.current = pending.length;

  const releasePreviews = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setPending((prev) => {
      for (const item of prev) {
        if (item.previewUrl && drop.has(item.id)) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return prev;
    });
  }, []);

  const abortAll = useCallback(() => {
    for (const controller of controllersRef.current.values()) controller.abort();
    controllersRef.current.clear();
  }, []);

  useEffect(() => abortAll, [abortAll]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [content, pending.length, resizeTextarea]);

  const clearPending = useCallback(
    (ids: string[]) => {
      for (const id of ids) controllersRef.current.get(id)?.abort();
      for (const id of ids) controllersRef.current.delete(id);
      releasePreviews(ids);
      setPending((prev) => prev.filter((item) => !ids.includes(item.id)));
    },
    [releasePreviews]
  );

  const reset = useCallback(() => {
    setContent("");
    releasePreviews(pending.map((item) => item.id));
    setPending([]);
    setLanguage("plaintext");
    setType("text");
  }, [pending, releasePreviews]);

  const handleContentChange = (val: string) => {
    setContent(val);
    if (
      type === "text" &&
      /^https?:\/\/\S+$/i.test(val.trim()) &&
      val.trim().split(/\s+/).length === 1
    ) {
      setType("link");
    }
  };

  const addItems = useCallback((items: Pending[]) => {
    setPending((prev) => [...prev, ...items]);
  }, []);

  const uploadOne = useCallback(async (item: Pending) => {
    const controller = new AbortController();
    controllersRef.current.set(item.id, controller);

    setPending((prev) =>
      prev.map((p) =>
        p.id === item.id
          ? { ...p, state: "uploading", progress: 0, error: "" }
          : p
      )
    );

    try {
      const batch = await uploadBatch(
        [item.file],
        (_index, percent) => {
          setPending((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, progress: percent } : p))
          );
        },
        controller.signal
      );

      const rejection = batch.rejections[0];
      if (rejection) throw new Error(rejection.error);

      const result = batch.uploaded[0];
      if (!result) throw new Error("Upload failed");

      setPending((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? { ...p, result, state: "ready", progress: 100, error: "" }
            : p
        )
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setPending((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? {
                ...p,
                state: "error",
                error: (err as Error)?.message || "Upload failed",
              }
            : p
        )
      );
    } finally {
      controllersRef.current.delete(item.id);
    }
  }, []);

  const runPool = useCallback(
    async (queue: Pending[]) => {
      const waiting = [...queue];
      const workers = Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, waiting.length) },
        async () => {
          for (let item = waiting.shift(); item; item = waiting.shift()) {
            await uploadOne(item);
          }
        }
      );
      await Promise.all(workers);
    },
    [uploadOne]
  );

  const attachFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      const room = MAX_FILES_PER_NOTE - pendingCountRef.current;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_FILES_PER_NOTE} files`);
        return;
      }
      const accepted = files.slice(0, room);
      if (files.length > room) {
        toast.error(`Only the first ${MAX_FILES_PER_NOTE} files can be attached`);
      }

      const { rejections } = splitSelection(accepted);
      const rejected = new Set(rejections.map((r) => r.index));
      for (const r of rejections) toast.error(r.error);
      const usable = accepted.filter((_, i) => !rejected.has(i));
      if (usable.length === 0) return;

      const added: Pending[] = usable.map((file) => ({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl:
          attachmentKind(file.type, file.name) === "image"
            ? URL.createObjectURL(file)
            : "",
        state: "uploading",
        progress: 0,
        error: "",
      }));

      addItems(added);
      requestAnimationFrame(() => captionRef.current?.focus());
      void runPool(added);
    },
    [addItems, runPool]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (files.length === 0) return;
      e.preventDefault();
      attachFiles(files);
    },
    [attachFiles]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: attachFiles,
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  const items = pending.map(toTrayItem);
  const readyItems = items.filter((item) => item.state === "ready");
  const busyItems = items.filter((item) => item.state === "uploading");
  const failedItems = items.filter((item) => item.state === "error");
  const hasAttachments = items.length > 0;

  const canSend =
    items.length > 0
      ? busyItems.length === 0 && readyItems.length > 0
      : content.trim().length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving) return;

    if (busyItems.length > 0) {
      toast.error("Wait for the uploads to finish");
      return;
    }
    if (!hasAttachments && !content.trim()) return;

    const draft: NoteDraft = buildDraft(readyItems, content, type, language);

    setIsSaving(true);
    const focusTarget = hasAttachments
      ? captionRef.current
      : textareaRef.current;
    const hadFocus = document.activeElement === focusTarget;
    try {
      const ok = await onSubmitNote(draft);
      if (ok) {
        reset();
        if (hadFocus) requestAnimationFrame(() => textareaRef.current?.focus());
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const retry = useCallback(
    (id: string) => {
      const item = pending.find((p) => p.id === id);
      if (item) void uploadOne(item);
    },
    [pending, uploadOne]
  );

  return (
    <div {...getRootProps()} onPaste={handlePaste} className="relative">
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/95 dark:bg-blue-950/80 flex items-center justify-center pointer-events-none">
          <p className="text-blue-600 dark:text-blue-400 font-medium text-sm">
            Drop files to attach
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-0.5 px-0.5">
          {onToggleSidebar && (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? "Hide chats" : "Show chats"}
              aria-expanded={sidebarOpen}
              className="lg:hidden shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:bg-slate-200 dark:active:bg-slate-700 transition"
            >
              <MessagesSquare className="w-4 h-4" />
              Chats
            </button>
          )}

          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Search notes"
              className="lg:hidden shrink-0 flex items-center justify-center w-9 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:bg-slate-200 dark:active:bg-slate-700 transition"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (hasAttachments) clearPending(items.map((i) => i.id));
                setType(value);
              }}
              aria-pressed={type === value && !hasAttachments}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${
                type === value && !hasAttachments
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => open()}
            aria-label="Attach files"
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${
              hasAttachments
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Paperclip className="w-4 h-4" />
            Files
            {items.length > 0 && (
              <span className="text-xs opacity-80">{items.length}</span>
            )}
          </button>

          {type === "code" && !hasAttachments && (
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Code language"
              className="shrink-0 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          )}
        </div>

        <AttachmentTray
          items={items}
          onRemove={(id) => clearPending([id])}
          onRetry={retry}
        />

        <div className="flex items-end gap-2">
          {hasAttachments ? (
            <input
              ref={captionRef}
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              enterKeyHint="send"
              maxLength={10000}
              className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="Caption the whole group (optional)…"
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={10000}
              className="composer-input flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-none overflow-y-auto font-mono leading-relaxed"
              placeholder={
                type === "code"
                  ? "Paste your code…"
                  : type === "link"
                  ? "https://example.com"
                  : "Type or paste anything…"
              }
            />
          )}

          <button
            type="submit"
            disabled={isSaving || !canSend}
            aria-label="Send note"
            className="shrink-0 h-11 w-11 sm:w-auto sm:px-4 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">
              {isSaving ? "Sending…" : "Send"}
            </span>
          </button>
        </div>

        <p className="hidden sm:block text-xs text-slate-400">
          ⌘/Ctrl + Enter to send · paste or drop files to attach a group
          {failedItems.length > 0 && ` · ${failedItems.length} failed`}
        </p>
      </form>
    </div>
  );
}

function toTrayItem(item: Pending): TrayItem {
  if (item.result) return trayFromUpload(item.result, item.previewUrl);
  return {
    id: item.id,
    index: 0,
    kind: attachmentKind(item.file.type, item.file.name),
    fileName: item.file.name,
    fileSize: item.file.size,
    mimeType: item.file.type || "application/octet-stream",
    previewUrl: item.previewUrl,
    state: item.state,
    progress: item.progress,
    error: item.error,
  };
}

function buildDraft(
  ready: TrayItem[],
  content: string,
  type: NoteType,
  language: string
): NoteDraft {
  if (ready.length === 0) {
    return {
      type,
      content: content.trim(),
      imageUrl: "",
      publicId: "",
      language: type === "code" ? language : "",
    };
  }

  const attachments: DraftAttachment[] = ready.map((item, index) => ({
    index,
    kind: item.kind,
    fileName: item.fileName,
    fileSize: item.fileSize,
    mimeType: item.mimeType,
    caption: "",
    ...(item.kind === "image"
      ? { imageUrl: item.imageUrl, publicId: item.publicId }
      : { storageKey: item.storageKey }),
  }));

  return {
    type: "group",
    content,
    imageUrl: "",
    publicId: "",
    language: "",
    attachments,
  };
}
