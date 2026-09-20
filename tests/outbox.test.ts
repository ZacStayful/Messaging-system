import { describe, expect, it } from "vitest";
import { groupOutboxRows, settleBatch, skipReason, type RecipientPrefs } from "@/lib/notifications/policy";

const AWAKE: RecipientPrefs = {
  presence_mode: "auto",
  away_until: null,
  dnd_until: null,
  email: "jason@example.com",
  phone: "+447700900001",
  email_notifications: "instant",
  whatsapp_notifications: "instant",
};

const email = { channel: "email" };
const whatsapp = { channel: "whatsapp" };

describe("skipReason", () => {
  it("sends when everything is on", () => {
    expect(skipReason(email, AWAKE)).toBeNull();
    expect(skipReason(whatsapp, AWAKE)).toBeNull();
  });

  it("sends when we know nothing about the recipient", () => {
    // A welcome row has no profile behind it; not knowing must not mean not sending.
    expect(skipReason(email, undefined)).toBeNull();
  });

  it("silences every channel when someone set themselves away", () => {
    const away = { ...AWAKE, presence_mode: "away" };
    // This is the 0014 guarantee: away means away, not "away from email".
    expect(skipReason(email, away)).toBe("recipient away");
    expect(skipReason(whatsapp, away)).toBe("recipient away");
  });

  it("silences every channel while do-not-disturb is running, and stops when it expires", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(skipReason(whatsapp, { ...AWAKE, dnd_until: future })).toBe("notifications paused");
    expect(skipReason(whatsapp, { ...AWAKE, dnd_until: past })).toBeNull();
  });

  it("turns one channel off without touching the other", () => {
    const emailOff = { ...AWAKE, email_notifications: "off" };
    expect(skipReason(email, emailOff)).toBe("email notifications off");
    expect(skipReason(whatsapp, emailOff)).toBeNull();

    const waOff = { ...AWAKE, whatsapp_notifications: "off" };
    expect(skipReason(whatsapp, waOff)).toBe("whatsapp notifications off");
    expect(skipReason(email, waOff)).toBeNull();
  });

  it("does not try to send to an address or number that is not there", () => {
    expect(skipReason(whatsapp, { ...AWAKE, phone: null })).toBe("no mobile number");
    expect(skipReason(email, { ...AWAKE, email: null })).toBe("no email address");
  });

  it("puts away ahead of a channel switch, so the reason recorded is the true one", () => {
    const away = { ...AWAKE, presence_mode: "away", email_notifications: "off" };
    expect(skipReason(email, away)).toBe("recipient away");
  });
});

