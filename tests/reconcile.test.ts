import { describe, expect, it } from "vitest";
import { pinKey, reactionKey, reconcile } from "@/lib/realtime/reconcile";

/**
 * What recovery does with the rows it just re-read. The rule this replaces was additive — it
 * kept every prior row not present in the new set — so it could express an addition and a change
 * but never a removal. A reaction taken off a message while the socket was down survived for
 * ever, and no amount of fetching more rows fixes that.
 */
describe("reconcile", () => {
  const byId = (r: { id: string }) => r.id;

  it("takes the server's rows", () => {
    const previous = [{ id: "a" }, { id: "b" }];
    const fetched = [{ id: "a" }, { id: "c" }];
    expect(reconcile(previous, fetched, byId).map(byId)).toEqual(["a", "c"]);
  });

  // The whole point. "b" is gone server-side and must disappear locally.
  it("removes what the server no longer has", () => {
    expect(reconcile([{ id: "a" }, { id: "b" }], [{ id: "a" }], byId).map(byId)).toEqual(["a"]);
  });

  it("replaces a changed row rather than keeping both", () => {
    const out = reconcile([{ id: "a", body: "old" }], [{ id: "a", body: "new" }], byId);
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe("new");
  });

  // A send still in flight is something the server has not been told about, so its absence from
  // the fetch means nothing. Dropping it would make the person's own message vanish as they sent it.
  it("keeps a row that is still being written", () => {
    const previous = [{ id: "a" }, { id: "tmp-1", _status: "sending" }];
    expect(reconcile(previous, [{ id: "a" }], byId).map(byId)).toEqual(["a", "tmp-1"]);
  });

  it("keeps a send that failed and is waiting to be retried", () => {
    const previous = [{ id: "tmp-2", _status: "failed" }];
    expect(reconcile(previous, [], byId).map(byId)).toEqual(["tmp-2"]);
  });

  it("drops a pending row once its server copy arrives", () => {
    // Otherwise the message shows twice for the instant before the optimistic row is matched.
    const previous = [{ id: "m-1", _status: "sending" }];
    const out = reconcile(previous, [{ id: "m-1" }], byId);
    expect(out).toHaveLength(1);
    expect((out[0] as { _status?: unknown })._status).toBeUndefined();
  });

  it("handles both sides being empty", () => {
    expect(reconcile([], [], byId)).toEqual([]);
  });
});

describe("keys", () => {
  it("keys a reaction on all three of its primary key columns", () => {
    // reactions has no id: the PK is (message_id, user_id, emoji). Keying on message_id alone
    // would make two people's reactions to one message collapse into one.
    const a = { message_id: "m", user_id: "u1", emoji: "👍" };
    const b = { message_id: "m", user_id: "u2", emoji: "👍" };
    const c = { message_id: "m", user_id: "u1", emoji: "🎉" };
    expect(new Set([reactionKey(a), reactionKey(b), reactionKey(c)]).size).toBe(3);
    expect(reactionKey(a)).toBe(reactionKey({ ...a }));
  });

  it("keys a pin on its message", () => {
    expect(pinKey({ message: { id: "m-1" } })).toBe("m-1");
  });
});

/**
 * The old rule, kept here only to show what it could not do. If this ever starts passing the
 * additive merge has come back somewhere.
 */
describe("the additive merge this replaced", () => {
  const additive = <T extends { id: string }>(previous: T[], fetched: T[]) => [
    ...previous.filter((p) => !fetched.some((f) => f.id === p.id)),
    ...fetched,
  ];

  it("could not express a deletion", () => {
    expect(additive([{ id: "a" }, { id: "b" }], [{ id: "a" }]).map((r) => r.id)).toEqual(["b", "a"]);
    expect(reconcile([{ id: "a" }, { id: "b" }], [{ id: "a" }], (r) => r.id).map((r) => r.id)).toEqual(["a"]);
  });
});
