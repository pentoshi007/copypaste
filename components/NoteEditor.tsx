"use client";

import { useState, useRef, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { CldUploadWidget } from "next-cloudinary";
import Image from "next/image";
import { createNote } from "@/actions/notes";
import type { NoteItem, NoteType } from "@/lib/types";
import { toast } from "sonner";
import {
  Type,
  Code2,
  Link2,
  Image as ImageIcon,
  Send,
  Loader2,
  Upload,
} from "lucide-react";

const TYPE_OPTIONS: { value: NoteType; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "code", label: "Code", icon: Code2 },
  { value: "link", label: "Link", icon: Link2 },
  { value: "image", label: "Image", icon: ImageIcon },
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
  chatId,
  onCreated,
  onEnsureChat,
}: {
  chatId: string | null;
  onCreated: (note: NoteItem, chatTitle?: string) => void;
  onEnsureChat: () => Promise<string | null>;
}) {
  const [type, setType] = useState<NoteType>("text");
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [imageUrl, setImageUrl] = useState("");
  const [publicId, setPublicId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setContent("");
    setImageUrl("");
    setPublicId("");
    setLanguage("plaintext");
  };

  // Auto-detect link type when content looks like a URL
  const handleContentChange = (val: string) => {
    setContent(val);
    if (type === "text" && /^https?:\/\/\S+$/i.test(val.trim()) && val.trim().split(/\s+/).length === 1) {
      setType("link");
    }
  };

  // Upload image file via fetch to Cloudinary signed upload
  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setType("image");
    try {
      const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
      if (!cloudName) {
        toast.error("Cloudinary not configured");
        return;
      }

      // 1. Get timestamp and unsigned params
      const timestamp = Math.round(Date.now() / 1000);

      // 2. Get signature from our auth-gated endpoint
      const signRes = await fetch("/api/upload-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          params_to_sign: { timestamp },
        }),
      });

      if (!signRes.ok) {
        toast.error("Upload authorization failed");
        return;
      }

      const { signature } = await signRes.json();

      // 3. Upload to Cloudinary
      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY!);
      formData.append("timestamp", String(timestamp));
      formData.append("signature", signature);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
        { method: "POST", body: formData }
      );

      if (!uploadRes.ok) {
        toast.error("Image upload failed");
        return;
      }

      const data = await uploadRes.json();
      setImageUrl(data.secure_url);
      setPublicId(data.public_id);
      toast.success("Image uploaded");
    } catch {
      toast.error("Failed to upload image");
    } finally {
      setIsUploading(false);
    }
  };

  // Paste handler — detect image in clipboard
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          await uploadFile(file);
          return;
        }
      }
    },
    []
  );

  // Drag-drop handler
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file && file.type.startsWith("image/")) {
        await uploadFile(file);
      }
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    multiple: false,
    noClick: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving || isUploading) return;

    // Auto-create a chat if none is active — no "select a chat first" error
    let effectiveChatId = chatId;
    if (!effectiveChatId) {
      effectiveChatId = await onEnsureChat();
      if (!effectiveChatId) {
        toast.error("Failed to create chat");
        return;
      }
    }

    if (type === "image" && !imageUrl) {
      toast.error("Please upload an image first");
      return;
    }

    if (type !== "image" && !content.trim()) {
      toast.error("Content cannot be empty");
      return;
    }

    setIsSaving(true);
    try {
      const result = await createNote({
        chatId: effectiveChatId,
        type,
        content: type === "image" ? content : content.trim(),
        imageUrl,
        publicId,
        language: type === "code" ? language : "",
      });

      if (result.error) {
        toast.error(result.error);
      } else if (result.note) {
        onCreated(result.note, result.chatTitle);
        reset();
        toast.success("Note saved");
      }
    } catch {
      toast.error("Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Cmd/Ctrl+Enter to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-blue-500 bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center pointer-events-none">
          <p className="text-blue-600 dark:text-blue-400 font-medium">
            Drop image to upload
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Type selector */}
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                type === value
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Image upload area */}
        {type === "image" && (
          <div className="flex items-center gap-3">
            {imageUrl ? (
              <div className="relative">
                <Image
                  src={imageUrl}
                  alt="Uploaded"
                  width={80}
                  height={80}
                  className="w-20 h-20 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                  unoptimized
                />
                <button
                  type="button"
                  onClick={() => {
                    setImageUrl("");
                    setPublicId("");
                  }}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600"
                >
                  ×
                </button>
              </div>
            ) : (
              <CldUploadWidget
                signatureEndpoint="/api/upload-sign"
                onSuccess={(result) => {
                  const info = result.info as { secure_url: string; public_id: string };
                  if (info?.secure_url) {
                    setImageUrl(info.secure_url);
                    setPublicId(info.public_id);
                    toast.success("Image uploaded");
                  }
                }}
                onError={() => toast.error("Upload failed")}
              >
                {({ open }) => (
                  <button
                    type="button"
                    onClick={() => open()}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-500 transition text-sm"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {isUploading ? "Uploading…" : "Upload image"}
                  </button>
                )}
              </CldUploadWidget>
            )}
            <span className="text-xs text-slate-400">
              Or paste/drag-drop an image
            </span>
          </div>
        )}

        {/* Content input */}
        {type !== "image" && (
          <>
            {type === "code" && (
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
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
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              rows={type === "code" ? 6 : 3}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition resize-y font-mono"
              placeholder={
                type === "code"
                  ? "Paste your code here…"
                  : type === "link"
                  ? "https://example.com"
                  : "Type or paste anything…"
              }
            />
          </>
        )}

        {/* Optional caption for images */}
        {type === "image" && (
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            placeholder="Optional caption…"
          />
        )}

        {/* Save button */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400 hidden sm:inline">
            ⌘/Ctrl + Enter to save
          </span>
          <button
            type="submit"
            disabled={isSaving || isUploading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition ml-auto"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
