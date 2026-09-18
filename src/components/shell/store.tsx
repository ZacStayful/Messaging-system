"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  ActivityItem,
  ConversationSummary,
  Json,
  Message,
  Profile,
  SavedItem,
  SidebarSection,
  SidebarSectionItem,
  ThreadSummary,
} from "@/lib/database.types";
import { previewOf } from "@/lib/format";
import { previewMentions } from "@/lib/richtext";
import { isNav, type Nav } from "@/lib/nav";
import { AWAY_AFTER_MS, manualAway, type PresenceStatus } from "@/lib/presence";

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
/** Payload of `profile_changed` on the org topic (name, photo, status, DND). */
export type ProfileChangedEvent = Pick<
  Profile,
  | "id"
  | "display_name"
  | "full_name"
  | "avatar_url"
  | "avatar_color"
  | "status_text"
  | "status_emoji"
  | "status_expires_at"
  | "dnd_until"
  | "timezone"
  | "presence"
  | "presence_mode"
  | "away_since"
  | "away_until"
  | "deactivated_at"
>;

/** A saved-for-later row with the message it points at (null if since deleted or hidden). */
export type SavedRow = SavedItem & { message: Message | null };

export interface ProfileCardState {
  id: string;
  x: number;
  y: number;
}

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
  /**
   * Whether calling is switched on for this deployment.
   *
   * Decided server-side by callsConfigured(), because the answer is six secrets none of which
   * may reach the browser, and carried here rather than through a NEXT_PUBLIC_ flag so there is
   * one definition of "configured" rather than an env var that can disagree with it.
   */
  callsEnabled: boolean;
  isTeam: boolean;
  isAdmin: boolean;
  isCustomer: boolean;
  profiles: Record<string, Profile>;
  conversations: ConversationSummary[];
  activity: ActivityItem[];
  /** Threads I follow (my own parents and anything I replied to), unread first. Team only. */
  threads: ThreadSummary[];
  threadsUnread: number;
  /** Saved for later (team only), newest first. */
  saved: SavedRow[];
  savedByMessage: ReadonlyMap<string, SavedRow>;
  saveMessage: (message: Message) => Promise<void>;
  unsaveMessage: (messageId: string) => Promise<void>;
  updateSaved: (id: string, patch: Partial<SavedItem>) => Promise<void>;
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
  /** online (active in the last 10 minutes), away (idle, or set by hand) or offline. */
  presenceOf: (userId: string) => PresenceStatus;
  /** Update my own profile (name, photo, status, DND); optimistic, then persisted. */
  updateMe: (patch: Partial<Profile>) => Promise<boolean>;
  profileCard: ProfileCardState | null;
  /** Returns a click handler that opens the profile card for a user at the pointer. */
  openProfile: (
    userId: string,
  ) => (e: {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
    currentTarget: EventTarget;
  }) => void;
  closeProfile: () => void;
  markRead: (conversationId: string) => Promise<void>;
  markActivityRead: (messageId: string) => void;
  markAllActivityRead: () => Promise<void>;
  markThreadRead: (messageId: string) => Promise<void>;
  refreshThreads: () => Promise<void>;
  toggleStar: (conversationId: string) => Promise<void>;
  /** The sidebar sections this person has made for themselves, in display order. */
  sections: SidebarSection[];
  /** Which of my sections a conversation is filed in, or null when it is not filed. */
  sectionOf: (conversationId: string) => string | null;
  /** File a conversation into one of my sections, or pass null to take it back out. */
  moveToSection: (conversationId: string, sectionId: string | null) => Promise<void>;
  createSection: (name: string) => Promise<string | null>;
  renameSection: (sectionId: string, name: string) => Promise<void>;
  deleteSection: (sectionId: string) => Promise<void>;
  toggleMute: (conversationId: string) => Promise<void>;
  setNotifyLevel: (conversationId: string, level: NotifyLevel) => Promise<void>;
  openDm: (userId: string) => Promise<string | null>;
  /** Leave a group or group message (team only). Navigates home when leaving the open conversation. */
  leaveConversation: (conversationId: string) => Promise<boolean>;
  setArchived: (conversationId: string, archived: boolean) => Promise<boolean>;
  refresh: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

interface StoreProviderProps {
  me: Profile;
  org: Org;
  callsEnabled: boolean;
  profiles: Profile[];
  conversations: ConversationSummary[];
  activity: ActivityItem[];
  threads: ThreadSummary[];
  saved: SavedRow[];
  sections: SidebarSection[];
  sectionItems: SidebarSectionItem[];
  children: ReactNode;
}

