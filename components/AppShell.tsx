"use client";

import { useState, useCallback } from "react";
import type { NoteItem, ChatItem } from "@/lib/types";
import NoteEditor from "@/components/NoteEditor";
import NoteView from "@/components/NoteView";
import ChatList from "@/components/ChatList";
import { createChat } from "@/actions/chats";
import { Menu, X, MessageSquare } from "lucide-react";

export default function AppShell({
  initialChats,
  initialNotes,
}: {
  initialChats: ChatItem[];
  initialNotes: NoteItem[];
}) {
  const [chats, setChats] = useState<ChatItem[]>(initialChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(
    initialChats[0]?._id ?? null
  );
  const [notes, setNotes] = useState<NoteItem[]>(initialNotes);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ---- Chat handlers ----
  const handleSelectChat = useCallback((id: string) => {
    setActiveChatId(id);
    setSidebarOpen(false);
    // Fetch notes for this chat from the server
    fetch(`/api/notes?chatId=${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.notes) setNotes(data.notes);
      })
      .catch(() => {});
  }, []);

  const handleChatCreated = useCallback((chat: ChatItem) => {
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat._id);
    setNotes([]);
  }, []);

  const handleChatDeleted = useCallback((id: string) => {
    setChats((prev) => {
      const filtered = prev.filter((c) => c._id !== id);
      if (id === activeChatId) {
        setActiveChatId(filtered[0]?._id ?? null);
        setNotes([]);
        // If there's another chat, load its notes
        if (filtered[0]) {
          fetch(`/api/notes?chatId=${filtered[0]._id}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.notes) setNotes(data.notes);
            })
            .catch(() => {});
        }
      }
      return filtered;
    });
  }, [activeChatId]);

  const handleChatRenamed = useCallback((id: string, title: string) => {
    setChats((prev) =>
      prev.map((c) => (c._id === id ? { ...c, title } : c))
    );
  }, []);

  // ---- Auto-create chat when no active chat ----
  // Returns a chatId, creating a new chat if none is active.
  const handleEnsureChat = useCallback(async (): Promise<string | null> => {
    if (activeChatId) return activeChatId;
    const result = await createChat();
    if (result.error || !result.chat) return null;
    setChats((prev) => [result.chat!, ...prev]);
    setActiveChatId(result.chat._id);
    setNotes([]);
    return result.chat._id;
  }, [activeChatId]);

  // ---- Note handlers ----
  const handleNoteCreated = useCallback((note: NoteItem, chatTitle?: string) => {
    setNotes((prev) => [...prev, note]);
    // Move the chat to the top of the list (most recently active)
    // and update its title if the server auto-titled it from the first note
    setChats((prev) => {
      const idx = prev.findIndex((c) => c._id === note.chatId);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        title: chatTitle ?? updated[idx].title,
        updatedAt: new Date().toISOString(),
      };
      // Move to top
      const [moved] = updated.splice(idx, 1);
      updated.unshift(moved);
      return updated;
    });
  }, []);

  const handleNoteDeleted = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n._id !== id));
  }, []);

  const handleNoteUpdated = useCallback((updatedNote: NoteItem) => {
    setNotes((prev) =>
      prev.map((n) => (n._id === updatedNote._id ? updatedNote : n))
    );
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      {/* Mobile sidebar toggle — LEFT bottom */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="lg:hidden fixed bottom-4 left-4 z-50 p-3 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition"
        aria-label="Toggle chats"
      >
        {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Chat list sidebar — positioned below header (top-14), not covering navbar */}
      <aside
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 fixed lg:relative top-14 lg:top-0 bottom-0 lg:bottom-0 left-0 z-40 lg:z-30 w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-200 overflow-hidden flex flex-col`}
      >
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onChatCreated={handleChatCreated}
          onChatDeleted={handleChatDeleted}
          onChatRenamed={handleChatRenamed}
        />
      </aside>

      {/* Backdrop for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 top-14 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content area — flex column, only the notes list scrolls */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Notes list (chat messages) — ONLY this section scrolls */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 min-h-0">
          {activeChatId ? (
            notes.length > 0 ? (
              notes.map((note) => (
                <NoteView
                  key={note._id}
                  note={note}
                  onDeleted={handleNoteDeleted}
                  onUpdated={handleNoteUpdated}
                />
              ))
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500">
                <p className="text-sm">
                  No notes in this chat yet. Send one below ↓
                </p>
              </div>
            )
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
              <MessageSquare className="w-12 h-12 mb-3" />
              <p className="text-sm text-center">
                Start typing below — a new chat will be created automatically.
              </p>
            </div>
          )}
        </div>

        {/* Editor — FIXED at bottom, never scrolls */}
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
          <NoteEditor
            chatId={activeChatId}
            onCreated={handleNoteCreated}
            onEnsureChat={handleEnsureChat}
          />
        </div>
      </div>
    </div>
  );
}
