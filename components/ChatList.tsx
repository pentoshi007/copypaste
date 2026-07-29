"use client";

import { useState, useTransition } from "react";
import type { ChatItem } from "@/lib/types";
import { createChat, updateChatTitle, deleteChat } from "@/actions/chats";
import LocalTime from "./LocalTime";
import { toast } from "sonner";
import {
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  Check,
  Search,
  X,
  Loader2,
} from "lucide-react";

export default function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  onPrefetchChat,
  onChatCreated,
  onChatDeleted,
  onChatRenamed,
  onOpenSearch,
}: {
  chats: ChatItem[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  /** Called on hover/touch-start so a chat's notes are cached before the tap lands. */
  onPrefetchChat?: (id: string) => void;
  onChatCreated: (chat: ChatItem) => void;
  onChatDeleted: (id: string) => void;
  onChatRenamed: (id: string, title: string) => void;
  onOpenSearch?: () => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    setIsCreating(true);
    startTransition(async () => {
      const result = await createChat();
      if (result.error) {
        toast.error(result.error);
      } else if (result.chat) {
        onChatCreated(result.chat);
        toast.success("New chat created");
      }
      setIsCreating(false);
    });
  };

  const handleRename = (chatId: string) => {
    startTransition(async () => {
      const result = await updateChatTitle(chatId, editTitle);
      if (result.error) {
        toast.error(result.error);
      } else if (result.chat) {
        onChatRenamed(chatId, result.chat.title);
        toast.success("Chat renamed");
      }
      setEditingId(null);
    });
  };

  const handleDelete = (chatId: string) => {
    setDeletingId(chatId);
    startTransition(async () => {
      const result = await deleteChat(chatId);
      if (result.error) {
        toast.error(result.error);
      } else {
        onChatDeleted(chatId);
        toast.success("Chat deleted");
      }
      setDeletingId(null);
      setConfirmId(null);
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with search + New Chat */}
      <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Search notes</span>
            {/* Hint the shortcut only where a physical keyboard is likely. */}
            <kbd className="hidden lg:inline text-[10px] font-sans px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600">
              ⌘K
            </kbd>
          </button>
        )}

        <button
          onClick={handleCreate}
          disabled={isCreating}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium text-sm transition"
        >
          {isCreating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          New Chat
        </button>
      </div>

      {/* Chat list */}
      {chats.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 px-4">
          <MessageSquare className="w-8 h-8 mb-2" />
          <p className="text-sm text-center">
            No chats yet. Create one to get started.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {chats.map((chat) => {
            const isActive = chat._id === activeChatId;
            const isEditing = editingId === chat._id;
            const isConfirming = confirmId === chat._id;
            const isDeleting = deletingId === chat._id;

            return (
              <li key={chat._id}>
                <div
                  className={`group relative rounded-lg transition ${
                    isActive
                      ? "bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-200 dark:ring-blue-800"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {isEditing ? (
                    /* Inline rename form */
                    <div className="px-3 py-2 flex items-center gap-1">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleRename(chat._id);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        autoFocus
                        maxLength={100}
                        // text-base on mobile stops iOS Safari zooming on focus.
                        className="flex-1 min-w-0 px-2 py-1 rounded text-base sm:text-sm bg-white dark:bg-slate-900 border border-blue-400 text-slate-900 dark:text-white outline-none"
                      />
                      <button
                        onClick={() => handleRename(chat._id)}
                        disabled={isPending}
                        className="p-1 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30 transition"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={isPending}
                        className="p-1 rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : isConfirming ? (
                    /* Confirm delete */
                    <div className="px-3 py-2.5 flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Delete chat & all notes?
                      </span>
                      <button
                        onClick={() => handleDelete(chat._id)}
                        disabled={isPending || isDeleting}
                        className="px-2 py-1 rounded text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition"
                      >
                        {isDeleting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          "Yes"
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setConfirmId(null);
                          setDeletingId(null);
                        }}
                        disabled={isPending}
                        className="px-2 py-1 rounded text-xs bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 transition"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    /* Normal chat row */
                    <>
                      <button
                        onClick={() => onSelectChat(chat._id)}
                        onPointerEnter={() => onPrefetchChat?.(chat._id)}
                        onTouchStart={() => onPrefetchChat?.(chat._id)}
                        onFocus={() => onPrefetchChat?.(chat._id)}
                        aria-current={isActive ? "true" : undefined}
                        className="w-full text-left px-3 py-2.5 pr-16"
                      >
                        <div className="flex items-start gap-2">
                          <MessageSquare className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                              {chat.title}
                            </p>
                            <LocalTime
                              iso={chat.updatedAt}
                              className="block text-xs text-slate-400 mt-0.5"
                            />
                          </div>
                        </div>
                      </button>

                      {/* Edit + Delete buttons.
                          Always visible on touch screens — `group-hover` never
                          fires there, which made them unreachable on mobile. */}
                      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(chat._id);
                            setEditTitle(chat.title);
                          }}
                          aria-label="Rename chat"
                          className="p-1.5 rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmId(chat._id);
                          }}
                          aria-label="Delete chat"
                          className="p-1.5 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
