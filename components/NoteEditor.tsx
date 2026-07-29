"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import { useDropzone } from "react-dropzone";
import type { NoteDraft, NoteType } from "@/lib/types";
import {
  isImageFile,
  uploadFileToR2,
  uploadImage,
  validateImageFile,
} from "@/lib/upload";
import { formatBytes } from "@/lib/format";
import { toast } from "sonner";
import {
  Type,
  Code2,
  Link2,
  Send,
  Loader2,
  Paperclip,
  File as FileIcon,
  X,
  MessagesSquare,
} from "lucide-react";

/** Types the user picks explicitly. "image"/"file" come from attaching something. */
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

/**
 * A pending attachment.
 *
 * Images go to Cloudinary (which resizes at delivery time); everything else goes
 * to Cloudflare R2. `ready` flips once the bytes are stored and we have the
 * identifier we need to save the note.
 */
type Attachment = {
  kind: "image" | "file";
  name: string;
  size: number;
  mimeType: string;
  /** Local object URL — images only, for an instant preview. */
  previewUrl: string;
  ready: boolean;
  // Cloudinary (images)
  imageUrl: string;
  publicId: string;
  // R2 (files)
  storageKey: string;
};

export default function NoteEditor({
  onSubmitNote,
  onToggleSidebar,
  sidebarOpen = false,
}: {
  /** Resolves true when the note was accepted, false when it failed. */
  onSubmitNote: (draft: NoteDraft) => Promise<boolean>;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}) {
  const [type, setType] = useState<NoteType>("text");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  // Object URLs must be revoked or they hold the whole file buffer in memory.
  const objectUrlRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // --- Auto-growing textarea -------------------------------------------------
  // Height follows content up to a CSS max-height (see className), after which
  // the textarea scrolls internally. This keeps the composer — and therefore
  // the send button — inside the viewport no matter how much is typed.
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [content, attachment, resizeTextarea]);

  const clearAttachment = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releaseObjectUrl();
    setAttachment(null);
    setProgress(0);
    setIsUploading(false);
  }, [releaseObjectUrl]);

  const reset = useCallback(() => {
    setContent("");
    releaseObjectUrl();
    setAttachment(null);
    setProgress(0);
    setLanguage("plaintext");
    setType("text");
  }, [releaseObjectUrl]);

  // Auto-switch to the link type when the whole field is a single URL.
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

  // --- Upload ---------------------------------------------------------------
  const attachFile = useCallback(
    async (file: File) => {
      const asImage = isImageFile(file);

      if (asImage) {
        const invalid = validateImageFile(file);
        if (invalid) {
          toast.error(invalid);
          return;
        }
      } else if (file.size === 0) {
        toast.error("That file is empty");
        return;
      }

      // Show the attachment immediately — before a single byte has left the
      // device — so sending feels responsive on slow connections.
      releaseObjectUrl();
      const previewUrl = asImage ? URL.createObjectURL(file) : "";
      if (previewUrl) objectUrlRef.current = previewUrl;

      setAttachment({
        kind: asImage ? "image" : "file",
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        previewUrl,
        ready: false,
        imageUrl: "",
        publicId: "",
        storageKey: "",
      });
      setProgress(0);
      setIsUploading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (asImage) {
          const result = await uploadImage(file, setProgress, controller.signal);
          setAttachment((prev) =>
            prev
              ? {
                  ...prev,
                  ready: true,
                  imageUrl: result.secure_url,
                  publicId: result.public_id,
                }
              : prev
          );
        } else {
          const result = await uploadFileToR2(
            file,
            setProgress,
            controller.signal
          );
          setAttachment((prev) =>
            prev
              ? {
                  ...prev,
                  ready: true,
                  storageKey: result.storageKey,
                  name: result.fileName,
                  size: result.fileSize,
                  mimeType: result.mimeType,
                }
              : prev
          );
        }

        // Move focus to the caption so the next keystroke lands somewhere useful.
        requestAnimationFrame(() => captionRef.current?.focus());
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return; // user cancelled
        toast.error((err as Error)?.message || "Upload failed");
        clearAttachment();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsUploading(false);
      }
    },
    [clearAttachment, releaseObjectUrl]
  );

  // Paste anywhere in the composer — including the caption field.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          void attachFile(file);
          return;
        }
      }
    },
    [attachFile]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) void attachFile(file);
    },
    [attachFile]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    // Any file type — images route to Cloudinary, everything else to R2.
    multiple: false,
    noClick: true,
    noKeyboard: true,
  });

  // --- Submit ---------------------------------------------------------------
  const effectiveType: NoteType = attachment ? attachment.kind : type;
  const hasAttachment = attachment !== null;
  const canSend = hasAttachment
    ? attachment.ready && !isUploading
    : content.trim().length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving || isUploading) return;

    if (attachment && !attachment.ready) {
      toast.error("Wait for the upload to finish");
      return;
    }
    if (!attachment && !content.trim()) return;

    const draft: NoteDraft = attachment
      ? attachment.kind === "image"
        ? {
            type: "image",
            content,
            imageUrl: attachment.imageUrl,
            publicId: attachment.publicId,
            language: "",
          }
        : {
            type: "file",
            content,
            imageUrl: "",
            publicId: "",
            language: "",
            storageKey: attachment.storageKey,
            fileName: attachment.name,
            fileSize: attachment.size,
            mimeType: attachment.mimeType,
          }
      : {
          type,
          content: content.trim(),
          imageUrl: "",
          publicId: "",
          language: type === "code" ? language : "",
        };

    setIsSaving(true);
    const focusTarget = attachment ? captionRef.current : textareaRef.current;
    const hadFocus = document.activeElement === focusTarget;
    try {
      const ok = await onSubmitNote(draft);
      if (ok) {
        reset();
        // Keep the keyboard up so the user can fire off another note.
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

  const busy = isSaving || isUploading;

  return (
    <div {...getRootProps()} onPaste={handlePaste} className="relative">
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/95 dark:bg-blue-950/80 flex items-center justify-center pointer-events-none">
          <p className="text-blue-600 dark:text-blue-400 font-medium text-sm">
            Drop a file to attach
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        {/* Toolbar — single line, scrolls sideways instead of wrapping so the
            composer's height stays predictable on narrow screens. */}
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

          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (hasAttachment) clearAttachment();
                setType(value);
              }}
              aria-pressed={effectiveType === value}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${
                effectiveType === value
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
            disabled={isUploading}
            aria-label="Attach a file"
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${
              hasAttachment
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Paperclip className="w-4 h-4" />
            File
          </button>

          {effectiveType === "code" && (
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

        {/* Attachment chip — fixed 48px tall so attaching something barely
            changes the composer's height. */}
        {attachment && (
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-2">
            <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
              {attachment.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={attachment.previewUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <FileIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
              )}
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate"
                title={attachment.name}
              >
                {attachment.name || "Attachment"}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isUploading
                  ? `Uploading… ${progress}%`
                  : attachment.ready
                  ? `${formatBytes(attachment.size)} · ready`
                  : formatBytes(attachment.size)}
              </p>
              {isUploading && (
                <div
                  className="mt-1 h-1 w-full rounded-full bg-slate-300 dark:bg-slate-600 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Upload progress"
                >
                  <div
                    className="h-full bg-blue-600 transition-[width] duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={clearAttachment}
              aria-label={isUploading ? "Cancel upload" : "Remove attachment"}
              className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-white dark:hover:bg-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input + send share one row, so the send button is always on screen
            regardless of attachments or how tall the input grows. */}
        <div className="flex items-end gap-2">
          {hasAttachment ? (
            <input
              ref={captionRef}
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              enterKeyHint="send"
              maxLength={10000}
              className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
              placeholder="Add a caption (optional)…"
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={10000}
              // text-base on mobile: anything under 16px makes iOS Safari zoom
              // in on focus, which knocks the layout sideways.
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
            disabled={busy || !canSend}
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
          ⌘/Ctrl + Enter to send · paste or drag a file to attach
        </p>
      </form>
    </div>
  );
}
