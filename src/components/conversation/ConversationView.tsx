"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { notFound, useSearchParams } from "next/navigation";
import type { Attachment, ConversationBookmark, Message, Pin, Reaction, ScheduledMessage } from "@/lib/database.types";
import { useRouter } from "next/navigation";
import { availableCommands } from "@/lib/slash";
import { parseAwayArg } from "@/lib/presence";
import { futureTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_EVENT, useStore, type IncomingMessageEvent } from "@/components/shell/store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { dayKey, dayLabel } from "@/lib/format";
import { mentionedNames } from "@/lib/richtext";
import { useConversationChannel, type Change, type TypingEvent } from "@/lib/realtime/useConversationChannel";
import { BUCKET, categoryFor, imageDimensions, storagePath, toJson } from "@/lib/storage/attachments";
import { useSignedUrls } from "@/lib/storage/useSignedUrls";
import { Header } from "./Header";
import { ATTACH_EVENT, Composer, type OutgoingFile } from "./Composer";
import { MessageItem, type LocalMessage } from "./MessageItem";
import { FileToPropertyDialog } from "./FileToPropertyDialog";
import type { PendingAttachment } from "./AttachmentView";
import { PinsTab } from "./PinsTab";
import { BookmarkBar } from "./BookmarkBar";
import { BookmarksTab } from "./BookmarksTab";
import { BookmarkDialog, type BookmarkDraft } from "./BookmarkDialog";
import { FilesTab } from "./FilesTab";
import { DetailsModal, type DetailTab } from "./DetailsModal";
import { ThreadPanel } from "./ThreadPanel";
import { CallBar, type CallTarget } from "./CallBar";
import { startCall } from "@/lib/calls/startCall";
import { callableProfiles } from "@/lib/calls/callable";

export interface PinWithMessage {
  pinned_at: string;
  pinned_by: string | null;
  message: Message;
}

interface ConversationViewProps {
  conversationId: string;
  createdAt: string;
  description: string | null;
  initialMessages: Message[];
  pins: PinWithMessage[];
  attachments: Attachment[];
  reactions: Reaction[];
  bookmarks: ConversationBookmark[];
  lastReadAt: string | null;
}

type Tab = "messages" | "files" | "pins" | "bookmarks";
const TABS: { id: Tab; label: string; icon: IconName; filled?: boolean }[] = [
  { id: "messages", label: "Messages", icon: "messages", filled: true },
  { id: "files", label: "Files and links", icon: "file" },
  { id: "pins", label: "Pins", icon: "pin" },
  { id: "bookmarks", label: "Bookmarks", icon: "link" },
];

/** "/dnd 30m", "/dnd 2h", "/dnd off" (default one hour) → pause-until timestamp. */
function dndUntilFrom(args: string): string | null {
  if (/^off$/i.test(args)) return null;
  const m = /^(\d+)\s*(m|h)$/i.exec(args);
  const ms = m ? Number(m[1]) * (m[2].toLowerCase() === "h" ? 3_600_000 : 60_000) : 3_600_000;
  return new Date(Date.now() + ms).toISOString();
}

/** Consecutive messages from one sender inside this window collapse into a group (Slack style). */
const GROUP_WINDOW_MS = 5 * 60_000;

