"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { notFound, useSearchParams } from "next/navigation";
import type { Attachment, Message, Pin, Reaction } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_EVENT, useStore, type IncomingMessageEvent } from "@/components/shell/store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { dayKey, dayLabel } from "@/lib/format";
import { mentionedNames } from "@/lib/richtext";
import { useConversationChannel, type Change } from "@/lib/realtime/useConversationChannel";
import { BUCKET, categoryFor, imageDimensions, storagePath, toJson } from "@/lib/storage/attachments";
import { useSignedUrls } from "@/lib/storage/useSignedUrls";
import { Header } from "./Header";
import { ATTACH_EVENT, Composer, type OutgoingFile } from "./Composer";
import { MessageItem, type LocalMessage } from "./MessageItem";
import type { PendingAttachment } from "./AttachmentView";
import { PinsTab } from "./PinsTab";
import { FilesTab } from "./FilesTab";
import { DetailsModal, type DetailTab } from "./DetailsModal";

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
  lastReadAt: string | null;
}

type Tab = "messages" | "canvas" | "files" | "pins" | "add";
const TABS: { id: Tab; label: string; icon: IconName; filled?: boolean; enabled: boolean }[] = [
  { id: "messages", label: "Messages", icon: "messages", filled: true, enabled: true },
  { id: "canvas", label: "Add canvas", icon: "canvas", enabled: false },
  { id: "files", label: "Files and links", icon: "file", enabled: true },
  { id: "pins", label: "Pins", icon: "pin", enabled: true },
  { id: "add", label: "", icon: "plus", enabled: false },
];

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
  lastReadAt,
}: ConversationViewProps) {
  const store = useStore();
  const {
    me,
    profiles,
    nav,
    conversationById,
    conversationName,
    otherMember,
    isOnline,
    markRead,
    toggleStar,
    toggleMute,
  } = store;
  const conversation = conversationById(conversationId);
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("m");

  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  const [pins, setPins] = useState<PinWithMessage[]>(initialPins);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [pending, setPending] = useState<Record<string, PendingAttachment[]>>({});
  const [tab, setTab] = useState<Tab>("messages");
  const [details, setDetails] = useState<DetailTab | null>(null);
  const [initialLastRead] = useState(lastReadAt);
  const [search, setSearch] = useState<{ open: boolean; q: string; index: number }>({ open: false, q: "", index: 0 });
  const [flash, setFlash] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const outgoing = useRef<Record<string, OutgoingFile[]>>({});
  const urls = useSignedUrls(attachments.map((a) => a.storage_path));

  // ---- read state -----------------------------------------------------------
  useEffect(() => {
    void markRead(conversationId);
  }, [conversationId, markRead]);

  // ---- realtime -------------------------------------------------------------
  const upsert = useCallback((row: Message) => {
    setMessages((prev) => {
      const clientId = clientIdOf(row);
      const idx = prev.findIndex((m) => m.id === row.id || (clientId && m.id === clientId));
      if (idx === -1) return row.deleted_at ? prev : sortByCreated([...prev, row]);
      if (row.deleted_at) return prev.filter((_, i) => i !== idx);
      const next = [...prev];
      next[idx] = row;
      return next;
    });
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
      .order("created_at", { ascending: true });
    const { data } = await (since ? base.gt("created_at", since) : base);
    data?.forEach(upsert);
    if (data && data.length) {
      const ids = data.map((m) => m.id);
      const [{ data: rx }, { data: ax }] = await Promise.all([
        supabase.from("reactions").select("*").in("message_id", ids),
        supabase.from("attachments").select("*").in("message_id", ids),
      ]);
      if (rx) setReactions((prev) => [...prev.filter((r) => !rx.some((n) => sameReaction(r, n))), ...rx]);
      if (ax) setAttachments((prev) => [...ax.filter((a) => !prev.some((p) => p.id === a.id)), ...prev]);
    }
  };

  // Belt and braces: the personal topic tells us a message exists; if the conversation
  // channel has not delivered it yet, fetch it.
  const knownIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIds.current = new Set(messages.map((m) => m.id));
  }, [messages]);
  useEffect(() => {
    const onMessage = (e: Event) => {
      const evt = (e as CustomEvent<IncomingMessageEvent>).detail;
      if (evt.conversation_id !== conversationId || knownIds.current.has(evt.message_id)) return;
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
        let message = messages.find((m) => m.id === rec.message_id) as Message | undefined;
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
    [messages, supabase],
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

  useConversationChannel({
    conversationId,
    onInsert: (row) => {
      upsert(row);
      if (row.sender_id !== me.id && document.visibilityState === "visible") void markRead(conversationId);
    },
    onUpdate: upsert,
    onReaction: onReactionChange,
    onPin: (c) => void onPinChange(c),
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
  };

  const jumpTo = useCallback((messageId: string) => {
    stickToBottom.current = false;
    const el = document.getElementById(`m-${messageId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(messageId);
    window.setTimeout(() => setFlash((f) => (f === messageId ? null : f)), 2500);
  }, []);

  // Deep link (?m=<id>) from search results and activity: load older history if needed, then jump.
  const handledDeepLink = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || handledDeepLink.current === deepLinkId) return;
    handledDeepLink.current = deepLinkId;
    let cancelled = false;
    const run = async () => {
      if (!knownIds.current.has(deepLinkId)) {
        const { data: target } = await supabase.from("messages").select("*").eq("id", deepLinkId).maybeSingle();
        if (!target || cancelled) return;
        const [{ data: before }, { data: after }] = await Promise.all([
          supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .is("deleted_at", null)
            .lte("created_at", target.created_at)
            .order("created_at", { ascending: false })
            .limit(60),
          supabase
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .is("deleted_at", null)
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
        const ids = rows.map((r) => r.id);
        if (ids.length) {
          const [{ data: rx }, { data: ax }] = await Promise.all([
            supabase.from("reactions").select("*").in("message_id", ids),
            supabase.from("attachments").select("*").in("message_id", ids),
          ]);
          if (rx) setReactions((prev) => [...prev.filter((r) => !rx.some((n) => sameReaction(r, n))), ...rx]);
          if (ax) setAttachments((prev) => [...ax.filter((a) => !prev.some((p) => p.id === a.id)), ...prev]);
        }
      }
      setTab("messages");
      // Wait a frame for the rows to render before scrolling.
      requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(deepLinkId)));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [deepLinkId, conversationId, supabase, jumpTo]);

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

  const editMessage = async (message: LocalMessage, body: string) => {
    const before = message.body;
    setMessages((prev) =>
      prev.map((m) => (m.id === message.id ? { ...m, body, edited_at: new Date().toISOString() } : m)),
    );
    const { data, error } = await supabase.from("messages").update({ body }).eq("id", message.id).select().single();
    if (error || !data) setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, body: before } : m)));
    else upsert(data);
  };

  const deleteMessage = async (message: LocalMessage) => {
    const snapshot = messages;
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    setPins((prev) => prev.filter((p) => p.message.id !== message.id));
    const { error } = await supabase
      .from("messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", message.id);
    if (error) setMessages(snapshot);
    else await supabase.from("pins").delete().eq("message_id", message.id);
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
          parent_id: null,
          meta,
          sent_via: "app",
          external_ref: null,
          edited_at: null,
          deleted_at: null,
          created_at: new Date().toISOString(),
          _status: "sending",
        };
    stickToBottom.current = true;
    setMessages((prev) =>
      existing ? prev.map((m) => (m.id === existing.id ? optimistic : m)) : [...prev, optimistic],
    );
    if (toSend.length) setPending((prev) => ({ ...prev, [clientId]: toSend.map((f) => toPending(f)) }));

    const { data, error } = await supabase
      .from("messages")
      .insert({ org_id: me.org_id, conversation_id: conversationId, sender_id: me.id, body, visibility, meta })
      .select()
      .single();

    if (error || !data) {
      setMessages((prev) => prev.map((m) => (m.id === clientId ? { ...m, _status: "failed" } : m)));
      return;
    }
    upsert(data);
    delete outgoing.current[clientId];
    if (toSend.length) await uploadFiles(data.id, clientId, toSend);
  };

  const onDropFiles = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) window.dispatchEvent(new CustomEvent(ATTACH_EVENT, { detail: files }));
  };

  if (!conversation) notFound();

  const title = conversationName(conversation);
  const other = otherMember(conversation);
  const isDm = conversation.type === "dm" || conversation.type === "group_dm";
  const placeholder = isDm
    ? `Message ${other?.id === me.id ? "yourself" : conversation.type === "group_dm" ? title : (other?.display_name ?? "")}`
    : `Message #${conversation.name}`;

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

  return (
    <>
      <Header
        conversation={conversation}
        title={title}
        other={other}
        otherOnline={!!other && isOnline(other.id)}
        backHref={`/${nav}`}
        onOpenDetails={setDetails}
        onToggleStar={() => void toggleStar(conversationId)}
        onToggleMute={() => void toggleMute(conversationId)}
        onToggleSearch={() => {
          setTab("messages");
          if (search.open) closeSearch();
          else setSearch({ open: true, q: "", index: 0 });
        }}
        searchOpen={search.open}
      />

      <div
        className="scroll-thin flex h-[46px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line px-2 md:px-3"
        role="tablist"
      >
        {TABS.map((t) => {
          const on = tab === t.id;
          const count = t.id === "pins" ? pins.length : t.id === "files" ? attachments.length : 0;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              disabled={!t.enabled}
              onClick={() => t.enabled && setTab(t.id)}
              title={t.enabled ? undefined : "Coming in a later release"}
              className={`relative items-center gap-1.5 border-0 border-b-[3px] bg-transparent px-2.5 text-[15px] whitespace-nowrap disabled:cursor-default md:text-[16px] ${t.enabled ? "flex" : "hidden md:flex"}`}
              style={{
                borderBottomColor: on ? "var(--tab)" : "transparent",
                color: on ? "var(--text)" : "var(--muted)",
                fontWeight: on ? 700 : 500,
              }}
            >
              <Icon name={t.icon} size={18} filled={!!t.filled && on} className="hidden md:block" />
              {t.label}
              {count > 0 && <span className="text-[13px] font-medium text-muted">{count}</span>}
              {t.id === "add" && <span className="absolute top-2.5 right-0.5 h-2 w-2 rounded-full bg-[#2E6FD6]" />}
            </button>
          );
        })}
      </div>

      {search.open && tab === "messages" && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-soft px-3 md:px-5" role="search">
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
            className="scroll-thin flex min-h-0 flex-1 flex-col justify-end overflow-y-auto pt-2 pb-3"
          >
            <div className="px-3.5 md:px-5">
              {messages.length === 0 && (
                <p className="py-10 text-center text-[15px] text-muted">
                  This is the very beginning of {isDm ? "your conversation" : `#${conversation.name}`}.
                </p>
              )}
              {messages.map((m, i) => {
                const showDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at);
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
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <Composer
            conversationId={conversationId}
            placeholder={placeholder}
            canPostInternal={me.account_type === "team" && !isDm}
            members={memberProfiles.filter((p) => p.id !== me.id)}
            onSend={(body, visibility, files) => void send(body, visibility, files)}
          />
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
    </>
  );
}
