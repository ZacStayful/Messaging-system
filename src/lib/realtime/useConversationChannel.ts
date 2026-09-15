"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/lib/database.types";

interface Options {
  conversationId: string;
  onInsert: (row: Message) => void;
  onUpdate: (row: Message) => void;
  /** Called after a reconnect so the caller can back-fill anything missed. */
  onResubscribe: () => void;
}

interface ChangePayload {
  record: Message;
  old_record: Message | null;
  operation: "INSERT" | "UPDATE" | "DELETE";
}

/** Subscribes to the private `conversation:<id>` topic fed by the database broadcast trigger. */
export function useConversationChannel({ conversationId, onInsert, onUpdate, onResubscribe }: Options) {
  const handlers = useRef({ onInsert, onUpdate, onResubscribe });
  useEffect(() => {
    handlers.current = { onInsert, onUpdate, onResubscribe };
  }, [onInsert, onUpdate, onResubscribe]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let needsBackfill = false;
    const channel = supabase.channel(`conversation:${conversationId}`, { config: { private: true } });

    channel
      .on("broadcast", { event: "INSERT" }, ({ payload }) =>
        handlers.current.onInsert((payload as ChangePayload).record),
      )
      .on("broadcast", { event: "UPDATE" }, ({ payload }) =>
        handlers.current.onUpdate((payload as ChangePayload).record),
      );

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