describe("groupOutboxRows", () => {
  const at = (mins: number) => new Date(Date.UTC(2026, 0, 1, 12, mins)).toISOString();
  const row = (id: number, user: string, conv: string, mins: number) => ({
    id,
    channel: "email",
    recipient_user_id: user,
    payload: { conversation_id: conv, created_at: at(mins) },
  });
  const WINDOW = 2 * 60_000;

  it("batches messages to one person in one conversation inside the window", () => {
    const groups = groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u1", "c1", 1)], WINDOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("never mixes two people", () => {
    const groups = groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u2", "c1", 0)], WINDOW);
    expect(groups).toHaveLength(2);
  });

  it("never mixes two conversations", () => {
    const groups = groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u1", "c2", 0)], WINDOW);
    expect(groups).toHaveLength(2);
  });

  it("starts a new batch once the window has passed", () => {
    const groups = groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u1", "c1", 5)], WINDOW);
    expect(groups).toHaveLength(2);
  });

  it("keeps every row exactly once, however it splits", () => {
    const rows = [row(1, "u1", "c1", 0), row(2, "u1", "c1", 1), row(3, "u1", "c1", 9), row(4, "u2", "c1", 0)];
    const ids = groupOutboxRows(rows, WINDOW)
      .flat()
      .map((r) => r.id)
      .sort();
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("handles an empty run", () => {
    expect(groupOutboxRows([], WINDOW)).toEqual([]);
  });

  const sizes = (groups: { id: number }[][]) => groups.map((g) => g.length);

  /**
   * The bug these were written for: the overflowing batch was stored under a key nothing ever
   * read back, so the window anchor stayed pinned to the first row of the whole run and every
   * later row became a batch of one. The old tests missed it because none of them put three
   * rows in a second window, and they asserted only that ids were conserved — which the broken
   * version did perfectly.
   */
  it("batches a burst that spans more than one window", () => {
    const rows = [
      row(1, "u1", "c1", 0),
      row(2, "u1", "c1", 1),
      row(3, "u1", "c1", 5),
      row(4, "u1", "c1", 6),
      row(5, "u1", "c1", 7),
    ];
    // Two emails: minutes 0-1, then 5-7. Before the fix this returned four.
    expect(sizes(groupOutboxRows(rows, WINDOW))).toEqual([2, 3]);
  });

  it("keeps batching after a split, rather than one email per message", () => {
    const rows = [row(1, "u1", "c1", 0), row(2, "u1", "c1", 3), row(3, "u1", "c1", 4)];
    expect(sizes(groupOutboxRows(rows, WINDOW))).toEqual([1, 2]);
  });

  it("treats exactly one window apart as still in the batch", () => {
    // Pins > against >=, which is otherwise the kind of thing a later refactor flips by accident.
    expect(sizes(groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u1", "c1", 2)], WINDOW))).toEqual([2]);
    expect(sizes(groupOutboxRows([row(1, "u1", "c1", 0), row(2, "u1", "c1", 3)], WINDOW))).toEqual([1, 1]);
  });

  /**
   * The drain orders by the outbox row's created_at, but the window is measured on the message's,
   * and they diverge: the WhatsApp fallback copies an old payload onto a brand-new row. Without
   * ordering, the subtraction went negative and merged a message of any age into a fresh batch.
   */
  it("orders by the message time, so a late-queued old message cannot join a fresh batch", () => {
    const rows = [row(1, "u1", "c1", 0), row(2, "u1", "c1", 10), row(3, "u1", "c1", 1)];
    expect(sizes(groupOutboxRows(rows, WINDOW))).toEqual([2, 1]);

    const reversed = [row(1, "u1", "c1", 10), row(2, "u1", "c1", 0)];
    expect(sizes(groupOutboxRows(reversed, WINDOW))).toEqual([1, 1]);
  });

  /**
   * The one that matters most. recipient_user_id is nullable, and the old key interpolated it
   * into a template string, so two rows with no recipient keyed on the literal "null:<conv>"
   * and batched — and the drain addresses a whole batch to batch[0].recipient_email.
   */
  it("never batches rows that have no recipient", () => {
    const orphan = (id: number, addr: string) => ({
      id,
      channel: "email",
      recipient_user_id: null,
      recipient_email: addr,
      payload: { conversation_id: "c1", created_at: at(0) },
    });
    expect(sizes(groupOutboxRows([orphan(1, "a@example.com"), orphan(2, "b@example.com")], WINDOW))).toEqual([1, 1]);
  });

  it("never batches rows that disagree on the address", () => {
    // Same person, two addresses on file. The batch is addressed once, so these cannot merge.
    const a = { ...row(1, "u1", "c1", 0), recipient_email: "old@example.com" };
    const b = { ...row(2, "u1", "c1", 1), recipient_email: "new@example.com" };
    expect(sizes(groupOutboxRows([a, b], WINDOW))).toEqual([1, 1]);
  });

  it("does not merge rows whose payload has no usable timestamp", () => {
    const broken = { id: 9, channel: "email", recipient_user_id: "u1", payload: { conversation_id: "c1" } };
    const groups = groupOutboxRows([row(1, "u1", "c1", 0), broken as never], WINDOW);
    expect(sizes(groups)).toEqual([1, 1]);
  });
});

describe("groupOutboxRows — replaying a send that already went out", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 9, minutes)).toISOString();
  const row = (id: number, minute: number, key?: string) => ({
    id,
    channel: "email",
    recipient_user_id: "u1",
    recipient_email: "jason@example.com",
    payload: { conversation_id: "c1", created_at: at(minute) },
    ...(key ? { idempotency_key: key } : {}),
  });

  it("re-forms the batch a stranded row was sent in, rather than a fresh one", () => {
    // The failure this exists for: a batch of two goes out, finish() marks the first `sent` and
    // the run dies. Ten minutes later only the second is selectable. Without the stored key it
    // hashes to something Resend has never seen and the recipient reads the message twice.
    const batches = groupOutboxRows([row(102, 1, "stayful-outbox-abc")], 2 * 60_000);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((r) => r.id)).toEqual([102]);
    expect(batches[0][0].idempotency_key).toBe("stayful-outbox-abc");
  });

  it("keeps rows sent under the same key together", () => {
    const batches = groupOutboxRows([row(101, 0, "k1"), row(102, 1, "k1")], 2 * 60_000);
    expect(batches.map((b) => b.map((r) => r.id))).toEqual([[101, 102]]);
  });

  it("never merges a row that has been sent with one that has not", () => {
    // The dangerous direction. Sending a *new* message under a key Resend has already answered
    // gets it dropped as a duplicate and never delivered — a silent loss, which is worse than
    // the duplicate this whole mechanism prevents.
    const batches = groupOutboxRows([row(101, 0, "k1"), row(102, 1)], 2 * 60_000);
    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.map((r) => r.id)).sort()).toEqual([[101], [102]]);
  });

  it("never merges rows sent under different keys, however close in time", () => {
    const batches = groupOutboxRows([row(101, 0, "k1"), row(102, 0, "k2")], 2 * 60_000);
    expect(batches).toHaveLength(2);
  });

  it("leaves rows that have never been dispatched batching as they always did", () => {
    const batches = groupOutboxRows([row(1, 0), row(2, 1), row(3, 9)], 2 * 60_000);
    expect(batches.map((b) => b.map((r) => r.id))).toEqual([[1, 2], [3]]);
  });
});