function sortByCreated(list: LocalMessage[]) {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function clientIdOf(m: Message): string | undefined {
  return (m.meta as { client_id?: string } | null)?.client_id;
}

function sameReaction(a: Reaction, b: Pick<Reaction, "message_id" | "user_id" | "emoji">) {
  return a.message_id === b.message_id && a.user_id === b.user_id && a.emoji === b.emoji;
}

export function ConversationView({
  conversationId,
  createdAt,
  description,
  initialMessages,
  pins: initialPins,
  attachments: initialAttachments,
  reactions: initialReactions,
  bookmarks: initialBookmarks,
  lastReadAt,
}: ConversationViewProps) {
  const store = useStore();
  const {
    me,
    profiles,
    nav,
    isTeam,
    callsEnabled,
    conversationById,
    conversationName,
    otherMember,
    presenceOf,
    openProfile,
    markRead,
    toggleStar,
    toggleMute,
    setNotifyLevel,
    markThreadRead,
    leaveConversation,
    setArchived,
    savedByMessage,
    saveMessage,
    unsaveMessage,
    updateMe,
    openDm,
  } = store;
  const router = useRouter();
  const conversation = conversationById(conversationId);
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("m");
  const deepLinkThread = searchParams.get("thread");

  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  const [pins, setPins] = useState<PinWithMessage[]>(initialPins);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [bookmarks, setBookmarks] = useState<ConversationBookmark[]>(initialBookmarks);
  // null = closed; { bookmark: null } = adding; { bookmark } = editing that one.
  const [bookmarkEdit, setBookmarkEdit] = useState<{ bookmark: ConversationBookmark | null } | null>(null);
  const [pending, setPending] = useState<Record<string, PendingAttachment[]>>({});
  const [tab, setTab] = useState<Tab>("messages");
  const [details, setDetails] = useState<DetailTab | null>(null);
  /** The message being filed into a property thread, if any. */
  const [filing, setFiling] = useState<string | null>(null);
  const [initialLastRead] = useState(lastReadAt);
  const [search, setSearch] = useState<{ open: boolean; q: string; index: number }>({ open: false, q: "", index: 0 });
  const [flash, setFlash] = useState<string | null>(null);
  // Thread panel: the open parent id, a copy of the parent (in case it is not in the loaded window) and its replies.
  const [thread, setThread] = useState<string | null>(null);
  const [threadParent, setThreadParent] = useState<LocalMessage | null>(null);
  const [replies, setReplies] = useState<LocalMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const threadRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  // Messages from others that arrived while scrolled up (the "N new messages" pill).
  const [newBelow, setNewBelow] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  // user id -> "typing until" timestamp, per thread (null = main timeline)
  const [typing, setTyping] = useState<Record<string, { until: number; parent_id: string | null }>>({});
  const outgoing = useRef<Record<string, OutgoingFile[]>>({});
  const urls = useSignedUrls(attachments.map((a) => a.storage_path));

  // ---- read state -----------------------------------------------------------
  useEffect(() => {
    void markRead(conversationId);
  }, [conversationId, markRead]);

  // ---- realtime -------------------------------------------------------------
  const mergeRow = (prev: LocalMessage[], row: Message): LocalMessage[] => {
    const clientId = clientIdOf(row);
    const idx = prev.findIndex((m) => m.id === row.id || (clientId && m.id === clientId));
    if (idx === -1) return row.deleted_at ? prev : sortByCreated([...prev, row]);
    if (row.deleted_at) return prev.filter((_, i) => i !== idx);
    const next = [...prev];
    next[idx] = row;
    return next;
  };

  const upsert = useCallback((row: Message) => {
    if (row.parent_id) {
      // Replies live in the thread panel only; the parent's reply_count arrives as its own UPDATE.
      if (row.parent_id === threadRef.current) setReplies((prev) => mergeRow(prev, row));
    } else {
      setMessages((prev) => mergeRow(prev, row));
      setThreadParent((prev) => (prev && prev.id === row.id && !row.deleted_at ? row : prev));
    }
    if (row.deleted_at) setPins((prev) => prev.filter((p) => p.message.id !== row.id));
    else setPins((prev) => prev.map((p) => (p.message.id === row.id ? { ...p, message: row } : p)));
  }, []);

  const latestCreatedAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    latestCreatedAt.current = messages.at(-1)?.created_at;
  }, [messages]);

  const backfill = async () => {
    const since = latestCreatedAt.current;
    const base = supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("created_at", { ascending: true });
    const { data } = await (since ? base.gt("created_at", since) : base);
    data?.forEach(upsert);
    if (data && data.length) await loadExtras(data.map((m) => m.id));
    if (threadRef.current) await loadReplies(threadRef.current, latestReplyAt.current);
  };

  /** Reactions and attachments for a batch of freshly loaded messages. */
  const loadExtras = async (ids: string[]) => {
    if (!ids.length) return;
    const [{ data: rx }, { data: ax }] = await Promise.all([
      supabase.from("reactions").select("*").in("message_id", ids),
      supabase.from("attachments").select("*").in("message_id", ids),
    ]);
    if (rx) setReactions((prev) => [...prev.filter((r) => !rx.some((n) => sameReaction(r, n))), ...rx]);
    if (ax) setAttachments((prev) => [...ax.filter((a) => !prev.some((p) => p.id === a.id)), ...prev]);
  };

  // ---- threads --------------------------------------------------------------
  const latestReplyAt = useRef<string | undefined>(undefined);
  useEffect(() => {
    latestReplyAt.current = replies.filter((r) => !r._status).at(-1)?.created_at;
  }, [replies]);

  const loadReplies = async (parentId: string, since?: string) => {
    const base = supabase
      .from("messages")
      .select("*")
      .eq("parent_id", parentId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(500);
    const { data } = await (since ? base.gt("created_at", since) : base);
    if (threadRef.current !== parentId) return;
    if (data) {
      setReplies((prev) => data.reduce(mergeRow, prev));
      await loadExtras(data.map((m) => m.id));
    }
  };

  const closeThread = () => {
    threadRef.current = null;
    setThread(null);
    setThreadParent(null);
    setReplies([]);
  };

  const openThread = async (parentId: string, focusReplyId?: string) => {
    if (threadRef.current !== parentId) {
      threadRef.current = parentId;
      setThread(parentId);
      setReplies([]);
      setThreadLoading(true);
      const known = messages.find((m) => m.id === parentId);
      setThreadParent(known ?? null);
      if (!known) {
        const { data } = await supabase.from("messages").select("*").eq("id", parentId).maybeSingle();
        if (threadRef.current !== parentId) return;
        if (!data || data.deleted_at) {
          closeThread();
          return;
        }
        setThreadParent(data);
        void loadExtras([data.id]);
      }
      await loadReplies(parentId);
      if (threadRef.current !== parentId) return;
      setThreadLoading(false);
    }
    void markThreadRead(parentId);
    if (focusReplyId) requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(focusReplyId)));
  };

  // Belt and braces: the personal topic tells us a message exists; if the conversation
  // channel has not delivered it yet, fetch it.
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIds.current = new Set([...messages, ...replies].map((m) => m.id));
  }, [messages, replies]);
  useEffect(() => {
    const onMessage = (e: Event) => {
      const evt = (e as CustomEvent<IncomingMessageEvent>).detail;
      if (evt.conversation_id !== conversationId || knownIds.current.has(evt.message_id)) return;
      if (evt.parent_id) {
        if (evt.parent_id !== threadRef.current) return;
        void loadReplies(evt.parent_id, latestReplyAt.current);
        if (evt.sender_id !== me.id && document.visibilityState === "visible") void markThreadRead(evt.parent_id);
        return;
      }
      void backfill();
      if (evt.sender_id !== me.id && document.visibilityState === "visible") void markRead(conversationId);
    };
    window.addEventListener(MESSAGE_EVENT, onMessage);
    return () => window.removeEventListener(MESSAGE_EVENT, onMessage);
  });

  const onReactionChange = useCallback((c: Change<Reaction>) => {
    if (c.operation === "INSERT" && c.record) {
      const rec = c.record;
      setReactions((prev) => (prev.some((r) => sameReaction(r, rec)) ? prev : [...prev, rec]));
    } else if (c.operation === "DELETE" && c.old_record) {
      const old = c.old_record;
      setReactions((prev) => prev.filter((r) => !sameReaction(r, old)));
    }
  }, []);

  const onPinChange = useCallback(
    async (c: Change<Pin>) => {
      if (c.operation === "DELETE" && c.old_record) {
        const old = c.old_record;
        setPins((prev) => prev.filter((p) => p.message.id !== old.message_id));
      } else if (c.operation === "INSERT" && c.record) {
        const rec = c.record;
        let message = [...messages, ...replies].find((m) => m.id === rec.message_id) as Message | undefined;
        if (!message) {
          const { data } = await supabase.from("messages").select("*").eq("id", rec.message_id).maybeSingle();
          message = data ?? undefined;
        }
        if (!message) return;
        const m = message;
        setPins((prev) =>
          prev.some((p) => p.message.id === rec.message_id)
            ? prev
            : [{ pinned_at: rec.pinned_at, pinned_by: rec.pinned_by, message: m }, ...prev],
        );
      }
    },
    [messages, replies, supabase],
  );

  const onAttachmentChange = useCallback((c: Change<Attachment>) => {
    if (c.operation === "INSERT" && c.record) {
      const rec = c.record;
      setAttachments((prev) => (prev.some((a) => a.id === rec.id) ? prev : [rec, ...prev]));
    } else if (c.operation === "DELETE" && c.old_record) {
      const old = c.old_record;
      setAttachments((prev) => prev.filter((a) => a.id !== old.id));
    }
  }, []);

  const onTypingEvent = useCallback(
    (evt: TypingEvent) => {
      if (evt.user_id === me.id) return;
      setTyping((prev) => ({ ...prev, [evt.user_id]: { until: Date.now() + 4000, parent_id: evt.parent_id } }));
      window.setTimeout(() => {
        setTyping((prev) => {
          const cur = prev[evt.user_id];
          if (!cur || cur.until > Date.now()) return prev;
          const next = { ...prev };
          delete next[evt.user_id];
          return next;
        });
      }, 4100);
    },
    [me.id],
  );

  // ---- bookmarks ------------------------------------------------------------
  const sortBookmarks = (list: ConversationBookmark[]) =>
    [...list].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));

  const onBookmarkChange = useCallback((c: Change<ConversationBookmark>) => {
    setBookmarks((prev) => {
      if (c.operation === "DELETE") {
        const gone = c.old_record?.id;
        return gone ? prev.filter((b) => b.id !== gone) : prev;
      }
      const row = c.record;
      if (!row) return prev;
      const without = prev.filter((b) => b.id !== row.id);
      return sortBookmarks([...without, row]);
    });
  }, []);

  const saveBookmark = async (draft: BookmarkDraft) => {
    const editing = bookmarkEdit?.bookmark;
    if (editing) {
      // The row comes back over the BOOKMARK broadcast; patch locally so it feels immediate.
      const { data } = await supabase
        .from("conversation_bookmarks")
        .update({ title: draft.title, url: draft.url, emoji: draft.emoji, note: draft.note })
        .eq("id", editing.id)
        .select()
        .single();
      if (data) onBookmarkChange({ operation: "UPDATE", record: data, old_record: editing });
    } else {
      const { data, error } = await supabase.rpc("add_bookmark", {
        p_conversation_id: conversationId,
        p_title: draft.title,
        p_url: draft.url,
        p_emoji: draft.emoji,
        p_note: draft.note,
      });
      if (error) {
        setFlash(error.message);
        return;
      }
      if (data) onBookmarkChange({ operation: "INSERT", record: data, old_record: null });
    }
    setBookmarkEdit(null);
  };

  const removeBookmark = async (b: ConversationBookmark) => {
    setBookmarks((prev) => prev.filter((x) => x.id !== b.id));
    const { error } = await supabase.from("conversation_bookmarks").delete().eq("id", b.id);
    if (error) {
      setBookmarks((prev) => sortBookmarks([...prev, b]));
      setFlash(error.message);
    }
  };

  const moveBookmark = async (b: ConversationBookmark, delta: number) => {
    const { error } = await supabase.rpc("move_bookmark", { p_id: b.id, p_delta: delta });
    if (error) setFlash(error.message);
    // Both swapped rows arrive over the broadcast; no optimistic reorder needed.
  };

  const { sendTyping } = useConversationChannel({
    conversationId,
    // Internal notes ride their own topic (0029); only the team is authorised to hear it.
    internal: me.account_type === "team",
    onTyping: onTypingEvent,
    onInsert: (row) => {
      upsert(row);
      const typer = row.sender_id;
      if (typer)
        setTyping((prev) => {
          if (!prev[typer]) return prev;
          const next = { ...prev };
          delete next[typer];
          return next;
        });
      if (row.sender_id !== me.id && !row.parent_id && !stickToBottom.current) setNewBelow((n) => n + 1);
      if (row.sender_id === me.id || document.visibilityState !== "visible") return;
      if (!row.parent_id) void markRead(conversationId);
      else if (row.parent_id === threadRef.current) void markThreadRead(row.parent_id);
    },
    onUpdate: upsert,
    onReaction: onReactionChange,
    onPin: (c) => void onPinChange(c),
    onBookmark: onBookmarkChange,
    onAttachment: onAttachmentChange,
    onResubscribe: () => void backfill(),
  });

  // ---- scrolling ------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, tab, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stickToBottom.current && newBelow) setNewBelow(0);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    stickToBottom.current = true;
    setNewBelow(0);
  };

  const toggleSave = (m: LocalMessage) => {
    if (m._status) return;
    if (savedByMessage.has(m.id)) void unsaveMessage(m.id);
    else void saveMessage(m);
  };

  const jumpTo = useCallback((messageId: string) => {
    stickToBottom.current = false;
    const el = document.getElementById(`m-${messageId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(messageId);
    window.setTimeout(() => setFlash((f) => (f === messageId ? null : f)), 2500);
  }, []);

  // Deep links from search results, activity and the Threads view:
  //   ?m=<id>            jump to a message (a reply opens its thread and highlights it)
  //   ?thread=<parent>   open a thread
  const handledDeepLink = useRef<string | null>(null);
  const deepLinkKey = deepLinkId || deepLinkThread ? `${deepLinkId ?? ""}|${deepLinkThread ?? ""}` : null;
  useEffect(() => {
    if (!deepLinkKey || handledDeepLink.current === deepLinkKey) return;
    handledDeepLink.current = deepLinkKey;
    let cancelled = false;
    const run = async () => {
      if (!deepLinkId) {
        if (deepLinkThread) void openThread(deepLinkThread);
        return;
      }
      let target: Message | undefined = [...messages, ...replies].find((m) => m.id === deepLinkId);
      if (!target) {
        const { data } = await supabase.from("messages").select("*").eq("id", deepLinkId).maybeSingle();
        if (!data || cancelled) return;
        target = data;
      }
      if (target.parent_id) {
        setTab("messages");
        void openThread(target.parent_id, deepLinkId);
        return;
      }
      if (!knownIds.current.has(deepLinkId)) {
        const [{ data: before }, { data: after }] = await Promise.all([
          supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .is("deleted_at", null)
            .is("parent_id", null)
            .lte("created_at", target.created_at)
            .order("created_at", { ascending: false })
            .limit(60),
          supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .is("deleted_at", null)
            .is("parent_id", null)
            .gt("created_at", target.created_at)
            .order("created_at", { ascending: true })
            .limit(60),
        ]);
        if (cancelled) return;
        const rows = [...(before ?? []), ...(after ?? [])];
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          return sortByCreated([...prev, ...rows.filter((r) => !ids.has(r.id))]);
        });
        await loadExtras(rows.map((r) => r.id));
      }
      setTab("messages");
      if (deepLinkThread) void openThread(deepLinkThread);
      // Wait a frame for the rows to render before scrolling.
      requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(deepLinkId)));
    };
    void run();
    return () => {
      cancelled = true;
    };
    // openThread/loadExtras are recreated each render; the handled-key ref makes this run once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkKey, deepLinkId, deepLinkThread, conversationId, supabase, jumpTo]);

  // ---- in-conversation search ----------------------------------------------
  const hitsFor = (raw: string): string[] => {
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    const fileMatches = new Set(
      attachments.filter((a) => a.file_name.toLowerCase().includes(q)).map((a) => a.message_id),
    );
    return messages
      .filter((m) => m.body.toLowerCase().includes(q) || fileMatches.has(m.id))
      .map((m) => m.id)
      .reverse(); // newest first
  };
  const searchQuery = search.open ? search.q.trim() : "";
  const searchHits = hitsFor(searchQuery);
  const currentHit = searchHits[Math.min(search.index, Math.max(0, searchHits.length - 1))] ?? null;

  const setSearchQuery = (q: string) => {
    setSearch({ open: true, q, index: 0 });
    const first = hitsFor(q)[0];
    if (first) jumpTo(first);
  };

  const stepSearch = (delta: number) => {
    if (!searchHits.length) return;
    const index = (search.index + delta + searchHits.length) % searchHits.length;
    setSearch((s) => ({ ...s, index }));
    jumpTo(searchHits[index]);
  };

  const closeSearch = () => {
    setSearch({ open: false, q: "", index: 0 });
    setFlash(null);
  };

  // ---- actions --------------------------------------------------------------
  const memberProfiles = (conversation?.member_ids ?? []).map((id) => profiles[id]).filter(Boolean);

  // ---- calling --------------------------------------------------------------
  const [call, setCall] = useState<CallTarget | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const callable = callableProfiles(memberProfiles, me.id, callsEnabled, isTeam);

  const beginCall = async (person: (typeof memberProfiles)[number]) => {
    setCallError(null);
    // The row first, so that by the time any audio exists there is already something for the
    // status callbacks and the summary to attach themselves to.
    const result = await startCall(conversationId, person.id, openParent?.id ?? null);
    if (!result.ok || !result.call) {
      setCallError(result.error ?? "That call could not be started.");
      return;
    }
    setCall({
      userId: person.id,
      name: person.display_name,
      phone: person.phone ?? "",
      callId: result.call.id,
    });
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    const key = { message_id: messageId, user_id: me.id, emoji };
    const existing = reactions.find((r) => sameReaction(r, key));
    if (existing) {
      setReactions((prev) => prev.filter((r) => !sameReaction(r, key)));
      const { error } = await supabase
        .from("reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", me.id)
        .eq("emoji", emoji);
      if (error) setReactions((prev) => [...prev, existing]);
    } else {
      const optimistic: Reaction = { ...key, org_id: me.org_id, created_at: new Date().toISOString() };
      setReactions((prev) => [...prev, optimistic]);
      const { error } = await supabase.from("reactions").insert({ ...key, org_id: me.org_id });
      if (error) setReactions((prev) => prev.filter((r) => !sameReaction(r, key)));
    }
  };

  const togglePin = async (message: Message) => {
    const isPinned = pins.some((p) => p.message.id === message.id);
    if (isPinned) {
      const removed = pins.find((p) => p.message.id === message.id)!;
      setPins((prev) => prev.filter((p) => p.message.id !== message.id));
      const { error } = await supabase
        .from("pins")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("message_id", message.id);
      if (error) setPins((prev) => [removed, ...prev]);
    } else {
      const optimistic: PinWithMessage = { pinned_at: new Date().toISOString(), pinned_by: me.id, message };
      setPins((prev) => [optimistic, ...prev]);
      const { error } = await supabase
        .from("pins")
        .insert({ conversation_id: conversationId, message_id: message.id, org_id: me.org_id, pinned_by: me.id });
      if (error) setPins((prev) => prev.filter((p) => p.message.id !== message.id));
      else
        await supabase.from("audit_log").insert({
          org_id: me.org_id,
          actor_id: me.id,
          action: "message.pinned",
          entity: "message",
          entity_id: message.id,
        });
    }
  };

  /** Apply a patch to a message wherever it is shown (timeline, thread replies, thread parent). */
  const patchMessage = (id: string, patch: (m: LocalMessage) => LocalMessage) => {
    const apply = (list: LocalMessage[]) => list.map((m) => (m.id === id ? patch(m) : m));
    setMessages(apply);
    setReplies(apply);
    setThreadParent((prev) => (prev && prev.id === id ? patch(prev) : prev));
  };

  const editMessage = async (message: LocalMessage, body: string) => {
    const before = message.body;
    patchMessage(message.id, (m) => ({ ...m, body, edited_at: new Date().toISOString() }));
    const { data, error } = await supabase.from("messages").update({ body }).eq("id", message.id).select().single();
    if (error || !data) patchMessage(message.id, (m) => ({ ...m, body: before }));
    else upsert(data);
  };

  const deleteMessage = async (message: LocalMessage) => {
    const snapshot = { messages, replies };
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    setReplies((prev) => prev.filter((m) => m.id !== message.id));
    setPins((prev) => prev.filter((p) => p.message.id !== message.id));
    if (message.id === threadRef.current) closeThread();
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", message.id);
    if (error) {
      setMessages(snapshot.messages);
      setReplies(snapshot.replies);
    } else await supabase.from("pins").delete().eq("message_id", message.id);
  };

  const toPending = (f: OutgoingFile, progress: PendingAttachment["progress"] = "uploading"): PendingAttachment => ({
    id: f.id,
    file_name: f.name,
    mime: f.mime,
    size_bytes: f.blob.size,
    previewUrl: f.previewUrl,
    progress,
    voice: f.voice,
    duration_ms: f.duration_ms,
  });

  const uploadFiles = async (messageId: string, clientId: string, files: OutgoingFile[]) => {
    for (const f of files) {
      const path = storagePath(me.org_id, conversationId, messageId, f.name);
      const dims = f.blob instanceof File ? await imageDimensions(f.blob) : null;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, f.blob, { contentType: f.mime, upsert: false });
      let row: Attachment | null = null;
      if (!upErr) {
        const { data } = await supabase
          .from("attachments")
          .insert({
            org_id: me.org_id,
            conversation_id: conversationId,
            message_id: messageId,
            storage_path: path,
            file_name: f.name,
            mime: f.mime,
            size_bytes: f.blob.size,
            category: categoryFor(f.mime, f.voice),
            meta: toJson({ ...dims, duration_ms: f.duration_ms, voice: f.voice || undefined }),
          })
          .select()
          .single();
        row = data;
      }
      if (row) {
        const saved = row;
        setAttachments((prev) => (prev.some((a) => a.id === saved.id) ? prev : [saved, ...prev]));
        setPending((prev) => ({ ...prev, [clientId]: (prev[clientId] ?? []).filter((p) => p.id !== f.id) }));
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      } else {
        setPending((prev) => ({
          ...prev,
          [clientId]: (prev[clientId] ?? []).map((p) => (p.id === f.id ? { ...p, progress: "failed" } : p)),
        }));
      }
    }
  };

  const send = async (
    body: string,
    visibility: "public" | "internal",
    files: OutgoingFile[] = [],
    existing?: LocalMessage,
    parentId: string | null = existing?.parent_id ?? null,
  ) => {
    const clientId = existing?.id ?? crypto.randomUUID();
    const toSend = existing ? (outgoing.current[clientId] ?? []) : files;
    outgoing.current[clientId] = toSend;
    const mentions = mentionedNames(body)
      .map((n) => memberProfiles.find((p) => p.display_name.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => !!id);
    const meta = { client_id: clientId, mentions, attachment_count: toSend.length };
    const optimistic: LocalMessage = existing
      ? { ...existing, _status: "sending" }
      : {
          id: clientId,
          org_id: me.org_id,
          conversation_id: conversationId,
          sender_id: me.id,
          body,
          body_json: null,
          body_tsv: null,
          kind: "text",
          visibility,
          parent_id: parentId,
          reply_count: 0,
          last_reply_at: null,
          meta,
          sent_via: "app",
          external_ref: null,
          edited_at: null,
          deleted_at: null,
          created_at: new Date().toISOString(),
          _status: "sending",
        };
    const setList = parentId ? setReplies : setMessages;
    if (!parentId) stickToBottom.current = true;
    setList((prev) => (existing ? prev.map((m) => (m.id === existing.id ? optimistic : m)) : [...prev, optimistic]));
    if (toSend.length) setPending((prev) => ({ ...prev, [clientId]: toSend.map((f) => toPending(f)) }));

    const { data, error } = await supabase
      .from("messages")
      .insert({
        org_id: me.org_id,
        conversation_id: conversationId,
        sender_id: me.id,
        body,
        visibility,
        meta,
        parent_id: parentId,
      })
      .select()
      .single();

    if (error || !data) {
      setList((prev) => prev.map((m) => (m.id === clientId ? { ...m, _status: "failed" } : m)));
      return;
    }
    upsert(data);
    if (parentId) {
      // The trigger bumps reply_count on the parent; reflect it now unless its UPDATE already arrived.
      patchMessage(parentId, (m) =>
        m.last_reply_at && new Date(m.last_reply_at).getTime() >= new Date(data.created_at).getTime()
          ? m
          : { ...m, reply_count: m.reply_count + 1, last_reply_at: data.created_at },
      );
      void markThreadRead(parentId);
    }
    delete outgoing.current[clientId];
    if (toSend.length) await uploadFiles(data.id, clientId, toSend);
  };

  const toggleArchive = async () => {
    if (!conversation) return;
    await setArchived(conversationId, !conversation.archived_at);
  };

  // Scheduled messages for this conversation (mine only, by RLS).
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("scheduled_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("sent_message_id", null)
      .is("cancelled_at", null)
      .order("send_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setScheduled(data);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId]);

  const scheduleMessage = async (
    body: string,
    visibility: "public" | "internal",
    sendAt: Date,
    parentId: string | null,
  ) => {
    const { data } = await supabase
      .from("scheduled_messages")
      .insert({
        org_id: me.org_id,
        conversation_id: conversationId,
        sender_id: me.id,
        parent_id: parentId,
        body,
        visibility,
        send_at: sendAt.toISOString(),
      })
      .select()
      .single();
    if (data) setScheduled((prev) => [...prev, data].sort((a, b) => a.send_at.localeCompare(b.send_at)));
  };

  const cancelScheduled = async (id: string) => {
    const snapshot = scheduled;
    setScheduled((prev) => prev.filter((s) => s.id !== id));
    // A row the cron has already claimed cannot be cancelled (0031), and the update simply
    // matches nothing. Saying so beats hiding the chip and leaving someone certain they
    // stopped a message that is on its way out.
    const { data } = await supabase
      .from("scheduled_messages")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (!data?.length) {
      setScheduled(snapshot);
      setFlash("That message is already being sent.");
    }
  };

  const sendScheduledNow = async (s: ScheduledMessage) => {
    await cancelScheduled(s.id);
    await send(s.body, s.visibility, [], undefined, s.parent_id);
  };

  const editLast = () => {
    const last = [...messages].reverse().find((m) => m.sender_id === me.id && m.kind !== "system" && !m._status);
    if (last) {
      setEditingId(last.id);
      requestAnimationFrame(() => document.getElementById(`m-${last.id}`)?.scrollIntoView({ block: "nearest" }));
    }
  };

  const runCommand = (name: string, args: string, visibility: "public" | "internal"): boolean => {
    switch (name) {
      case "shrug":
        void send(`${args} ¯\\_(ツ)_/¯`.trim(), visibility);
        return true;
      case "status":
        void updateMe({ status_text: args || null, status_emoji: null, status_expires_at: null });
        return true;
      case "dnd": {
        const until = dndUntilFrom(args);
        void updateMe({ dnd_until: until });
        return true;
      }
      case "away":
        void updateMe(parseAwayArg(args));
        return true;
      case "mute":
        void toggleMute(conversationId);
        return true;
      case "leave":
        void leaveConversation(conversationId);
        return true;
      case "invite":
        setDetails("members");
        return true;
      case "topic":
        void supabase
          .rpc("set_channel_details", {
            p_conversation_id: conversationId,
            p_topic: args || null,
            p_description: description,
          })
          .then(() => store.refresh());
        return true;
      case "search":
        router.push(args ? `/search?q=${encodeURIComponent(args)}` : "/search");
        return true;
      case "collapse":
        closeThread();
        return true;
      case "dm": {
        const m = /^@?\[?([^\]]+?)\]?(?:\s+([\s\S]*))?$/.exec(args);
        const target = m
          ? Object.values(profiles).find((p) => p.display_name.toLowerCase() === m[1].trim().toLowerCase())
          : undefined;
        if (!target) return false;
        void openDm(target.id).then((id) => id && router.push(`/dms/${id}`));
        return true;
      }
      default:
        return false;
    }
  };

  const onDropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) window.dispatchEvent(new CustomEvent(ATTACH_EVENT, { detail: files }));
  };

  // First unread message (for the red "New" divider), fixed at open time.
  const firstNewId = useMemo(
    () =>
      messages.find((m) => m.sender_id !== me.id && (!initialLastRead || m.created_at > initialLastRead))?.id ?? null,
    [messages, me.id, initialLastRead],
  );

  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) map.set(r.message_id, [...(map.get(r.message_id) ?? []), r]);
    return map;
  }, [reactions]);
  const attachmentsByMessage = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    for (const a of [...attachments].sort((x, y) => x.created_at.localeCompare(y.created_at)))
      map.set(a.message_id, [...(map.get(a.message_id) ?? []), a]);
    return map;
  }, [attachments]);
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.message.id)), [pins]);

  if (!conversation) return <ConversationPending onRefresh={store.refresh} />;

  const title = conversationName(conversation);
  const other = otherMember(conversation);
  const isDm = conversation.type === "dm" || conversation.type === "group_dm";
  const placeholder = isDm
    ? `Message ${other?.id === me.id ? "yourself" : conversation.type === "group_dm" ? title : (other?.display_name ?? "")}`
    : `Message #${conversation.name}`;

  const openParent = thread ? (messages.find((m) => m.id === thread) ?? threadParent) : null;
  const canPostInternal = me.account_type === "team" && !isDm;
  const commands = availableCommands({ isTeam, isDm });
  const typingNames = Object.entries(typing)
    .filter(([, t]) => t.parent_id === null)
    .map(([id]) => profiles[id]?.display_name ?? "Someone");

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          conversation={conversation}
          title={title}
          other={other}
          otherStatus={other ? presenceOf(other.id) : "offline"}
          onOpenProfile={other ? openProfile(other.id) : undefined}
          backHref={`/${nav}`}
          canManage={isTeam}
          onOpenDetails={setDetails}
          onToggleStar={() => void toggleStar(conversationId)}
          onToggleMute={() => void toggleMute(conversationId)}
          onSetNotifyLevel={(level) => void setNotifyLevel(conversationId, level)}
          onLeave={() => void leaveConversation(conversationId)}
          onArchive={() => void toggleArchive()}
          onToggleSearch={() => {
            setTab("messages");
            if (search.open) closeSearch();
            else setSearch({ open: true, q: "", index: 0 });
          }}
          searchOpen={search.open}
          callable={callable}
          onCall={(person) => void beginCall(person)}
        />

        <BookmarkBar
          bookmarks={bookmarks}
          canAdd={!conversation.archived_at}
          onAdd={() => setBookmarkEdit({ bookmark: null })}
          onManage={() => setTab("bookmarks")}
        />

        <div
          className="scroll-thin flex h-[46px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line px-2 md:px-3"
          role="tablist"
        >
          {TABS.map((t) => {
            const on = tab === t.id;
            const count =
              t.id === "pins"
                ? pins.length
                : t.id === "files"
                  ? attachments.length
                  : t.id === "bookmarks"
                    ? bookmarks.length
                    : 0;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className="relative flex items-center gap-1.5 border-0 border-b-[3px] bg-transparent px-2.5 text-[15px] whitespace-nowrap md:text-[16px]"
                style={{
                  borderBottomColor: on ? "var(--tab)" : "transparent",
                  color: on ? "var(--text)" : "var(--muted)",
                  fontWeight: on ? 700 : 500,
                }}
              >
                <Icon name={t.icon} size={18} filled={!!t.filled && on} className="hidden md:block" />
                {t.label}
                {count > 0 && <span className="text-[13px] font-medium text-muted">{count}</span>}
              </button>
            );
          })}
        </div>

        {search.open && tab === "messages" && (
          <div
            className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-soft px-3 md:px-5"
            role="search"
          >
            <Icon name="search" size={18} className="text-muted" />
            <input
              autoFocus
              value={search.q}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
                if (e.key === "Enter") stepSearch(e.shiftKey ? -1 : 1);
              }}
              placeholder={`Search in ${isDm ? "this conversation" : `#${conversation.name}`}`}
              aria-label="Search in conversation"
              className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
            />
            <span className="text-[13px] whitespace-nowrap text-muted tabular-nums">
              {searchQuery ? (searchHits.length ? `${search.index + 1} of ${searchHits.length}` : "No matches") : ""}
            </span>
            <button
              type="button"
              onClick={() => stepSearch(-1)}
              disabled={searchHits.length < 2}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
              aria-label="Previous match"
            >
              <Icon name="arrowUp" size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={() => stepSearch(1)}
              disabled={searchHits.length < 2}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover disabled:opacity-40"
              aria-label="Next match"
            >
              <Icon name="arrowDown" size={16} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={closeSearch}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-hover"
              aria-label="Close search"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        {tab === "messages" && (
          <div
            className="flex min-h-0 flex-1 flex-col"
            onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
            onDrop={onDropFiles}
          >
            <div
              ref={scrollRef}
              onScroll={onScroll}
              // Messages hug the bottom via mt-auto on the list below, NOT justify-end here:
              // justify-content on a scroll container collapses scrollHeight to clientHeight, so
              // the element cannot scroll at all and everything above the fold is unreachable.
              className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-3"
            >
              <div className="mt-auto px-3.5 md:px-5">
                {messages.length === 0 && (
                  <p className="py-10 text-center text-[15px] text-muted">
                    This is the very beginning of {isDm ? "your conversation" : `#${conversation.name}`}.
                  </p>
                )}
                {messages.map((m, i) => {
                  const prev = i > 0 ? messages[i - 1] : undefined;
                  const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  const compact =
                    !!prev &&
                    !showDay &&
                    m.id !== firstNewId &&
                    !!m.sender_id &&
                    prev.sender_id === m.sender_id &&
                    m.kind !== "system" &&
                    prev.kind !== "system" &&
                    prev.visibility === m.visibility &&
                    new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
                  const clientId = clientIdOf(m) ?? m.id;
                  const own = attachmentsByMessage.get(m.id) ?? [];
                  const inflight = pending[clientId] ?? [];
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div className="my-2.5 flex items-center md:mt-3.5">
                          <div className="h-px flex-1 bg-line" />
                          <span className="flex items-center gap-1 rounded-2xl border border-line bg-panel px-3 py-1 text-[14px] font-semibold">
                            {dayLabel(m.created_at)}
                            <Icon name="chevronDown" size={12} strokeWidth={2.4} />
                          </span>
                          <div className="h-px flex-1 bg-line" />
                        </div>
                      )}
                      {m.id === firstNewId && (
                        <div className="mt-1 mb-1.5 flex items-center gap-2">
                          <div className="h-px flex-1 bg-new" />
                          <span className="text-[14px] font-semibold text-new">New</span>
                        </div>
                      )}
                      <MessageItem
                        message={m}
                        sender={m.sender_id ? profiles[m.sender_id] : undefined}
                        me={me}
                        profiles={profiles}
                        reactions={reactionsByMessage.get(m.id) ?? []}
                        attachments={[...own, ...inflight]}
                        urls={urls}
                        pinned={pinnedIds.has(m.id)}
                        highlighted={flash === m.id || (search.open && currentHit === m.id)}
                        query={searchQuery || undefined}
                        onRetry={(msg) => void send(msg.body, msg.visibility, [], msg)}
                        onReact={(emoji) => void toggleReaction(m.id, emoji)}
                        onTogglePin={() => void togglePin(m)}
                        onEdit={(body) => void editMessage(m, body)}
                        onDelete={() => void deleteMessage(m)}
                        onOpenThread={m._status ? undefined : () => void openThread(m.id)}
                        onFile={isTeam && !m._status ? () => setFiling(m.id) : undefined}
                        saved={isTeam ? savedByMessage.has(m.id) : undefined}
                        onToggleSave={isTeam ? () => toggleSave(m) : undefined}
                        compact={compact}
                        editing={editingId === m.id}
                        onEditingChange={(v) => setEditingId(v ? m.id : null)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {newBelow > 0 && (
              <div className="pointer-events-none relative h-0">
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="pointer-events-auto absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-white shadow-[0_6px_20px_rgba(0,0,0,.3)]"
                  style={{ background: "var(--brand)" }}
                >
                  {newBelow} new {newBelow === 1 ? "message" : "messages"}{" "}
                  <Icon name="arrowDown" size={14} strokeWidth={2.4} />
                </button>
              </div>
            )}
            {(typingNames.length > 0 || scheduled.length > 0) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-1 text-[13px] text-muted md:px-6">
                {typingNames.length > 0 && (
                  <span className="flex items-center gap-1.5" aria-live="polite">
                    <span className="typing-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    {typingNames.length === 1
                      ? `${typingNames[0]} is typing…`
                      : typingNames.length === 2
                        ? `${typingNames[0]} and ${typingNames[1]} are typing…`
                        : "Several people are typing…"}
                  </span>
                )}
                {scheduled.map((s) => (
                  <span key={s.id} className="flex items-center gap-2">
                    <Icon name="clock" size={13} />
                    Scheduled for {futureTime(s.send_at)}:{" "}
                    <span className="truncate text-ink">{s.body.slice(0, 40)}</span>
                    <button
                      type="button"
                      onClick={() => void sendScheduledNow(s)}
                      className="font-semibold text-link hover:underline"
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelScheduled(s.id)}
                      className="font-semibold hover:underline"
                    >
                      Cancel
                    </button>
                  </span>
                ))}
              </div>
            )}
            {conversation.archived_at ? (
              <div className="mx-3 mb-3 flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-soft px-4 py-3 text-[15px] text-muted md:mx-5 md:mb-[18px]">
                <Icon name="files" size={18} />
                <span className="flex-1">This group is archived. You can read it, but nobody can post here.</span>
                {isTeam && (
                  <button
                    type="button"
                    onClick={() => void toggleArchive()}
                    className="font-semibold text-link hover:underline"
                  >
                    Un-archive
                  </button>
                )}
              </div>
            ) : (
              <>
                {callError && (
                  <div className="border-t border-line bg-panel px-3 py-2 text-[14px] text-new" role="alert">
                    {callError}
                  </div>
                )}
                {/*
                  Keyed on the call id, so starting a second call mounts a fresh bar rather than
                  asking the existing one to change who it is ringing halfway through — which is
                  what makes its mount-only effect safe.
                */}
                {call && <CallBar key={call.callId} target={call} onClose={() => setCall(null)} />}
                <Composer
                  conversationId={conversationId}
                  placeholder={placeholder}
                  canPostInternal={canPostInternal}
                  members={memberProfiles.filter((p) => p.id !== me.id)}
                  onSend={(body, visibility, files) => void send(body, visibility, files)}
                  commands={commands}
                  onCommand={runCommand}
                  onSchedule={(body, visibility, at) => void scheduleMessage(body, visibility, at, null)}
                  onTyping={() => sendTyping({ user_id: me.id, parent_id: null })}
                  onEditLast={editLast}
                />
              </>
            )}
          </div>
        )}

        {tab === "pins" && (
          <PinsTab
            pins={pins}
            profiles={profiles}
            attachments={attachmentsByMessage}
            urls={urls}
            onUnpin={(m) => void togglePin(m)}
            onJump={(id) => {
              setTab("messages");
              requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(id)));
            }}
          />
        )}
        {tab === "bookmarks" && (
          <BookmarksTab
            bookmarks={bookmarks}
            profiles={profiles}
            isTeam={isTeam}
            meId={me.id}
            canAdd={!conversation.archived_at}
            onAdd={() => setBookmarkEdit({ bookmark: null })}
            onEdit={(b) => setBookmarkEdit({ bookmark: b })}
            onRemove={(b) => void removeBookmark(b)}
            onMove={(b, delta) => void moveBookmark(b, delta)}
          />
        )}
        {tab === "files" && (
          <FilesTab
            messages={messages}
            attachments={attachments}
            profiles={profiles}
            urls={urls}
            onJump={(id) => {
              setTab("messages");
              requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(id)));
            }}
          />
        )}

        {bookmarkEdit && (
          <BookmarkDialog
            bookmark={bookmarkEdit.bookmark}
            onSave={saveBookmark}
            onClose={() => setBookmarkEdit(null)}
          />
        )}
        {filing && (
          <FileToPropertyDialog messageId={filing} conversationId={conversation.id} onClose={() => setFiling(null)} />
        )}
        {details && (
          <DetailsModal
            conversation={conversation}
            title={title}
            createdAt={createdAt}
            description={description}
            initialTab={details}
            onClose={() => setDetails(null)}
          />
        )}
      </div>

      {openParent && (
        <ThreadPanel
          conversationId={conversationId}
          conversationLabel={isDm ? title : `#${conversation.name}`}
          parent={openParent}
          replies={replies}
          loading={threadLoading}
          me={me}
          profiles={profiles}
          members={memberProfiles.filter((p) => p.id !== me.id)}
          reactionsByMessage={reactionsByMessage}
          attachmentsByMessage={attachmentsByMessage}
          pending={pending}
          urls={urls}
          pinnedIds={pinnedIds}
          flash={flash}
          canPostInternal={canPostInternal}
          archived={!!conversation.archived_at}
          onClose={closeThread}
          onSend={(body, visibility, files) => void send(body, visibility, files, undefined, openParent.id)}
          onTyping={() => sendTyping({ user_id: me.id, parent_id: openParent.id })}
          onSchedule={(body, visibility, at) => void scheduleMessage(body, visibility, at, openParent.id)}
          onRetry={(msg) => void send(msg.body, msg.visibility, [], msg)}
          onReact={(m, emoji) => void toggleReaction(m.id, emoji)}
          onTogglePin={(m) => void togglePin(m)}
          onEdit={(m, body) => void editMessage(m, body)}
          onDelete={(m) => void deleteMessage(m)}
          savedIds={isTeam ? new Set(savedByMessage.keys()) : undefined}
          onToggleSave={isTeam ? toggleSave : undefined}
        />
      )}
    </div>
  );
}

/**
 * A conversation the server rendered but the client list does not know yet (just created, or a
 * brand-new DM): pull fresh data once, then give up with a 404 if it is still missing.
 */
function ConversationPending({ onRefresh }: { onRefresh: () => void }) {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    onRefresh();
    const id = window.setTimeout(() => setGaveUp(true), 6000);
    return () => window.clearTimeout(id);
  }, [onRefresh]);
  if (gaveUp) notFound();
  return (
    <div className="flex flex-1 items-center justify-center text-[15px] text-muted" aria-busy="true">
      Loading conversation…
    </div>
  );
}
