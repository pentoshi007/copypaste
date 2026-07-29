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
  MAX_BATCH_FILES,
  MAX_IMAGE_BYTES,
  UPLOAD_CONCURRENCY,
  classifyFile,
  inferContentType,
  uploadFileToR2,
  uploadImage,
  validateFile,
  type UploadKind,
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
  RotateCcw,
  Search,
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
 * Each file in a selection is tracked on its own: its own upload, its own
 * progress, its own cancel and its own failure. A batch can therefore mix
 * destinations freely — a photo goes to Cloudinary while the PDF and the .docx
 * next to it go to R2 — and one file failing doesn't take the others with it.
 */
type Attachment = {
  id: string;
  kind: UploadKind;
  name: string;
  size: number;
  mimeType: string;
  /**
   * name+size as picked, used to spot the same file being added twice. Held
   * separately because `name` is replaced with the server's sanitized filename
   * once an R2 upload finishes, which would stop later comparisons matching.
   */
  signature: string;
  /** Local object URL — images only, for an instant preview. */
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  progress: number;
  error: string;
  // Cloudinary (images)
  imageUrl: string;
  publicId: string;
  // R2 (files)
  storageKey: string;
};

let attachmentSeq = 0;
function nextAttachmentId(): string {
  attachmentSeq += 1;
  return `att-${attachmentSeq}`;
}

/** A file waiting for, or occupying, one of the upload lanes. */
type UploadJob = { id: string; file: File; kind: UploadKind };