export function StoreProvider({
  me,
  org,
  callsEnabled,
  profiles: profileList,
  conversations: initialConversations,
  activity: initialActivity,
  threads: initialThreads,
  saved: initialSaved,
  sections: initialSections,
  sectionItems: initialSectionItems,
  children,
}: StoreProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [conversations, setConversations] = useState(initialConversations);
  const [activity, setActivity] = useState(initialActivity);
  const [threads, setThreads] = useState(initialThreads);
  const [saved, setSaved] = useState(initialSaved);
  const [sections, setSections] = useState(initialSections);
  const [sectionItems, setSectionItems] = useState(initialSectionItems);
  const [seenSaved, setSeenSaved] = useState(initialSaved);
  if (seenSaved !== initialSaved) {
    setSeenSaved(initialSaved);
    setSaved(initialSaved);
  }
  // user id -> away? for everyone tracked on the org presence channel
  const [presence, setPresence] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [profileCard, setProfileCard] = useState<ProfileCardState | null>(null);
  const [meState, setMeState] = useState(me);
  const [seenMe, setSeenMe] = useState(me);
  if (seenMe !== me) {
    setSeenMe(me);
    setMeState(me);
  }
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
  const [seenThreads, setSeenThreads] = useState(initialThreads);
  if (seenThreads !== initialThreads) {
    setSeenThreads(initialThreads);
    setThreads(initialThreads);
  }
  const [seenSections, setSeenSections] = useState(initialSections);
  if (seenSections !== initialSections) {
    setSeenSections(initialSections);
    setSections(initialSections);
  }
  const [seenSectionItems, setSeenSectionItems] = useState(initialSectionItems);
  if (seenSectionItems !== initialSectionItems) {
    setSeenSectionItems(initialSectionItems);
    setSectionItems(initialSectionItems);
  }

  const [profiles, setProfiles] = useState<Record<string, Profile>>(() =>
    Object.fromEntries(profileList.map((p) => [p.id, p])),
  );
  const [seenProfiles, setSeenProfiles] = useState(profileList);
  if (seenProfiles !== profileList) {
    setSeenProfiles(profileList);
    setProfiles(Object.fromEntries(profileList.map((p) => [p.id, p])));
  }
  const patchProfile = useCallback((id: string, patch: Partial<Profile>) => {
    setProfiles((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  }, []);
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
  const navRef = useRef(nav);
  useEffect(() => {
    activeRef.current = activeConversationId;
    navRef.current = nav;
  }, [activeConversationId, nav]);

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

  const presenceOf = useCallback(
    (userId: string): PresenceStatus => {
      // A manual away beats both the idle timer and "offline": the person told us, and it has
      // to stay visible while their tab is closed, which is the whole point of storing it.
      if (manualAway(userId === me.id ? meState : profiles[userId])) return "away";
      return presence.has(userId) ? (presence.get(userId) ? "away" : "online") : "offline";
    },
    [presence, profiles, meState, me.id],
  );
  const isOnline = useCallback((userId: string) => presenceOf(userId) === "online", [presenceOf]);
  const online = useMemo(() => new Set(presence.keys()) as ReadonlySet<string>, [presence]);

  const updateMe = useCallback(
    async (patch: Partial<Profile>) => {
      setMeState((prev) => ({ ...prev, ...patch }));
      patchProfile(me.id, patch);
      const { error } = await supabase.from("profiles").update(patch).eq("id", me.id);
      return !error;
    },
    [supabase, me.id, patchProfile],
  );

  const openProfile = useCallback(
    (userId: string) =>
      (e: {
        clientX: number;
        clientY: number;
        preventDefault: () => void;
        stopPropagation: () => void;
        currentTarget: EventTarget;
      }) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget as HTMLElement | null;
        const r = el?.getBoundingClientRect?.();
        setProfileCard({ id: userId, x: r ? r.left : e.clientX, y: r ? r.bottom + 4 : e.clientY });
      },
    [],
  );
  const closeProfile = useCallback(() => setProfileCard(null), []);

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

  const savedByMessage = useMemo(() => new Map(saved.map((r) => [r.message_id, r])), [saved]);

  const saveMessage = useCallback(
    async (message: Message) => {
      const optimistic: SavedRow = {
        id: `tmp-${message.id}`,
        org_id: me.org_id,
        user_id: me.id,
        message_id: message.id,
        saved_at: new Date().toISOString(),
        remind_at: null,
        reminded_at: null,
        completed_at: null,
        archived_at: null,
        message,
      };
      setSaved((prev) => (prev.some((r) => r.message_id === message.id) ? prev : [optimistic, ...prev]));
      const { data, error } = await supabase
        .from("saved_items")
        .insert({ org_id: me.org_id, user_id: me.id, message_id: message.id })
        .select("*, message:messages(*)")
        .single();
      if (error || !data) setSaved((prev) => prev.filter((r) => r.message_id !== message.id));
      else setSaved((prev) => prev.map((r) => (r.message_id === message.id ? (data as SavedRow) : r)));
    },
    [supabase, me.id, me.org_id],
  );

  const unsaveMessage = useCallback(
    async (messageId: string) => {
      const removed = saved.find((r) => r.message_id === messageId);
      setSaved((prev) => prev.filter((r) => r.message_id !== messageId));
      const { error } = await supabase.from("saved_items").delete().eq("message_id", messageId).eq("user_id", me.id);
      if (error && removed) setSaved((prev) => [removed, ...prev]);
    },
    [supabase, me.id, saved],
  );

  const updateSaved = useCallback(
    async (id: string, patch: Partial<SavedItem>) => {
      setSaved((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      await supabase.from("saved_items").update(patch).eq("id", id);
    },
    [supabase],
  );

  const refreshThreads = useCallback(async () => {
    const { data } = await supabase.rpc("my_threads", { max_rows: 100 });
    if (data) setThreads(data);
  }, [supabase]);

  const markThreadRead = useCallback(
    async (messageId: string) => {
      setThreads((prev) => prev.map((t) => (t.message_id === messageId ? { ...t, unread_count: 0 } : t)));
      setActivity((prev) => prev.map((a) => (a.parent_id === messageId ? { ...a, unread: false } : a)));
      await supabase.rpc("mark_thread_read", { p_message_id: messageId });
    },
    [supabase],
  );

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

  // ---- sidebar sections -----------------------------------------------------
  // Private to this person, like starring: optimistic state and a direct write, with RLS on
  // sidebar_sections / sidebar_section_items (0039) doing the authorisation. No broadcast, for the
  // same reason starring has none — nobody else can see these, and a second tab of my own picks
  // them up on its next router.refresh().
  const sectionById = useMemo(
    () => new Map(sectionItems.map((i) => [i.conversation_id, i.section_id])),
    [sectionItems],
  );
  const sectionOf = useCallback((conversationId: string) => sectionById.get(conversationId) ?? null, [sectionById]);

  const moveToSection = useCallback(
    async (conversationId: string, sectionId: string | null) => {
      const previous = sectionItems;
      setSectionItems((prev) => {
        const rest = prev.filter((i) => i.conversation_id !== conversationId);
        if (!sectionId) return rest;
        return [
          ...rest,
          {
            org_id: me.org_id,
            user_id: me.id,
            conversation_id: conversationId,
            section_id: sectionId,
            created_at: new Date().toISOString(),
          },
        ];
      });
      const { error } = sectionId
        ? await supabase.from("sidebar_section_items").upsert(
            {
              org_id: me.org_id,
              user_id: me.id,
              conversation_id: conversationId,
              section_id: sectionId,
            },
            { onConflict: "user_id,conversation_id" },
          )
        : await supabase
            .from("sidebar_section_items")
            .delete()
            .eq("user_id", me.id)
            .eq("conversation_id", conversationId);
      // Put the row back rather than leave the sidebar showing a move that did not happen.
      if (error) setSectionItems(previous);
    },
    [supabase, me.id, me.org_id, sectionItems],
  );

  const createSection = useCallback(
    async (name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return null;
      const { data, error } = await supabase
        .from("sidebar_sections")
        .insert({
          org_id: me.org_id,
          user_id: me.id,
          name: trimmed,
          // Spaced by 1000 to match conversation_bookmarks, so a later reorder can slot between.
          position: sections.reduce((max, s) => Math.max(max, s.position), 0) + 1000,
        })
        .select()
        .single();
      if (error || !data) return null;
      setSections((prev) => [...prev, data]);
      return data.id;
    },
    [supabase, me.id, me.org_id, sections],
  );

  const renameSection = useCallback(
    async (sectionId: string, name: string) => {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) return;
      const previous = sections;
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name: trimmed } : s)));
      const { error } = await supabase.from("sidebar_sections").update({ name: trimmed }).eq("id", sectionId);
      if (error) setSections(previous);
    },
    [supabase, sections],
  );

  const deleteSection = useCallback(
    async (sectionId: string) => {
      const previousSections = sections;
      const previousItems = sectionItems;
      // Drop the memberships locally too, so the groups reappear under the section they are
      // computed into rather than vanishing until the next refresh. The FK cascade does the same
      // thing in the database.
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
      setSectionItems((prev) => prev.filter((i) => i.section_id !== sectionId));
      const { error } = await supabase.from("sidebar_sections").delete().eq("id", sectionId);
      if (error) {
        setSections(previousSections);
        setSectionItems(previousItems);
      }
    },
    [supabase, sections, sectionItems],
  );

  const leaveConversation = useCallback(
    async (conversationId: string) => {
      const { error } = await supabase.rpc("remove_member", { p_conversation_id: conversationId, p_user_id: me.id });
      if (error) return false;
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (activeRef.current === conversationId) router.push(`/${navRef.current === "dms" ? "dms" : "home"}`);
      refresh();
      return true;
    },
    [supabase, me.id, router, refresh],
  );

  const setArchived = useCallback(
    async (conversationId: string, archived: boolean) => {
      const { error } = await supabase.rpc("archive_channel", {
        p_conversation_id: conversationId,
        p_archived: archived,
      });
      if (error) return false;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId ? { ...c, archived_at: archived ? new Date().toISOString() : null } : c,
        ),
      );
      refresh();
      return true;
    },
    [supabase, refresh],
  );

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
      const mentionsMe = (evt.mentions ?? []).includes(me.id) || previewMentions(evt.preview, me.display_name);
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
      if (isReply && evt.parent_id) {
        const parentId = evt.parent_id;
        let knownThread = false;
        setThreads((prev) => {
          const idx = prev.findIndex((t) => t.message_id === parentId);
          if (idx === -1) return prev;
          knownThread = true;
          const t = prev[idx];
          const updated: ThreadSummary = {
            ...t,
            reply_count: t.reply_count + 1,
            last_reply_at: evt.created_at,
            unread_count: isMine ? 0 : t.unread_count + 1,
            participant_ids:
              evt.sender_id && !(t.participant_ids ?? []).includes(evt.sender_id)
                ? [...(t.participant_ids ?? []), evt.sender_id]
                : t.participant_ids,
          };
          const next = [...prev];
          next.splice(idx, 1);
          return [updated, ...next];
        });
        // A reply in a thread we did not follow yet (someone replied to us, or our own first reply).
        queueMicrotask(() => {
          if (!knownThread && !cancelled) void refreshThreads();
        });
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
  }, [supabase, me.id, me.display_name, refresh, refreshThreads, router]);

  // ---- Realtime: org presence (with idle → away) and live profile changes ----
  useEffect(() => {
    let cancelled = false;
    let away = false;
    let timer: number | undefined;
    const channel = supabase.channel(`org:${org.id}`, { config: { private: true, presence: { key: me.id } } });
    const sync = () => {
      const state = channel.presenceState<{ user_id: string; away?: boolean }>();
      const next = new Map<string, boolean>();
      for (const [key, metas] of Object.entries(state))
        next.set(
          key,
          metas.every((m) => !!m.away),
        );
      setPresence(next);
    };
    channel.on("presence", { event: "sync" }, sync);
    channel.on("broadcast", { event: "profile_changed" }, ({ payload }) => {
      const evt = payload as ProfileChangedEvent;
      const { id, ...patch } = evt;
      patchProfile(id, patch);
      if (id === me.id) setMeState((prev) => ({ ...prev, ...patch }));
    });
    const track = () => channel.track({ user_id: me.id, at: Date.now(), away });
    const goAway = () => {
      if (away || cancelled) return;
      away = true;
      void track();
    };
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(goAway, AWAY_AFTER_MS);
    };
    const onActivity = () => {
      if (cancelled) return;
      arm();
      if (away) {
        away = false;
        void track();
      }
    };
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "pointerdown", "touchstart", "focus"];
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });
    const onVisible = () => document.visibilityState === "visible" && onActivity();
    document.addEventListener("visibilitychange", onVisible);
    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await track();
          arm();
        }
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [supabase, org.id, me.id, patchProfile]);

  const value = useMemo<StoreValue>(
    () => ({
      me: meState,
      org,
      callsEnabled,
      isTeam,
      isAdmin,
      isCustomer,
      profiles,
      conversations,
      activity,
      threads,
      threadsUnread: threads.reduce((n, t) => n + t.unread_count, 0),
      saved,
      savedByMessage,
      saveMessage,
      unsaveMessage,
      updateSaved,
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
      presenceOf,
      updateMe,
      profileCard,
      openProfile,
      closeProfile,
      markRead,
      markActivityRead,
      markAllActivityRead,
      markThreadRead,
      refreshThreads,
      toggleStar,
      sections,
      sectionOf,
      moveToSection,
      createSection,
      renameSection,
      deleteSection,
      toggleMute,
      setNotifyLevel,
      openDm,
      leaveConversation,
      setArchived,
      refresh,
    }),
    [
      meState,
      org,
      callsEnabled,
      isTeam,
      isAdmin,
      isCustomer,
      profiles,
      conversations,
      activity,
      threads,
      saved,
      savedByMessage,
      saveMessage,
      unsaveMessage,
      updateSaved,
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
      presenceOf,
      updateMe,
      profileCard,
      openProfile,
      closeProfile,
      markRead,
      markActivityRead,
      markAllActivityRead,
      markThreadRead,
      refreshThreads,
      toggleStar,
      sections,
      sectionOf,
      moveToSection,
      createSection,
      renameSection,
      deleteSection,
      toggleMute,
      setNotifyLevel,
      openDm,
      leaveConversation,
      setArchived,
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
