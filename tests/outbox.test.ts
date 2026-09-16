import { describe, expect, it } from "vitest";
import { groupOutboxRows, skipReason, type RecipientPrefs } from "@/lib/notifications/policy";

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
});
