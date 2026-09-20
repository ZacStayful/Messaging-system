import { describe, expect, it } from "vitest";
import { isItemCreated, normaliseMondayEvent, type MondayItemEvent } from "@/lib/monday/webhook";
import { isUnfinished } from "@/lib/monday/provision";

const event = (raw: unknown): MondayItemEvent => {
  const parsed = normaliseMondayEvent(raw);
  if (parsed.kind !== "event") throw new Error(`expected an event, got ${parsed.kind}`);
  return parsed;
};

describe("normaliseMondayEvent", () => {
  it("echoes the URL-verification challenge", () => {
    // Monday sends this once when the webhook is saved. Miss it and the webhook is never
    // created at all, which looks exactly like the integration silently not working.
    expect(normaliseMondayEvent({ challenge: "abc123" })).toEqual({ kind: "challenge", challenge: "abc123" });
  });

  it("reads a create_item delivery", () => {
    const parsed = event({
      event: {
        type: "create_item",
        triggerUuid: "7f1c",
        boardId: 4972230367,
        pulseId: 12975841587,
        pulseName: "Rohana Bakhshi",
        groupId: "topics",
      },
    });
    expect(parsed).toMatchObject({
      eventId: "7f1c",
      // Numbers, not strings, on the wire — everything downstream compares these as text.
      boardId: "4972230367",
      itemId: "12975841587",
      type: "create_item",
      groupId: "topics",
      itemName: "Rohana Bakhshi",
    });
  });

  it("reads the older create_pulse shape and a nested group", () => {
    const parsed = event({
      event: { type: "create_pulse", pulse_id: 42, board_id: 7, group: { id: "new_group" } },
    });
    expect(parsed.itemId).toBe("42");
    expect(parsed.groupId).toBe("new_group");
    expect(isItemCreated(parsed)).toBe(true);
  });

  it("tolerates a flat body with no event wrapper", () => {
    expect(event({ type: "create_item", pulseId: 9 }).itemId).toBe("9");
  });

  it("does not treat a column change as a new client", () => {
    const parsed = event({ event: { type: "change_column_value", pulseId: 9, boardId: 1 } });
    expect(isItemCreated(parsed)).toBe(false);
  });

  it("returns unknown for junk rather than inventing an item", () => {
    expect(normaliseMondayEvent(null).kind).toBe("unknown");
    expect(normaliseMondayEvent({ hello: "world" }).kind).toBe("unknown");
    expect(normaliseMondayEvent("not an object").kind).toBe("unknown");
    // An empty challenge is not a challenge; answering it would fail verification anyway.
    expect(normaliseMondayEvent({ challenge: "" }).kind).toBe("unknown");
  });
});

describe("isUnfinished — which recorded outcome means a delivery never finished", () => {
  it("treats a delivery that was only recorded as still owing the work", () => {
    // The row is written before provisioning, and the unique index on event_id makes every
    // redelivery stop at that write. Recording 'created' there meant a run killed in between
    // left a customer who was never set up and a row claiming they were, for ever.
    expect(isUnfinished("received")).toBe(true);
  });

  it("treats every terminal outcome as done, so a redelivery does not provision twice", () => {
    for (const outcome of [
      "created",
      "duplicate",
      "skipped_disabled",
      "skipped_board",
      "skipped_group",
      "skipped_event",
      "no_address",
      "not_configured",
      "error",
    ]) {
      expect(isUnfinished(outcome)).toBe(false);
    }
  });

  it("defaults to done for anything it has never heard of", () => {
    // A new outcome is terminal until someone decides otherwise here. Getting this backwards
    // would provision a second time, which is the worse mistake of the two.
    expect(isUnfinished("something_new")).toBe(false);
    expect(isUnfinished(null)).toBe(false);
    expect(isUnfinished(undefined)).toBe(false);
  });
});