describe("settleBatch", () => {
  const rows = (attempts: number, ...ids: number[]) => ids.map((id) => ({ id, attempts }));

  it("settles a whole batch in one group, not one statement per row", () => {
    // The per-row loop this replaces is what split batches: a run killed partway through left
    // some rows `sent` and the rest stranded in `sending`.
    const { groups } = settleBatch(rows(0, 1, 2, 3), true, 5);
    expect(groups).toEqual([{ ids: [1, 2, 3], attempts: 1, status: "sent" }]);
  });

  it("names every dead row once, so one note covers the batch", () => {
    // Six rows used to mean six byte-identical internal notes in one conversation.
    const { groups, goneQuiet } = settleBatch(rows(4, 1, 2, 3), false, 5);
    expect(groups).toEqual([{ ids: [1, 2, 3], attempts: 5, status: "dead" }]);
    expect(goneQuiet).toEqual([1, 2, 3]);
  });

  it("is quiet until the attempts actually run out", () => {
    const { groups, goneQuiet } = settleBatch(rows(1, 7), false, 5);
    expect(groups).toEqual([{ ids: [7], attempts: 2, status: "failed" }]);
    expect(goneQuiet).toEqual([]);
  });

  it("keeps each row's own attempts count when a batch is not uniform", () => {
    // The WhatsApp-to-email fallback can put a row with its own history beside fresh ones.
    const { groups, goneQuiet } = settleBatch([...rows(4, 1), ...rows(0, 2)], false, 5);
    expect(groups).toEqual([
      { ids: [1], attempts: 5, status: "dead" },
      { ids: [2], attempts: 1, status: "failed" },
    ]);
    expect(goneQuiet).toEqual([1]);
  });

  it("never gives up on a send that worked", () => {
    const { groups, goneQuiet } = settleBatch(rows(9, 1), true, 5);
    expect(groups[0].status).toBe("sent");
    expect(goneQuiet).toEqual([]);
  });
});
