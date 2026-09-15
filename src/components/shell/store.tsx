"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ActivityItem, ConversationSummary, Json, Profile } from "@/lib/database.types";
import { previewOf } from "@/lib/format";
import { isNav, type Nav } from "@/lib/nav";

export type { Nav } from "@/lib/nav";

export interface Org {
  id: string;
  name: string;
  slug: string;
  settings: Json;
}

/** Payload of the `message_created` event broadcast to `user:<id>` by the database trigger. */
export interface IncomingMessageEvent {
  message_id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string | null;
  kind: string;
  visibility: string;
  preview: string;
  created_at: string;
  parent_id?: string | null;
  mentions?: string[];
}

/** Payload of `conversation_changed` (rename, topic, archive, membership). */
export interface ConversationChangedEvent {
  conversation_id: string;
  event: string;
  user_id?: string;
}

/** Window event fired for every `message_created` realtime event, so open views can back-fill. */
export const MESSAGE_EVENT = "stayful:message";
/** Window event fired for every `conversation_changed` realtime event. */
export const CONVERSATION_EVENT = "stayful:conversation";

/** "people" starts a DM or group DM; "group" creates a named group (team only). */
export type NewMessageMode = "people" | "group";
export type NotifyLevel = "all" | "mentions" | "none";

interface StoreValue {
  me: Profile;
  org: Org;
  isTeam: boolean;
  isAdmin: boolean;
  isCustomer: boolean;
  profiles: Record<string, Profile>;
  conversations: ConversationSummary[];
  activity: ActivityItem[];
  online: ReadonlySet<string>;
  activityRead: ReadonlySet<string>;
  nav: Nav;
  activeConversationId: string | null;
  /** True on full-width pages that are not a conversation (search, settings, invite). */
  isPage: boolean;
  newMessage: NewMessageMode | null;
  openNewMessage: (mode?: NewMessageMode) => void;
  closeNewMessage: () => void;
  conversationById: (id: string) => ConversationSummary | undefined;
  /** Display name for a conversation: channel name, or the other person's name for a DM. */
  conversationName: (c: ConversationSummary) => string;
  otherMember: (c: ConversationSummary) => Profile | undefined;
  isOnline: (userId: string) => boolean;
  markRead: (conversationId: string) => Promise<void>;
  markActivityRead: (messageId: string) => void;
  markAllActivityRead: () => Promise<void>;
  toggleStar: (conversationId: string) => Promise<void>;
  toggleMute: (conversationId: string) => Promise<void>;
  setNotifyLevel: (conversationId: string, level: NotifyLevel) => Promise<void>;
  openDm: (userId: string) => Promise<string | null>;
  refresh: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

interface StoreProviderProps {
  me: Profile;
  org: Org;
  profiles: Profile[];
  conversations: ConversationSummary[];
  activity: ActivityItem[];
  children: ReactNode;
}

export function StoreProvider({
  me,
  org,
  profiles: profileList,
  conversations: initialConversations,
  activity: initialActivity,
  children,
}: StoreProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [conversations, setConversations] = useState(initialConversations);
  const [activity, setActivity] = useState(initialActivity);
  const [online, setOnline] = useState<ReadonlySet<string>>(() => new Set());
  const [activityRead, setActivityRead] = useState<ReadonlySet<string>>(() => new Set());

  // Server data wins whenever the layout re-renders with fresh props (router.refresh()).
  const [seenConversations, setSeenConversations] = useState(initialConversations);
  if (seenConversations !== initialConversations) {
    setSeenConversations(initialConversations);
    setConversations(initialConversations);
  }
  const [seenActivity, setSeenActivity] = useState(initialActivity);
  if (seenActivity !== initialActivity) {
    setSeenActivity(initialActivity);
    setActivity(initialActivity);
  }

  const profiles = useMemo(() => Object.fromEntries(profileList.map((p) => [p.id, p])), [profileList]);
  const isTeam = me.account_type === "team";
  const isAdmin = isTeam && me.role === "admin";
  const isCustomer = !isTeam;

  const segments = pathname.split("/").filter(Boolean);
  const nav: Nav = isNav(segments[0]) ? segments[0] : "dms";
  const isPage = segments.length > 0 && !isNav(segments[0]);
  const activeConversationId = isNav(segments[0]) ? (segments[1] ?? null) : null;
  const [newMessage, setNewMessage] = useState<NewMessageMode | null>(null);
  const openNewMessage = useCallback((mode: NewMessageMode = "people") => setNewMessage(mode), []);
  const closeNewMessage = useCallback(() => setNewMessage(null), []);
  const activeRef = useRef(activeConversationId);
  useEffect(() => {
    activeRef.current = activeConversationId;
  }, [activeConversationId]);

  const conversationById = useCallback((id: string) => conversations.find((c) => c.id === id), [conversations]);

  const otherMember = useCallback(
    (c: ConversationSummary) => {
      const otherId = c.member_ids.find((id) => id !== me.id) ?? me.id;
      return profiles[otherId];
    },
    [profiles, me.id],
  );

  const conversationName = useCallback(
    (c: ConversationSummary) => {
      if (c.type === "dm") {
        const other = otherMember(c);
        if (!other) return "Direct message";
        return other.id === me.id ? `${other.display_name} (you)` : other.display_name;
      }
      if (c.type === "group_dm") {
        return c.member_ids
          .filter((id) => id !== me.id)
          .map((id) => profiles[id]?.display_name ?? "Someone")
          .join(", ");
      }
      return c.name ?? "Conversation";
    },
    [otherMember, profiles, me.id],
  );

  const isOnline = useCallback((userId: string) => online.has(userId), [online]);

  const markRead = useCallback(
    async (conversationId: string) => {
      const now = new Date().toISOString();
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0, mention_count: 0, last_read_at: now } : c)),
      );
      setActivity((prev) =>
        prev.map((a) => (a.conversation_id === conversationId && !a.parent_id ? { ...a, unread: false } : a)),
      );
      await supabase.rpc("mark_read", { cid: conversationId });
    },
    [supabase],
  );

  const markActivityRead = useCallback((messageId: string) => {
    setActivityRead((prev) => new Set(prev).add(messageId));
  }, []);

  const markAllActivityRead = useCallback(async () => {
    setActivity((prev) => prev.map((a) => ({ ...a, unread: false })));
    await supabase.from("profiles").update({ activity_seen_at: new Date().toISOString() }).eq("id", me.id);
  }, [supabase, me.id]);

  const updateMember = useCallback(
    async (conversationId: string, patch: { starred?: boolean; muted?: boolean; notify_level?: NotifyLevel }) => {
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, ...patch } : c)));
      await supabase
        .from("conversation_members")
        .update(patch)
        .eq("conversation_id", conversationId)
        .eq("user_id", me.id);
    },
    [supabase, me.id],
  );

  const toggleStar = useCallback(
    async (id: string) => {
      const c = conversations.find((x) => x.id === id);
      if (c) await updateMember(id, { starred: !c.starred });
    },
    [conversations, updateMember],
  );

  const toggleMute = useCallback(
    async (id: string) => {
      const c = conversations.find((x) => x.id === id);
      if (c) await updateMember(id, { muted: !c.muted });
    },
    [conversations, updateMember],
  );

  const setNotifyLevel = useCallback(
    async (id: string, level: NotifyLevel) => updateMember(id, { notify_level: level }),
    [updateMember],
  );

  const refresh = useCallback(() => router.refresh(), [router]);

  const openDm = useCallback(
    async (userId: string) => {
      const { data, error } = await supabase.rpc("dm_between", { other: userId });
      if (error || !data) return null;
      if (!conversations.some((c) => c.id === data)) refresh();
      return data;
    },
    [supabase, conversations, refresh],
  );

  // ---- Realtime: personal topic (new messages anywhere, conversation changes) --------
  useEffect(() => {
    let cancelled = false;
    const channel = supabase.channel(`user:${me.id}`, { config: { private: true } });

    channel.on("broadcast", { event: "message_created" }, ({ payload }) => {
      const evt = payload as IncomingMessageEvent;
      window.dispatchEvent(new CustomEvent<IncomingMessageEvent>(MESSAGE_EVENT, { detail: evt }));
      const isMine = evt.sender_id === me.id;
      const isActive = activeRef.current === evt.conversation_id;
      const isReply = !!evt.parent_id;
      const mentionsMe =
        (evt.mentions ?? []).includes(me.id) || new RegExp(`@\\[?${me.display_name}\\b`, "i").test(evt.preview);
      let known = false;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === evt.conversation_id);
        if (idx === -1) return prev;
        known = true;
        const c = prev[idx];
        if (isReply) return prev; // thread replies never move or badge the conversation
        const counts =
          c.notify_level === "none" || (c.notify_level === "mentions" && !mentionsMe) ? 0 : isMine || isActive ? 0 : 1;
        const updated: ConversationSummary = {
          ...c,
          last_message_at: evt.created_at,
          last_message_body: evt.preview,
          last_message_sender_id: evt.sender_id,
          last_message_kind: evt.kind as ConversationSummary["last_message_kind"],
          unread_count: c.unread_count + counts,
          mention_count: c.mention_count + (mentionsMe && !isMine && !isActive ? 1 : 0),
          last_read_at: isMine || isActive ? evt.created_at : c.last_read_at,
        };
        const next = [...prev];
        next.splice(idx, 1);
        return [updated, ...next];
      });
      if (!isMine) {
        const kind =
          evt.kind === "system" && /has been added|accepted your invitation/i.test(evt.preview)
            ? "New member"
            : mentionsMe
              ? "Mention"
              : isReply
                ? "Reply"
                : "Message";
        setActivity((prev) =>
          prev.some((a) => a.message_id === evt.message_id)
            ? prev
            : [
                {
                  message_id: evt.message_id,
                  conversation_id: evt.conversation_id,
                  sender_id: evt.sender_id,
                  kind,
                  body: evt.preview,
                  created_at: evt.created_at,
                  unread: !isActive,
                  parent_id: evt.parent_id ?? null,
                  emoji: null,
                },
                ...prev,
              ].slice(0, 80),
        );
      }
      // A conversation we have never seen (e.g. a new DM): pull fresh server data.
      queueMicrotask(() => {
        if (!known && !cancelled) refresh();
      });
    });

    channel.on("broadcast", { event: "conversation_changed" }, ({ payload }) => {
      const evt = payload as ConversationChangedEvent;
      window.dispatchEvent(new CustomEvent<ConversationChangedEvent>(CONVERSATION_EVENT, { detail: evt }));
      if (evt.event === "removed" && evt.user_id === me.id && activeRef.current === evt.conversation_id) {
        router.push("/home");
      }
      refresh();
    });

    supabase.realtime.setAuth().then(() => {
      if (!cancelled) channel.subscribe();
    });
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, me.id, me.display_name, refresh, router]);

  // ---- Realtime: org presence ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const channel = supabase.channel(`org:${org.id}`, { config: { private: true, presence: { key: me.id } } });
    channel.on("presence", { event: "sync" }, () => {
      setOnline(new Set(Object.keys(channel.presenceState())));
    });
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ user_id: me.id, at: Date.now() });
      });
    });
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, org.id, me.id]);

  const value = useMemo<StoreValue>(
    () => ({
      me,
      org,
      isTeam,
      isAdmin,
      isCustomer,
      profiles,
      conversations,
      activity,
      online,
      activityRead,
      nav,
      activeConversationId,
      isPage,
      newMessage,
      openNewMessage,
      closeNewMessage,
      conversationById,
      conversationName,
      otherMember,
      isOnline,
      markRead,
      markActivityRead,
      markAllActivityRead,
      toggleStar,
      toggleMute,
      setNotifyLevel,
      openDm,
      refresh,
    }),
    [
      me,
      org,
      isTeam,
      isAdmin,
      isCustomer,
      profiles,
      conversations,
      activity,
      online,
      activityRead,
      nav,
      activeConversationId,
      isPage,
      newMessage,
      openNewMessage,
      closeNewMessage,
      conversationById,
      conversationName,
      otherMember,
      isOnline,
      markRead,
      markActivityRead,
      markAllActivityRead,
      toggleStar,
      toggleMute,
      setNotifyLevel,
      openDm,
      refresh,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

/** Preview line for a list row, e.g. "You: on my way". */
export function lastMessagePreview(c: ConversationSummary, meId: string): string {
  const text = previewOf(c.last_message_body);
  if (!text) return "";
  return c.last_message_sender_id === meId && c.last_message_kind !== "system" ? `You: ${text}` : text;
}

/** Conversations that should appear in sidebars (archived ones are hidden unless asked for). */
export function liveConversations(list: ConversationSummary[], includeArchived = false): ConversationSummary[] {
  return includeArchived ? list : list.filter((c) => !c.archived_at);
}
