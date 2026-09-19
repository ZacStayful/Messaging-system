import { describe, expect, it } from "vitest";
import type { ConversationSummary, ThreadSummary } from "@/lib/database.types";
import { applyReadState, applyThreadReadState } from "@/lib/realtime/readState";

/**
 * Applying a read that happened on one of this person's other devices.
 *
 * These are the two rules that are easy to get wrong by copying the `message_created` handler
 * beside them: clear the counts only when the server says nothing is left, and never reorder.
 */

const conversation = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary =>
  ({
    id,
    unread_count: 3,
    mention_count: 1,
    last_read_at: "2026-09-19T10:00:00+00:00",
    last_message_at: "2026-09-19T10:05:00+00:00",
    name: id,
    ...over,
  }) as ConversationSummary;

const thread = (messageId: string, over: Partial<ThreadSummary> = {}): ThreadSummary =>
  ({
    message_id: messageId,
    unread_count: 2,
    last_read_at: "2026-09-19T10:00:00+00:00",
    last_reply_at: "2026-09-19T10:05:00+00:00",
    reply_count: 4,
    ...over,
  }) as ThreadSummary;

describe("applyReadState", () => {
  it("clears the badge when the server says nothing is left", () => {
    const [c] = applyReadState([conversation("a")], {
      conversation_id: "a",
      last_read_at: "2026-09-19T10:06:00+00:00",
      has_unread: false,
    });
    expect(c.unread_count).toBe(0);
    expect(c.mention_count).toBe(0);
    expect(c.last_read_at).toBe("2026-09-19T10:06:00+00:00");
  });

  it("keeps the badge when something arrived after the read", () => {
    // The race the boolean exists for: a message lands between the read on the other device and
    // this event reaching us. Leaving a badge up costs a glance; clearing one loses a message.
    const [c] = applyReadState([conversation("a")], {
      conversation_id: "a",
      last_read_at: "2026-09-19T10:03:00+00:00",
      has_unread: true,
    });
    expect(c.unread_count).toBe(3);
    expect(c.mention_count).toBe(1);
  });

  it("advances the mark even when the badge stays", () => {
    // last_read_at is not only the badge: TopBar sorts and renders it. It follows the server
    // whatever the counts do.
    const [c] = applyReadState([conversation("a")], {
      conversation_id: "a",
      last_read_at: "2026-09-19T10:03:00+00:00",
      has_unread: true,
    });
    expect(c.last_read_at).toBe("2026-09-19T10:03:00+00:00");
  });

  it("does not reorder the list", () => {
    // message_created splices the matched row to the front, because a new message moves a
    // conversation up. Reading one does not, and copying that would reshuffle the sidebar on the
    // other device while someone was pointing at it.
    const before = [conversation("a"), conversation("b"), conversation("c")];
    const after = applyReadState(before, { conversation_id: "c", last_read_at: "x", has_unread: false });
    expect(after.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves every other conversation exactly as it was", () => {
    const before = [conversation("a"), conversation("b")];
    const after = applyReadState(before, { conversation_id: "a", last_read_at: "x", has_unread: false });
    expect(after[1]).toBe(before[1]);
  });

  it("ignores a conversation this device has never heard of", () => {
    // Not merely harmless: message_created calls router.refresh() in this case, and because
    // messages_after_insert fires before messages_broadcast, read_state arrives *first* for your
    // own send — so the same reflex here would be a full server render per message sent.
    const before = [conversation("a")];
    expect(applyReadState(before, { conversation_id: "zzz", last_read_at: "x", has_unread: false })).toEqual(before);
  });

  it("is idempotent, because the reading device gets its own event back", () => {
    const evt = { conversation_id: "a", last_read_at: "2026-09-19T10:06:00+00:00", has_unread: false };
    const once = applyReadState([conversation("a")], evt);
    expect(applyReadState(once, evt)).toEqual(once);
  });
});

describe("applyThreadReadState", () => {
  it("clears the thread's badge when nothing is left", () => {
    const [t] = applyThreadReadState([thread("m1")], {
      message_id: "m1",
      last_read_at: "2026-09-19T10:06:00+00:00",
      has_unread: false,
    });
    expect(t.unread_count).toBe(0);
    expect(t.last_read_at).toBe("2026-09-19T10:06:00+00:00");
  });

  it("keeps it when a reply landed after the read", () => {
    const [t] = applyThreadReadState([thread("m1")], {
      message_id: "m1",
      last_read_at: "2026-09-19T10:03:00+00:00",
      has_unread: true,
    });
    expect(t.unread_count).toBe(2);
  });

  it("writes last_read_at, which markThreadRead never did", () => {
    // my_threads returns the column, so ThreadSummary carries it; the optimistic path only zeroed
    // the count and left the timestamp behind.
    const [t] = applyThreadReadState([thread("m1", { last_read_at: null })], {
      message_id: "m1",
      last_read_at: "2026-09-19T10:06:00+00:00",
      has_unread: false,
    });
    expect(t.last_read_at).toBe("2026-09-19T10:06:00+00:00");
  });

  it("does not reorder, and leaves unrelated threads untouched", () => {
    const before = [thread("m1"), thread("m2"), thread("m3")];
    const after = applyThreadReadState(before, { message_id: "m3", last_read_at: "x", has_unread: false });
    expect(after.map((t) => t.message_id)).toEqual(["m1", "m2", "m3"]);
    expect(after[0]).toBe(before[0]);
  });
});
