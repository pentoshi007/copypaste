"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  ChatItem,
  DraftAttachment,
  NoteAttachment,
  NoteDraft,
  NoteItem,
} from "@/lib/types";
import NoteEditor from "@/components/NoteEditor";
import NoteView from "@/components/NoteView";
import ChatList from "@/components/ChatList";
import SearchPanel from "@/components/SearchPanel";
import { createChat } from "@/actions/chats";
import { createNote, createNoteGroup } from "@/actions/notes";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

function toRenderableAttachment(a: DraftAttachment): NoteAttachment {
  const base = {
    index: a.index,
    kind: a.kind,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    caption: a.caption ?? "",
  };
  return a.kind === "image"
    ? { ...base, imageUrl: a.imageUrl ?? "", publicId: a.publicId ?? "" }
    : base;
}

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

  const notesCacheRef = useRef<Map<string, NoteItem[]>>(
    new Map(initialChats[0] ? [[initialChats[0]._id, initialNotes]] : [])
  );

  const inFlightRef = useRef<Map<string, Promise<NoteItem[] | null>>>(new Map());

  const wantedChatRef = useRef<string | null>(initialChats[0]?._id ?? null);

  const listRef = useRef<HTMLDivElement>(null);

  const pendingJumpRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    scrollToBottom();
  }, [activeChatId, notesLoading, scrollToBottom]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (isNearBottom()) scrollToBottom();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [isNearBottom, scrollToBottom]);

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

  const handlePrefetchChat = useCallback(
    (id: string) => {
      if (notesCacheRef.current.has(id) || inFlightRef.current.has(id)) return;
      void fetchNotes(id);
    },
    [fetchNotes]
  );

  useEffect(() => {
    if (!activeChatId || notesLoading) return;
    notesCacheRef.current.set(
      activeChatId,
      notes.some((n) => n.pending) ? notes.filter((n) => !n.pending) : notes
    );
  }, [notes, activeChatId, notesLoading]);

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
        attachments: draft.attachments?.map(toRenderableAttachment),
        pending: true,
      };

      setNotes((prev) => [...prev, optimistic]);
      requestAnimationFrame(() => scrollToBottom("smooth"));

      const result =
        draft.type === "group"
          ? await createNoteGroup({
              chatId,
              content: draft.content,
              attachments: draft.attachments ?? [],
            })
          : await createNote({
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

  const handleAttachmentCaptionChanged = useCallback(
    (noteId: string, index: number, caption: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n._id === noteId
            ? {
                ...n,
                attachments: n.attachments?.map((a) =>
                  a.index === index ? { ...a, caption } : a
                ),
              }
            : n
        )
      );
    },
    []
  );

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

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

        requestAnimationFrame(() => {
          if (!revealNote(noteId)) pendingJumpRef.current = noteId;
        });
        return;
      }

      pendingJumpRef.current = noteId;
      setSidebarOpen(false);
      showChat(chatId);
    },
    [activeChatId, revealNote, showChat]
  );

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
          onAttachmentCaptionChanged={(index, caption) =>
            handleAttachmentCaptionChanged(note._id, index, caption)
          }
        />
      )),
    [
      notes,
      highlightedNoteId,
      handleNoteDeleted,
      handleNoteUpdated,
      handleAttachmentCaptionChanged,
    ]
  );

  return (
    <div className="relative flex-1 flex overflow-hidden min-h-0">

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
