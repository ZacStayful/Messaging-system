import { describe, expect, it } from "vitest";
import { serverHighWaterMark } from "@/lib/realtime/highWaterMark";

/**
 * The bound on the catch-up query after a dropped socket. Getting it wrong forwards means
 * messages are never fetched at all — silently, with no error and no empty state, because
 * `gt(created_at, since)` simply returns nothing and the conversation appears to stop.
 */
describe("serverHighWaterMark", () => {
  const row = (created_at: string) => ({ created_at });
  const sending = (created_at: string) => ({ created_at, _status: "sending" as const });
  const failed = (created_at: string) => ({ created_at, _status: "failed" as const });

  it("is the newest server timestamp", () => {
    expect(serverHighWaterMark([row("2026-01-01T10:00:00Z"), row("2026-01-01T10:05:00Z")])).toBe(
      "2026-01-01T10:05:00Z",
    );
  });

  it("ignores a message still being sent", () => {
    // Optimistic rows carry the browser's clock and are appended last, so .at(-1) used to pick
    // one up during every send.
    expect(serverHighWaterMark([row("2026-01-01T10:00:00Z"), sending("2026-01-01T10:05:00Z")])).toBe(
      "2026-01-01T10:00:00Z",
    );
  });

  // The one that made this permanent rather than momentary: a failed send is never removed from
  // the list, so on a clock running fast the bound stayed minutes in the future for the life of
  // the component and the client silently stopped receiving anything.
  it("ignores a send that failed and was left in place", () => {
    const rows = [row("2026-01-01T10:00:00Z"), failed("2026-06-01T10:00:00Z")];
    expect(serverHighWaterMark(rows)).toBe("2026-01-01T10:00:00Z");
  });

  it("does not assume the rows are sorted", () => {
    // They arrive by upsert as well as by append, so taking the last element is an assumption
    // this does not need to make.
    expect(serverHighWaterMark([row("2026-01-01T10:05:00Z"), row("2026-01-01T10:00:00Z")])).toBe(
      "2026-01-01T10:05:00Z",
    );
  });

  it("is undefined when there is nothing the server has acknowledged", () => {
    // An unbounded back-fill is correct here: fetch the conversation rather than nothing.
    expect(serverHighWaterMark([])).toBeUndefined();
    expect(serverHighWaterMark([sending("2026-01-01T10:00:00Z")])).toBeUndefined();
  });
});
