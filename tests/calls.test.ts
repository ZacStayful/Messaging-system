import { describe, expect, it } from "vitest";
import { callablePeople } from "@/lib/calls/callable";
import { cutoff, DEFAULT_RETENTION_DAYS, retentionDays } from "@/lib/calls/retention";

/**
 * Whether a Call button appears, and next to whose name. Every case here is one that is easy to
 * get wrong and awkward to discover by hand, because discovering it means a real telephone rings.
 */
describe("callablePeople", () => {
  const me = { id: "me", phone: "+447700900001" };
  const marta = { id: "marta", phone: "+447700900002" };
  const dave = { id: "dave", phone: "+447700900003" };
  const noPhone = { id: "sam", phone: null };
  const gone = { id: "old", phone: "+447700900004", deactivated_at: "2026-01-01T00:00:00Z" };

  const on = { configured: true, isTeam: true };

  it("offers the other members who have a mobile", () => {
    expect(callablePeople([me, marta, dave], "me", on).map((p) => p.id)).toEqual(["marta", "dave"]);
  });

  it("never offers me", () => {
    // Dialling your own mobile from your own browser is a feedback loop, and Twilio bills for it.
    expect(callablePeople([me], "me", on)).toEqual([]);
  });

  it("skips anyone with no number on file", () => {
    // start_call raises 'there is no mobile number for …' — correct, but a button that always
    // fails is a worse answer than no button.
    expect(callablePeople([me, noPhone], "me", on)).toEqual([]);
  });

  it("skips a deactivated account", () => {
    // Their number may well have been reassigned to a stranger by now.
    expect(callablePeople([me, gone], "me", on)).toEqual([]);
  });

  it("shows nothing when calling is not configured", () => {
    expect(callablePeople([me, marta], "me", { configured: false, isTeam: true })).toEqual([]);
  });

  it("shows nothing to a customer", () => {
    // Pressing it would place a real, billable call from a number Stayful is responsible for.
    expect(callablePeople([me, marta], "me", { configured: true, isTeam: false })).toEqual([]);
  });

  it("keeps member order, so the menu is stable between renders", () => {
    expect(callablePeople([dave, marta], "me", on).map((p) => p.id)).toEqual(["dave", "marta"]);
  });
});

/**
 * The window before audio of a real conversation is deleted. Every case here is about the same
 * thing: this job's failure mode is deleting, so a mistake must never widen the sweep.
 */
describe("retentionDays", () => {
  it("is six months when nothing is set", () => {
    expect(retentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays("")).toBe(180);
    expect(retentionDays("   ")).toBe(180);
  });

  it("takes a number from the environment", () => {
    expect(retentionDays("90")).toBe(90);
    expect(retentionDays("30")).toBe(30);
  });

  it("allows zero, which is how the sweep is exercised in a test", () => {
    expect(retentionDays("0")).toBe(0);
  });

  it("falls back to the default on anything unreadable, never to zero", () => {
    // A typo in a Vercel env var must not silently become "delete everything tonight".
    for (const bad of ["ninety", "-1", "NaN", "1e", "∞"]) {
      expect(retentionDays(bad), bad).toBe(DEFAULT_RETENTION_DAYS);
    }
  });

  it("does not take a fractional day", () => {
    expect(retentionDays("90.7")).toBe(90);
  });
});

describe("cutoff", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  it("is the retention window back from now", () => {
    expect(cutoff(now, 180).toISOString()).toBe("2026-03-21T12:00:00.000Z");
    expect(cutoff(now, 30).toISOString()).toBe("2026-08-18T12:00:00.000Z");
  });

  it("with a window of zero is now, so everything is already expired", () => {
    expect(cutoff(now, 0).toISOString()).toBe(now.toISOString());
  });

  it("crosses a daylight-saving boundary without drifting", () => {
    // UK clocks go back on 25 October 2026. The window is counted in absolute time rather than
    // calendar days, so the cutoff does not wobble by an hour twice a year.
    expect(cutoff(new Date("2026-11-01T12:00:00.000Z"), 30).toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });
});
