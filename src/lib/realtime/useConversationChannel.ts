"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Attachment, Message, Pin, Reaction } from "@/lib/database.types";

export type ChangeOp = "INSERT" | "UPDATE" | "DELETE";

export interface Change<T> {
  operation: ChangeOp;
  record: T | null;
  old_record: T | null;
}

interface Options {
  conversationId: string;
  onInsert: (row: Message) => void;
  onUpdate: (row: Message) => void;
  onReaction?: (change: Change<Reaction>) => void;
  onPin?: (change: Change<Pin>) => void;
  onAttachment?: (change: Change<Attachment>) => void;
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

/** Subscribes to the private `conversation:<id>` topic fed by the database broadcast triggers. */
export function useConversationChannel(opts: Options) {
  const { conversationId } = opts;
  const handlers = useRef(opts);
  useEffect(() => {
    handlers.current = opts;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let needsBackfill = false;
    const channel = supabase.channel(`conversation:${conversationId}`, { config: { private: true } });

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
      .on("broadcast", { event: "ATTACHMENT" }, ({ payload }) => handlers.current.onAttachment?.(asChange(payload)));

    supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
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
      supabase.removeChannel(channel);
    };
  }, [conversationId]);
}
