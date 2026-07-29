"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { NoteItem, ChatItem, NoteDraft } from "@/lib/types";
import NoteEditor from "@/components/NoteEditor";
import NoteView from "@/components/NoteView";
import ChatList from "@/components/ChatList";
import SearchPanel from "@/components/SearchPanel";
import { createChat } from "@/actions/chats";
import { createNote } from "@/actions/notes";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

function NotesSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="cp-skeleton rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-3 h-4 w-full rounded bg-slate-100 dark:bg-slate-800" />
          <div className="mt-2 h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}

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
  const [notesLoading, setNotesLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);

  // Notes already fetched, keyed by chatId. Switching back to a visited chat is
  // then instant, and we revalidate in the background (stale-while-revalidate).
  const notesCacheRef = useRef<Map<string, NoteItem[]>>(
    new Map(initialChats[0] ? [[initialChats[0]._id, initialNotes]] : [])
  );
  // De-dupes concurrent requests for the same chat (e.g. prefetch + click).
  const inFlightRef = useRef<Map<string, Promise<NoteItem[] | null>>>(new Map());
  // The chat the user most recently asked for; stale responses are discarded.
  const wantedChatRef = useRef<string | null>(initialChats[0]?._id ?? null);

  const listRef = useRef<HTMLDivElement>(null);
  // Set when a search result targets a note that isn't rendered yet; consumed
  // once its chat's notes arrive.
  const pendingJumpRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  // ---- Scrolling -----------------------------------------------------------
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Land at the newest note whenever the visible chat changes.
  useEffect(() => {
    scrollToBottom();
  }, [activeChatId, notesLoading, scrollToBottom]);

  // The keyboard opening shrinks the app; keep the newest note in view if the
  // user was already at the bottom.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (isNearBottom()) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [isNearBottom, scrollToBottom]);

  // ---- Fetching ------------------------------------------------------------
  const fetchNotes = useCallback((chatId: string) => {
    const existing = inFlightRef.current.get(chatId);
    if (existing) return existing;

    const request = fetch(`/api/notes?chatId=${encodeURIComponent(chatId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { notes?: NoteItem[] } | null) => {
        const fresh = data?.notes ?? null;
        if (fresh) notesCacheRef.current.set(chatId, fresh);
        return fresh;
      })
      .catch(() => null)
      .finally(() => {
        inFlightRef.current.delete(chatId);
      });

    inFlightRef.current.set(chatId, request);
    return request;
  }, []);

  const showChat = useCallback(
    (id: string) => {
      setActiveChatId(id);
      wantedChatRef.current = id;

      const cached = notesCacheRef.current.get(id);
      if (cached) {
        setNotes(cached);
        setNotesLoading(false);
      } else {
        setNotes([]);
        setNotesLoading(true);
      }

      void fetchNotes(id).then((fresh) => {
        // Ignore responses for a chat the user has already navigated away from.
        if (wantedChatRef.current !== id) return;
        if (fresh) setNotes(fresh);
        setNotesLoading(false);
      });
    },
    [fetchNotes]
  );

  const handleSelectChat = useCallback(
    (id: string) => {
      setSidebarOpen(false);
      if (id === activeChatId) return;
      showChat(id);
    },
    [activeChatId, showChat]
  );

  // Warm the cache on hover/touch so the chat is already loaded by the time the
  // tap registers.
  const handlePrefetchChat = useCallback(
    (id: string) => {
      if (notesCacheRef.current.has(id) || inFlightRef.current.has(id)) return;
      void fetchNotes(id);
    },
    [fetchNotes]
  );

  // Mirror the rendered notes into the cache so edits/deletes/rollbacks survive
  // a chat switch. Pending (unsaved) notes are excluded.
  useEffect(() => {
    if (!activeChatId || notesLoading) return;
    notesCacheRef.current.set(
      activeChatId,
      notes.some((n) => n.pending) ? notes.filter((n) => !n.pending) : notes
    );
  }, [notes, activeChatId, notesLoading]);

  // ---- Chat handlers -------------------------------------------------------
  const handleChatCreated = useCallback((chat: ChatItem) => {
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat._id);
    wantedChatRef.current = chat._id;
    notesCacheRef.current.set(chat._id, []);
    setNotes([]);
    setNotesLoading(false);
    setSidebarOpen(false);
  }, []);

  const handleChatDeleted = useCallback(
    (id: string) => {
      notesCacheRef.current.delete(id);
      inFlightRef.current.delete(id);

      // Computed outside the updater — `showChat` dispatches its own state
      // updates, which must not run inside another updater.
      const remaining = chats.filter((c) => c._id !== id);
      setChats(remaining);

      if (id !== activeChatId) return;

      const next = remaining[0];
      if (next) {
        showChat(next._id);
      } else {
        setActiveChatId(null);
        wantedChatRef.current = null;
        setNotes([]);
        setNotesLoading(false);
      }
    },
    [chats, activeChatId, showChat]
  );

  const handleChatRenamed = useCallback((id: string, title: string) => {
    setChats((prev) => prev.map((c) => (c._id === id ? { ...c, title } : c)));
  }, []);

  /** Move a chat to the top of the list and optionally retitle it. */
  const bumpChat = useCallback((chatId: string, title?: string) => {
    setChats((prev) => {
      const idx = prev.findIndex((c) => c._id === chatId);
      if (idx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.unshift({
        ...moved,
        title: title ?? moved.title,
        updatedAt: new Date().toISOString(),
      });
      return next;
    });
  }, []);

  // ---- Note handlers -------------------------------------------------------
  /**
   * Optimistic send: the note is rendered the moment it's submitted, then either
   * swapped for the saved copy or rolled back. Sending feels instant even on a
   * slow connection.
   */
  const handleSubmitNote = useCallback(
    async (draft: NoteDraft): Promise<boolean> => {
      let chatId = activeChatId;

      if (!chatId) {
        const result = await createChat();
        if (result.error || !result.chat) {
          toast.error(result.error ?? "Couldn't start a new chat");
          return false;
        }
        chatId = result.chat._id;
        setChats((prev) => [result.chat!, ...prev]);
        setActiveChatId(chatId);
        wantedChatRef.current = chatId;
        notesCacheRef.current.set(chatId, []);
        setNotes([]);
        setNotesLoading(false);
      }

      const tempId = `pending-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const optimistic: NoteItem = {
        _id: tempId,
        chatId,
        type: draft.type,
        content: draft.content,
        imageUrl: draft.imageUrl,
        publicId: draft.publicId,
        language: draft.language,
        createdAt: new Date().toISOString(),
        fileName: draft.fileName ?? "",
        fileSize: draft.fileSize ?? 0,
        mimeType: draft.mimeType ?? "",
        pending: true,
      };

      setNotes((prev) => [...prev, optimistic]);
      requestAnimationFrame(() => scrollToBottom("smooth"));

      const result = await createNote({
        chatId,
        type: draft.type,
        content: draft.content,
        imageUrl: draft.imageUrl,
        publicId: draft.publicId,
        language: draft.language,
        storageKey: draft.storageKey ?? "",
        fileName: draft.fileName ?? "",
        fileSize: draft.fileSize ?? 0,
        mimeType: draft.mimeType ?? "",
      });

      if (result.error || !result.note) {
        setNotes((prev) => prev.filter((n) => n._id !== tempId));
        toast.error(result.error ?? "Couldn't save note");
        return false;
      }

      const saved = result.note;
      setNotes((prev) => prev.map((n) => (n._id === tempId ? saved : n)));
      bumpChat(chatId, result.chatTitle);
      return true;
    },
    [activeChatId, bumpChat, scrollToBottom]
  );

  const handleNoteDeleted = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n._id !== id));
  }, []);

  const handleNoteUpdated = useCallback((updatedNote: NoteItem) => {
    setNotes((prev) =>
      prev.map((n) => (n._id === updatedNote._id ? updatedNote : n))
    );
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  // ---- Search ---------------------------------------------------------------
  /** Scrolls a rendered note into view and flashes it, so the hit is obvious. */
  const revealNote = useCallback((noteId: string) => {
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-note-id="${noteId}"]`
    );
    if (!row) return false;

    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightedNoteId(noteId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(
      () => setHighlightedNoteId(null),
      2000
    );
    return true;
  }, []);

  const handleSelectResult = useCallback(
    (chatId: string, noteId: string) => {
      if (chatId === activeChatId) {
        // Already open — but wait a frame so the panel has unmounted first.
        requestAnimationFrame(() => {
          if (!revealNote(noteId)) pendingJumpRef.current = noteId;
        });
        return;
      }
      // Different chat: switch, and let the effect below jump once it loads.
      pendingJumpRef.current = noteId;
      setSidebarOpen(false);
      showChat(chatId);
    },
    [activeChatId, revealNote, showChat]
  );

  // Completes a pending jump as soon as the target note is on screen.
  useEffect(() => {
    const target = pendingJumpRef.current;
    if (!target || notesLoading) return;
    if (!notes.some((n) => n._id === target)) return;
    pendingJumpRef.current = null;
    requestAnimationFrame(() => revealNote(target));
  }, [notes, notesLoading, revealNote]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Cmd/Ctrl+K from anywhere, the convention people already expect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  // Close the sidebar on Escape — it's a modal overlay on mobile.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const hasNotes = notes.length > 0;
  const renderedNotes = useMemo(
    () =>
      notes.map((note) => (
        <NoteView
          key={note._id}
          note={note}
          highlighted={note._id === highlightedNoteId}
          onDeleted={handleNoteDeleted}
          onUpdated={handleNoteUpdated}
        />
      )),
    [notes, highlightedNoteId, handleNoteDeleted, handleNoteUpdated]
  );

  return (
    <div className="relative flex-1 flex overflow-hidden min-h-0">
      {/* Chat list — absolutely positioned inside the content area on mobile so
          it tracks the app's (keyboard-adjusted) height instead of the raw
          browser viewport. */}
      <aside
        className={`${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0 absolute lg:relative inset-y-0 lg:inset-auto left-0 z-40 lg:z-auto w-72 max-w-[85%] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-200 will-change-transform overflow-hidden flex flex-col`}
      >
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onPrefetchChat={handlePrefetchChat}
          onChatCreated={handleChatCreated}
          onChatDeleted={handleChatDeleted}
          onChatRenamed={handleChatRenamed}
          onOpenSearch={openSearch}
        />
      </aside>

      {sidebarOpen && (
        <div
          className="lg:hidden absolute inset-0 z-30 bg-black/40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main column — only the notes list scrolls. */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-none-y p-3 sm:p-6 space-y-3 min-h-0"
        >
          {notesLoading ? (
            <NotesSkeleton />
          ) : activeChatId ? (
            hasNotes ? (
              renderedNotes
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 px-4">
                <p className="text-sm text-center">
                  No notes in this chat yet. Send one below ↓
                </p>
              </div>
            )
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 px-4">
              <MessageSquare className="w-12 h-12 mb-3" />
              <p className="text-sm text-center">
                Start typing below — a new chat will be created automatically.
              </p>
            </div>
          )}
        </div>

        {/* Composer — pinned to the bottom of the app shell.
            `composer-shell` caps it against the visual viewport and, as a last
            resort, it can shrink and scroll internally rather than overflowing
            into the clipped region below the fold. The send button shares a row
            with the input, so it's reachable either way. */}
        <div className="composer-shell border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 pt-2.5 sm:px-6 sm:pt-4 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-none-y">
          <div className="max-w-3xl mx-auto">
            <NoteEditor
              onSubmitNote={handleSubmitNote}
              onToggleSidebar={toggleSidebar}
              onOpenSearch={openSearch}
              sidebarOpen={sidebarOpen}
            />
          </div>
        </div>
      </div>

      {/* Mounted only while open, so closing it discards its state. */}
      {searchOpen && (
        <SearchPanel
          chats={chats}
          onClose={closeSearch}
          onSelectResult={handleSelectResult}
        />
      )}
    </div>
  );
}