export default function NoteEditor({
  onSubmitNotes,
  onToggleSidebar,
  onOpenSearch,
  sidebarOpen = false,
}: {
  /** Resolves true when the notes were accepted, false when the send failed. */
  onSubmitNotes: (drafts: NoteDraft[]) => Promise<boolean>;
  onToggleSidebar?: () => void;
  onOpenSearch?: () => void;
  sidebarOpen?: boolean;
}) {
  const [type, setType] = useState<NoteType>("text");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  // Object URLs must be revoked or they hold the whole file buffer in memory.
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const abortsRef = useRef<Map<string, AbortController>>(new Map());
  // The original File is kept so a failed upload can be retried without asking
  // the user to pick it again.
  const filesRef = useRef<Map<string, File>>(new Map());
  // Ids the user has removed. A job that hasn't reached a lane yet has no
  // AbortController to cancel, so this is what stops it starting at all.
  const cancelledRef = useRef<Set<string>>(new Set());
  // Files waiting for a lane, and how many lanes are running. The queue is
  // shared by fresh selections and retries, so the concurrency cap holds across
  // both instead of only within one selection.
  const queueRef = useRef<UploadJob[]>([]);
  const activeLanesRef = useRef(0);
  // Mirrors `attachments` so the picker can read the current queue (for the
  // duplicate and batch-size checks) without being re-created on every change.
  const attachmentsRef = useRef<Attachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const aborts = abortsRef.current;
    const urls = objectUrlsRef.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const patchAttachment = useCallback(
    (id: string, partial: Partial<Attachment>) => {
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...partial } : a))
      );
    },
    []
  );

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
  }, [content, attachments.length, resizeTextarea]);

  const releaseAttachment = useCallback((id: string) => {
    // Flagged before aborting: an upload still queued behind the active lanes
    // has no controller yet, and without this it would start after the user had
    // already removed it — uploading bytes nobody asked for and leaving an
    // object in the bucket that no note points at.
    cancelledRef.current.add(id);
    abortsRef.current.get(id)?.abort();
    abortsRef.current.delete(id);
    const url = objectUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(id);
    }
    filesRef.current.delete(id);
  }, []);

  const removeAttachment = useCallback(
    (id: string) => {
      releaseAttachment(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [releaseAttachment]
  );

  const clearAttachments = useCallback(() => {
    for (const id of attachmentsRef.current.map((a) => a.id)) {
      releaseAttachment(id);
    }
    setAttachments([]);
  }, [releaseAttachment]);

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
  /** Uploads one file to whichever backend its kind calls for. Never throws. */
  const uploadOne = useCallback(
    async (id: string, file: File, kind: UploadKind) => {
      if (cancelledRef.current.has(id)) return;

      const controller = new AbortController();
      abortsRef.current.set(id, controller);

      // Repainting the list on every progress event is wasteful with several
      // transfers in flight, and a 1% step isn't visible on a 3px-tall bar.
      let lastReported = -1;
      const onProgress = (percent: number) => {
        if (percent < 100 && percent - lastReported < 3) return;
        lastReported = percent;
        patchAttachment(id, { progress: percent });
      };

      try {
        if (kind === "image") {
          const result = await uploadImage(file, onProgress, controller.signal);
          patchAttachment(id, {
            status: "ready",
            progress: 100,
            error: "",
            imageUrl: result.secure_url,
            publicId: result.public_id,
          });
        } else {
          const result = await uploadFileToR2(
            file,
            onProgress,
            controller.signal
          );
          patchAttachment(id, {
            status: "ready",
            progress: 100,
            error: "",
            storageKey: result.storageKey,
            name: result.fileName,
            size: result.fileSize,
            mimeType: result.mimeType,
          });
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return; // cancelled or removed
        patchAttachment(id, {
          status: "error",
          error: (err as Error)?.message || "Upload failed",
        });
      } finally {
        if (abortsRef.current.get(id) === controller) {
          abortsRef.current.delete(id);
        }
      }
    },
    [patchAttachment]
  );

  /**
   * Starts lanes until the concurrency cap is reached. Each lane drains the
   * shared queue and then exits, so calling this again later simply spins up
   * however many lanes are free.
   *
   * Transfers are limited to a few at a time deliberately. Serially, a batch of
   * small files spends most of its time in connection setup; all at once, they
   * starve each other of uplink and every one finishes late.
   */
  const startLanes = useCallback(() => {
    while (
      activeLanesRef.current < UPLOAD_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      activeLanesRef.current += 1;
      void (async () => {
        try {
          for (;;) {
            const job = queueRef.current.shift();
            if (!job) return;
            await uploadOne(job.id, job.file, job.kind);
          }
        } finally {
          activeLanesRef.current -= 1;
        }
      })();
    }
  }, [uploadOne]);

  const attachFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const queued = attachmentsRef.current;
      // Picking the same file twice (a re-drop, or a paste after a drop) should
      // not upload it twice.
      const seen = new Set(queued.map((a) => a.signature));
      let slots = MAX_BATCH_FILES - queued.length;
      let overflow = 0;
      let duplicates = 0;
      let downgraded = 0;

      const rejections: string[] = [];
      const added: Attachment[] = [];
      const jobs: UploadJob[] = [];

      for (const file of incoming) {
        const invalid = validateFile(file);
        if (invalid) {
          rejections.push(invalid);
          continue;
        }

        const signature = `${file.name}:${file.size}`;
        if (seen.has(signature)) {
          duplicates += 1;
          continue;
        }
        if (slots <= 0) {
          overflow += 1;
          continue;
        }
        seen.add(signature);
        slots -= 1;

        const id = nextAttachmentId();
        const kind = classifyFile(file);
        const mimeType = inferContentType(file);

        // A photo past Cloudinary's cap is still accepted, but as a plain
        // attachment rather than an image note. That's a visible difference, so
        // say so instead of letting one photo in a batch render unlike the rest.
        if (
          kind === "file" &&
          mimeType.startsWith("image/") &&
          mimeType !== "image/svg+xml"
        ) {
          downgraded += 1;
        }

        // A local preview is worth it for anything the browser can draw, which
        // includes an oversized photo that's being routed to R2 as a plain file.
        // Skipped past the image cap so a huge bitmap isn't decoded just to fill
        // a 48px thumbnail.
        const previewUrl =
          mimeType.startsWith("image/") &&
          mimeType !== "image/svg+xml" &&
          file.size <= MAX_IMAGE_BYTES
            ? URL.createObjectURL(file)
            : "";
        if (previewUrl) objectUrlsRef.current.set(id, previewUrl);
        filesRef.current.set(id, file);

        added.push({
          id,
          kind,
          name: file.name,
          size: file.size,
          mimeType,
          signature,
          previewUrl,
          status: "uploading",
          progress: 0,
          error: "",
          imageUrl: "",
          publicId: "",
          storageKey: "",
        });
        jobs.push({ id, file, kind });
      }

      // One toast per problem gets noisy fast with a big selection.
      for (const message of rejections.slice(0, 2)) toast.error(message);
      if (rejections.length > 2) {
        toast.error(`${rejections.length - 2} more files were skipped`);
      }
      if (overflow > 0) {
        toast.error(
          `${MAX_BATCH_FILES} files at a time — ${overflow} left out`
        );
      }
      if (duplicates > 0) {
        toast.info(
          duplicates === 1
            ? "That file is already attached"
            : `${duplicates} files were already attached`
        );
      }
      if (downgraded > 0) {
        toast.info(
          downgraded === 1
            ? "That image is over 10MB, so it'll be sent as a file attachment"
            : `${downgraded} images are over 10MB, so they'll be sent as file attachments`
        );
      }
      if (added.length === 0) return;

      setAttachments((prev) => [...prev, ...added]);
      // Appended to whatever the ref already holds rather than rebuilt from the
      // snapshot taken above, so a progress or status update that landed while
      // this ran isn't thrown away.
      attachmentsRef.current = [...attachmentsRef.current, ...added];

      // Move focus to the caption so the next keystroke lands somewhere useful.
      requestAnimationFrame(() => captionRef.current?.focus());

      queueRef.current.push(...jobs);
      startLanes();
    },
    [startLanes]
  );

  const retryAttachment = useCallback(
    (id: string) => {
      const file = filesRef.current.get(id);
      if (!file) return;
      cancelledRef.current.delete(id);
      patchAttachment(id, { status: "uploading", progress: 0, error: "" });
      // Through the shared queue, so retrying ten failed files doesn't open ten
      // simultaneous transfers.
      queueRef.current.push({ id, file, kind: classifyFile(file) });
      startLanes();
    },
    [patchAttachment, startLanes]
  );

  // Paste anywhere in the composer — including the caption field.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      if (files.length === 0) return;

      e.preventDefault();
      attachFiles(files);
    },
    [attachFiles]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      attachFiles(acceptedFiles);
    },
    [attachFiles]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    // Any file type, any number — each one is classified on its own and routed
    // to the backend that suits it.
    multiple: true,
    noClick: true,
    noKeyboard: true,
  });

  // --- Submit ---------------------------------------------------------------
  const hasAttachments = attachments.length > 0;
  const uploadingCount = attachments.reduce(
    (n, a) => n + (a.status === "uploading" ? 1 : 0),
    0
  );
  const readyCount = attachments.reduce(
    (n, a) => n + (a.status === "ready" ? 1 : 0),
    0
  );
  const failedCount = attachments.length - uploadingCount - readyCount;
  const isUploading = uploadingCount > 0;

  // The toolbar's type buttons don't apply while files are attached: each file's
  // type comes from the file itself.
  const activeType: NoteType | null = hasAttachments ? null : type;
  const canSend = hasAttachments
    ? readyCount > 0 && uploadingCount === 0
    : content.trim().length > 0;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSaving || isUploading) return;

    let drafts: NoteDraft[];
    let sentIds: string[] = [];
    // Which chips had already failed when the user hit send. Used afterwards to
    // tell "a failure the user still has to deal with" apart from "a file they
    // attached while the request was in flight".
    const preexistingFailures = attachments
      .filter((a) => a.status === "error")
      .map((a) => a.id);

    if (hasAttachments) {
      const ready = attachments.filter((a) => a.status === "ready");
      if (ready.length === 0) {
        toast.error("No uploads have finished yet");
        return;
      }

      // One note per file. The caption is attached to every one of them so each
      // note stands on its own and all of them turn up in a search for it.
      const caption = content.trim();
      sentIds = ready.map((a) => a.id);
      drafts = ready.map((a) =>
        a.kind === "image"
          ? {
              type: "image",
              content: caption,
              imageUrl: a.imageUrl,
              publicId: a.publicId,
              language: "",
            }
          : {
              type: "file",
              content: caption,
              imageUrl: "",
              publicId: "",
              language: "",
              storageKey: a.storageKey,
              fileName: a.name,
              fileSize: a.size,
              mimeType: a.mimeType,
            }
      );
    } else {
      if (!content.trim()) return;
      drafts = [
        {
          type,
          content: content.trim(),
          imageUrl: "",
          publicId: "",
          language: type === "code" ? language : "",
        },
      ];
    }

    setIsSaving(true);
    const focusTarget = hasAttachments ? captionRef.current : textareaRef.current;
    const hadFocus = document.activeElement === focusTarget;
    try {
      const ok = await onSubmitNotes(drafts);
      if (!ok) return;

      // Clear exactly what was sent, never the whole queue. The composer stays
      // live during a send, so anything the user attached while the request was
      // in flight has to survive it — clearing wholesale would abort those
      // uploads and drop the files without a word.
      for (const id of sentIds) releaseAttachment(id);
      const sent = new Set(sentIds);
      const remaining = attachmentsRef.current.filter((a) => !sent.has(a.id));
      setAttachments(remaining);
      attachmentsRef.current = remaining;

      // The caption, type and language belong to the send that just happened, so
      // they're only kept when a failed file from that same send is still here
      // waiting to be retried with them.
      const keptFailure = remaining.some((a) =>
        preexistingFailures.includes(a.id)
      );
      if (!keptFailure) {
        setContent("");
        setLanguage("plaintext");
        setType("text");
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
            Drop files to attach
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

          {/* Mobile-only: on desktop the sidebar already has a search field. */}
          {onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label="Search notes"
              className="sm:hidden shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 active:bg-slate-200 dark:active:bg-slate-700 transition"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                if (hasAttachments) clearAttachments();
                setType(value);
              }}
              aria-pressed={activeType === value}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition ${
                activeType === value
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
          </button>

          {!hasAttachments && type === "code" && (
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

        {/* Attachment queue. Capped height with its own scroll, so twenty files
            don't push the input and send button off the screen. */}
        {hasAttachments && (
          <div className="rounded-lg bg-slate-100 dark:bg-slate-800 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {attachments.length}{" "}
                {attachments.length === 1 ? "file" : "files"}
                {uploadingCount > 0 && ` · ${uploadingCount} uploading`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </p>
              <button
                type="button"
                onClick={clearAttachments}
                className="text-xs font-medium text-slate-500 hover:text-red-500 transition"
              >
                {isUploading ? "Cancel all" : "Remove all"}
              </button>
            </div>

            <ul className="space-y-1.5 max-h-40 overflow-y-auto overscroll-none-y">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex items-center gap-2.5 rounded-md bg-white dark:bg-slate-900 p-1.5"
                >
                  <div className="relative w-10 h-10 shrink-0 rounded-md overflow-hidden bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    {attachment.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    )}
                    {attachment.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
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
                    {attachment.status === "error" ? (
                      <p
                        className="text-xs text-red-500 truncate"
                        title={attachment.error}
                      >
                        {attachment.error}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {attachment.status === "uploading"
                          ? `Uploading… ${attachment.progress}%`
                          : `${formatBytes(attachment.size)} · ready`}
                      </p>
                    )}
                    {attachment.status === "uploading" && (
                      <div
                        className="mt-1 h-1 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"
                        role="progressbar"
                        aria-valuenow={attachment.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Upload progress for ${attachment.name}`}
                      >
                        <div
                          className="h-full bg-blue-600 transition-[width] duration-150"
                          style={{ width: `${attachment.progress}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {attachment.status === "error" && (
                    <button
                      type="button"
                      onClick={() => retryAttachment(attachment.id)}
                      aria-label={`Retry ${attachment.name}`}
                      className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={
                      attachment.status === "uploading"
                        ? `Cancel ${attachment.name}`
                        : `Remove ${attachment.name}`
                    }
                    className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Input + send share one row, so the send button is always on screen
            regardless of attachments or how tall the input grows. */}
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
              placeholder={
                attachments.length > 1
                  ? "Add a caption for all of them (optional)…"
                  : "Add a caption (optional)…"
              }
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
            aria-label={
              readyCount > 1 ? `Send ${readyCount} notes` : "Send note"
            }
            className="shrink-0 h-11 w-11 sm:w-auto sm:px-4 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">
              {isSaving
                ? "Sending…"
                : readyCount > 1
                ? `Send ${readyCount}`
                : "Send"}
            </span>
          </button>
        </div>

        <p className="hidden sm:block text-xs text-slate-400">
          ⌘/Ctrl + Enter to send · paste or drag files to attach (up to{" "}
          {MAX_BATCH_FILES} at once)
        </p>
      </form>
    </div>
  );
}
