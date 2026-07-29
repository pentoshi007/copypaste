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
  uploadWithProgress,
  validateImageFile,
  type UploadResult,
} from "@/lib/upload";
import { toast } from "sonner";
import {
  Type,
  Code2,
  Link2,
  Send,
  Loader2,
  Paperclip,
  X,
  MessagesSquare,
} from "lucide-react";

/** Text-ish types the user can pick explicitly. "image" is entered by attaching a file. */
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
  const [imageUrl, setImageUrl] = useState("");
  const [publicId, setPublicId] = useState("");
  const [localPreview, setLocalPreview] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  // Object URLs must be revoked or they leak the whole image buffer.
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
  }, [content, type, resizeTextarea]);

  const clearImage = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releaseObjectUrl();
    setLocalPreview("");
    setImageUrl("");
    setPublicId("");
    setProgress(0);
    setIsUploading(false);
    setType("text");
  }, [releaseObjectUrl]);

  const reset = useCallback(() => {
    setContent("");
    releaseObjectUrl();
    setLocalPreview("");
    setImageUrl("");
    setPublicId("");
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
  const uploadFile = useCallback(
    async (file: File) => {
      const invalid = validateImageFile(file);
      if (invalid) {
        toast.error(invalid);
        return;
      }

      // Show the local bitmap immediately — the user sees their image before a
      // single byte has left the device.
      releaseObjectUrl();
      const preview = URL.createObjectURL(file);
      objectUrlRef.current = preview;
      setLocalPreview(preview);
      setImageUrl("");
      setPublicId("");
      setType("image");
      setProgress(0);
      setIsUploading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
        const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
        if (!cloudName || !apiKey) {
          toast.error("Image uploads aren't configured");
          clearImage();
          return;
        }

        const timestamp = Math.round(Date.now() / 1000);

        const signRes = await fetch("/api/upload-sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Key must match the server's expected shape.
          body: JSON.stringify({ paramsToSign: { timestamp } }),
          signal: controller.signal,
        });

        if (!signRes.ok) {
          toast.error("Upload authorization failed");
          clearImage();
          return;
        }

        const { signature } = (await signRes.json()) as { signature: string };

        const formData = new FormData();
        formData.append("file", file);
        formData.append("api_key", apiKey);
        formData.append("timestamp", String(timestamp));
        formData.append("signature", signature);

        const data: UploadResult = await uploadWithProgress(
          `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
          formData,
          setProgress,
          controller.signal
        );

        setImageUrl(data.secure_url);
        setPublicId(data.public_id);
        // Move focus to the caption so the next keystroke lands somewhere useful.
        requestAnimationFrame(() => captionRef.current?.focus());
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return; // user cancelled
        toast.error((err as Error)?.message || "Image upload failed");
        clearImage();
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsUploading(false);
      }
    },
    [clearImage, releaseObjectUrl]
  );

  // Paste anywhere in the composer — including the caption field.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) continue;
          e.preventDefault();
          void uploadFile(file);
          return;
        }
      }
    },
    [uploadFile]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) void uploadFile(file);
    },
    [uploadFile]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
    noClick: true,
    noKeyboard: true,
    maxSize: 10 * 1024 * 1024,
  });

  // --- Submit ---------------------------------------------------------------
  const isImage = type === "image";
  const canSend = isImage
    ? Boolean(imageUrl) && !isUploading
    : content.trim().length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving || isUploading) return;

    if (isImage && !imageUrl) {
      toast.error("Wait for the image to finish uploading");
      return;
    }
    if (!isImage && !content.trim()) return;

    // Note: the optimistic note uses `imageUrl` (already uploaded — `canSend`
    // requires it), so the local object URL never leaves this component and
    // `reset()` can safely revoke it.
    const draft: NoteDraft = {
      type,
      content: isImage ? content : content.trim(),
      imageUrl,
      publicId,
      language: type === "code" ? language : "",
    };

    setIsSaving(true);
    const focusTarget = isImage ? captionRef.current : textareaRef.current;
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
  const previewSrc = imageUrl || localPreview;

  return (
    <div {...getRootProps()} onPaste={handlePaste} className="relative">
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/95 dark:bg-blue-950/80 flex items-center justify-center pointer-events-none">
          <p className="text-blue-600 dark:text-blue-400 font-medium text-sm">
            Drop image to upload
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
                if (isImage) clearImage();
                setType(value);
              }}
              aria-pressed={type === value}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${
                type === value
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
            aria-label="Attach image"
            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ${
              isImage
                ? "bg-blue-600 text-white"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Paperclip className="w-4 h-4" />
            Image
          </button>

          {type === "code" && (
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

        {/* Attachment chip — compact (fixed 48px) so image mode barely changes
            the composer's height. */}
        {isImage && previewSrc && (
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 p-2">
            <div className="relative w-12 h-12 shrink-0 rounded-md overflow-hidden bg-slate-200 dark:bg-slate-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewSrc}
                alt="Attachment preview"
                className="w-full h-full object-cover"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-white animate-spin" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {isUploading
                  ? `Uploading… ${progress}%`
                  : imageUrl
                  ? "Ready to send"
                  : "Attachment"}
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
              onClick={clearImage}
              aria-label={isUploading ? "Cancel upload" : "Remove image"}
              className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-white dark:hover:bg-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Input + send share one row, so the send button is always on screen
            regardless of attachments or how tall the input grows. */}
        <div className="flex items-end gap-2">
          {isImage ? (
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
          ⌘/Ctrl + Enter to send · paste or drag an image to attach
        </p>
      </form>
    </div>
  );
}
