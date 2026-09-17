import { describe, expect, it } from "vitest";
import { callablePeople } from "@/lib/calls/callable";

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
