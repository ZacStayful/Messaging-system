"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Attachment, ConversationBookmark, Message, Pin, Reaction } from "@/lib/database.types";

export type ChangeOp = "INSERT" | "UPDATE" | "DELETE";

export interface Change<T> {
  operation: ChangeOp;
  record: T | null;
  old_record: T | null;
}

/** Client-to-client "someone is typing" event; never stored. */
export interface TypingEvent {
  user_id: string;
  parent_id: string | null;
  at: number;
}

interface Options {
  conversationId: string;
  /**
   * Also listen on `conversation-internal:<id>`, where 0029 sends internal notes. Pass the
   * viewer's own team-ness: the topic's policy requires is_team() anyway, so a customer who
   * passed true would simply never be subscribed — but asking for it here keeps the client
   * honest about what it expects to receive.
   */
  internal?: boolean;
  onInsert: (row: Message) => void;
  onUpdate: (row: Message) => void;
  onReaction?: (change: Change<Reaction>) => void;
  onPin?: (change: Change<Pin>) => void;
  onBookmark?: (change: Change<ConversationBookmark>) => void;
  onAttachment?: (change: Change<Attachment>) => void;
  onTyping?: (evt: TypingEvent) => void;
  /** Called after a reconnect so the caller can back-fill anything missed. */
  onResubscribe: () => void;
}

interface RawPayload {
  record: unknown;
  old_record: unknown;
  operation: ChangeOp;
}

function asChange<T>(payload: unknown): Change<T> {
  const p = payload as RawPayload;
  const empty = (v: unknown) => v == null || (typeof v === "object" && Object.keys(v as object).length === 0);
  return {
    operation: p.operation,
    record: empty(p.record) ? null : (p.record as T),
    old_record: empty(p.old_record) ? null : (p.old_record as T),
  };
}

/**
 * Subscribes to the private `conversation:<id>` topic fed by the database broadcast triggers,
 * and — for the team — to `conversation-internal:<id>`, where internal notes go.
 * Returns `sendTyping` for the client-only typing indicator.
 */
export function useConversationChannel(opts: Options) {
  const { conversationId, internal = false } = opts;
  const handlers = useRef(opts);
  const channelRef = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    handlers.current = opts;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let needsBackfill = false;
    const channel = supabase.channel(`conversation:${conversationId}`, { config: { private: true } });
    channelRef.current = channel;

    // Internal notes are broadcast on their own topic so that the policy authorising it can
    // require is_team() — a topic policy cannot see a row's visibility, only the topic name.
    const internalChannel = internal
      ? supabase.channel(`conversation-internal:${conversationId}`, { config: { private: true } })
      : null;
    internalChannel
      ?.on("broadcast", { event: "INSERT" }, ({ payload }) => {
        const c = asChange<Message>(payload);
        if (c.record) handlers.current.onInsert(c.record);
      })
      .on("broadcast", { event: "UPDATE" }, ({ payload }) => {
        const c = asChange<Message>(payload);
        if (c.record) handlers.current.onUpdate(c.record);
      });

    channel
      .on("broadcast", { event: "INSERT" }, ({ payload }) => {
        const c = asChange<Message>(payload);
        if (c.record) handlers.current.onInsert(c.record);
      })
      .on("broadcast", { event: "UPDATE" }, ({ payload }) => {
        const c = asChange<Message>(payload);
        if (c.record) handlers.current.onUpdate(c.record);
      })
      .on("broadcast", { event: "REACTION" }, ({ payload }) => handlers.current.onReaction?.(asChange(payload)))
      .on("broadcast", { event: "PIN" }, ({ payload }) => handlers.current.onPin?.(asChange(payload)))
      .on("broadcast", { event: "BOOKMARK" }, ({ payload }) => handlers.current.onBookmark?.(asChange(payload)))
      .on("broadcast", { event: "ATTACHMENT" }, ({ payload }) => handlers.current.onAttachment?.(asChange(payload)))
      .on("broadcast", { event: "typing" }, ({ payload }) => handlers.current.onTyping?.(payload as TypingEvent));

    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      internalChannel?.subscribe();
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // After a reconnect, or after a failed first attempt (new projects can briefly report
          // MissingPartition), fetch anything that arrived while we were not listening.
          if (needsBackfill) handlers.current.onResubscribe();
          needsBackfill = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          needsBackfill = true;
        }
      });
    });

    return () => {
      cancelled = true;
      channelRef.current = null;
      supabase.removeChannel(channel);
      if (internalChannel) supabase.removeChannel(internalChannel);
    };
  }, [conversationId, internal]);

  const sendTyping = useCallback((evt: Omit<TypingEvent, "at">) => {
    const ch = channelRef.current;
    if (!ch || ch.state !== "joined") return;
    void ch.send({ type: "broadcast", event: "typing", payload: { ...evt, at: Date.now() } });
  }, []);

  return { sendTyping };
}
