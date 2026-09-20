/**
 * What one of this person's *other* devices did, applied to this one.
 *
 * The three read markers — a conversation's `last_read_at`, a thread's, and `activity_seen_at` —
 * used to be write-only as far as realtime was concerned. Reading on a phone left the badge lit on
 * the laptop until that tab reloaded. `0041_read_state_broadcast.sql` publishes each of them to the
 * reader's own `user:<id>` topic; these are the rules for applying what arrives.
 *
 * Two things make this unlike the `message_created` handler next door, and both are easy to get
 * wrong by copying it:
 *
 * **There is no sender to compare against.** A read event has no `sender_id`, so the device that
 * did the reading receives its own event back. That is not a case to skip — it is the point:
 * `markRead` writes a *browser-clock* `last_read_at`, which is what the TopBar recents popover
 * sorts and renders, and the echo replaces it with the server's. So these apply absolute values
 * rather than incrementing, and running one twice is the same as running it once.
 *
 * **A read must not reorder anything.** `message_created` splices the matched row to the front of
 * the list, because a new message really does move a conversation up. Reading one does not, and
 * copying that pattern would make a read on the phone reshuffle the sidebar on the laptop under
 * someone's cursor.
 */

import type { ConversationSummary, ThreadSummary } from "@/lib/database.types";

/** `read_state` on `user:<id>`: this person read a conversation, on some device. */
export interface ReadStateEvent {
  conversation_id: string;
  last_read_at: string | null;
  /**
   * Whether anything still sits after the mark. Decided in the trigger, where both sides are
   * `timestamptz` out of one snapshot — the obvious client-side version compares ISO *strings*
   * from payloads that need not share a UTC offset, against a `last_message_at` that is only as
   * fresh as the last `message_created` this device happened to see.
   */
  has_unread: boolean;
}

/** `thread_read_state` on `user:<id>`: the same, for a thread, keyed on its parent message. */
export interface ThreadReadStateEvent {
  message_id: string;
  last_read_at: string | null;
  has_unread: boolean;
}

/** `activity_seen` on `user:<id>`: this person opened their activity feed somewhere. */
export interface ActivitySeenEvent {
  activity_seen_at: string | null;
}

/**
 * Advance the conversation's mark, and clear its counts only if the server says nothing is left.
 *
 * `has_unread` can be conservatively true — `conversations.last_message_at` moves for an internal
 * note a customer cannot see, and ignores `notify_level`, both of which `my_conversations` already
 * reports as a count of zero. The effect is that we decline to clear a zero. It can leave a badge
 * up until the next event; it cannot invent one.
 */
export function applyReadState(conversations: ConversationSummary[], evt: ReadStateEvent): ConversationSummary[] {
  return conversations.map((c) =>
    c.id === evt.conversation_id
      ? {
          ...c,
          last_read_at: evt.last_read_at,
          unread_count: evt.has_unread ? c.unread_count : 0,
          mention_count: evt.has_unread ? c.mention_count : 0,
        }
      : c,
  );
}

/**
 * The same, for a thread. `markThreadRead` never wrote `last_read_at` locally even though
 * `my_threads` returns it, so this is also where a reading device's own copy stops being stale.
 */
export function applyThreadReadState(threads: ThreadSummary[], evt: ThreadReadStateEvent): ThreadSummary[] {
  return threads.map((t) =>
    t.message_id === evt.message_id
      ? { ...t, last_read_at: evt.last_read_at, unread_count: evt.has_unread ? t.unread_count : 0 }
      : t,
  );
}
