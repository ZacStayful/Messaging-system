import { describe, expect, it } from "vitest";
import { isItemCreated, normaliseMondayEvent, type MondayItemEvent } from "@/lib/monday/webhook";

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
