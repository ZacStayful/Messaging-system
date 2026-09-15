"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import type { Attachment, Message } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_EVENT, useStore, type IncomingMessageEvent } from "@/components/shell/store";
import { Icon, type IconName } from "@/components/ui/Icon";
import { dayKey, dayLabel } from "@/lib/format";
import { mentionedNames } from "@/lib/richtext";
import { useConversationChannel } from "@/lib/realtime/useConversationChannel";
import { Header } from "./Header";
import { Composer } from "./Composer";
import { MessageItem, type LocalMessage } from "./MessageItem";
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

export function ConversationView({
  conversationId,
  createdAt,
  description,
  initialMessages,
  pins,
  attachments,
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

  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [tab, setTab] = useState<Tab>("messages");
  const [details, setDetails] = useState<DetailTab | null>(null);
  const [initialLastRead] = useState(lastReadAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // ---- read state -----------------------------------------------------------
  useEffect(() => {
    void markRead(conversationId);
  }, [conversationId, markRead]);

  // ---- realtime -------------------------------------------------------------
  const upsert = useCallback((row: Message) => {
    setMessages((prev) => {
      const clientId = (row.meta as { client_id?: string } | null)?.client_id;
      const idx = prev.findIndex((m) => m.id === row.id || (clientId && m.id === clientId));
      if (idx === -1) return row.deleted_at ? prev : sortByCreated([...prev, row]);
      if (row.deleted_at) return prev.filter((_, i) => i !== idx);
      const next = [...prev];
      next[idx] = row;
      return next;
    });
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

  useConversationChannel({
    conversationId,
    onInsert: (row) => {
      upsert(row);
      if (row.sender_id !== me.id && document.visibilityState === "visible") void markRead(conversationId);
    },
    onUpdate: upsert,
    onResubscribe: () => void backfill(),
  });

  // ---- scrolling ------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, tab]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // ---- sending --------------------------------------------------------------
  const memberProfiles = (conversation?.member_ids ?? []).map((id) => profiles[id]).filter(Boolean);

  const send = async (body: string, visibility: "public" | "internal", existing?: LocalMessage) => {
    const clientId = existing?.id ?? crypto.randomUUID();
    const mentions = mentionedNames(body)
      .map((n) => memberProfiles.find((p) => p.display_name.toLowerCase() === n.toLowerCase())?.id)
      .filter((id): id is string => !!id);
    const meta = { client_id: clientId, mentions };
    const optimistic: LocalMessage = existing
      ? { ...existing, _status: "sending" }
      : {
          id: clientId,
          org_id: me.org_id,
          conversation_id: conversationId,
          sender_id: me.id,
          body,
          body_json: null,
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
  };

  if (!conversation) notFound();

  const title = conversationName(conversation);
  const other = otherMember(conversation);
  const isDm = conversation.type === "dm" || conversation.type === "group_dm";
  const placeholder = isDm
    ? `Message ${other?.id === me.id ? "yourself" : (other?.display_name ?? "")}`
    : `Message #${conversation.name}`;

  // First unread message (for the red "New" divider), fixed at open time.
  const firstNewId = useMemo(
    () =>
      messages.find((m) => m.sender_id !== me.id && (!initialLastRead || m.created_at > initialLastRead))?.id ?? null,
    [messages, me.id, initialLastRead],
  );

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
      />

      <div
        className="scroll-thin flex h-[46px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line px-2 md:px-3"
        role="tablist"
      >
        {TABS.map((t) => {
          const on = tab === t.id;
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
              {t.id === "add" && <span className="absolute top-2.5 right-0.5 h-2 w-2 rounded-full bg-[#2E6FD6]" />}
            </button>
          );
        })}
      </div>

      {tab === "messages" && (
        <div className="flex min-h-0 flex-1 flex-col">
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
                      onRetry={(msg) => void send(msg.body, msg.visibility, msg)}
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
            onSend={(body, visibility) => void send(body, visibility)}
          />
        </div>
      )}

      {tab === "pins" && <PinsTab pins={pins} profiles={profiles} />}
      {tab === "files" && <FilesTab messages={messages} attachments={attachments} profiles={profiles} />}

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
