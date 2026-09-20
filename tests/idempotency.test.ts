import { afterEach, describe, expect, it, vi } from "vitest";
import { keyForBatch, outboxIdempotencyKey } from "@/lib/notifications/idempotency";

/**
 * The key that stops a crashed run sending the same email twice. Resend keeps it for 24 hours and
 * replays the original response, so the properties that matter are: the same batch always
 * produces the same key, a different batch never does, and it fits in 256 characters.
 */
describe("outboxIdempotencyKey", () => {
  it("is the same for the same rows", () => {
    expect(outboxIdempotencyKey([3, 1, 2])).toBe(outboxIdempotencyKey([3, 1, 2]));
  });

  it("does not depend on the order they were grouped in", () => {
    // A batch is the same batch however it was assembled, and grouping order is not something
    // worth depending on.
    expect(outboxIdempotencyKey([1, 2, 3])).toBe(outboxIdempotencyKey([3, 2, 1]));
  });

  it("differs when the batch differs", () => {
    // Reusing a key with a changed payload is an error at Resend, not a no-op, so a batch that
    // gained a message must not reuse the old key.
    expect(outboxIdempotencyKey([1, 2])).not.toBe(outboxIdempotencyKey([1, 2, 3]));
    expect(outboxIdempotencyKey([1])).not.toBe(outboxIdempotencyKey([2]));
  });

  it("fits inside Resend's 256-character limit for a batch of any size", () => {
    const huge = Array.from({ length: 5000 }, (_, i) => i);
    expect(outboxIdempotencyKey(huge).length).toBeLessThanOrEqual(256);
    expect(outboxIdempotencyKey([1]).length).toBeLessThanOrEqual(256);
  });

  it("is namespaced, so nothing else sending through the account can collide", () => {
    expect(outboxIdempotencyKey([1])).toMatch(/^stayful-outbox-[0-9a-f]{64}$/);
  });
});

/**
 * Resend answers 409 in two situations that mean opposite things, and treating them alike would
 * either lose an email or send it twice.
 */
describe("sendEmail idempotency responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  const load = async () => (await import("@/lib/email/resend")).sendEmail;
  const message = { to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" };

  it("sends the key when one is given", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "e1" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await (
      await load()
    )({ ...message, idempotencyKey: "stayful-outbox-abc" });
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("stayful-outbox-abc");
  });

  it("treats a replayed key as sent, not failed", async () => {
    // invalid_idempotent_request: the email went out on an earlier attempt and something has
    // since changed — usually the Reply-To, which is minted fresh per notification since 0036.
    // The recipient has the first one and it carries a working token.
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ name: "invalid_idempotent_request" }, { status: 409 })),
    );
    const res = await (await load())({ ...message, idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: true, duplicate: true });
  });

  it("treats a concurrent send as neither sent nor failed", async () => {
    // Burning an attempt here would be wrong: nobody knows the outcome yet.
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ name: "concurrent_idempotent_requests" }, { status: 409 })),
    );
    const res = await (await load())({ ...message, idempotencyKey: "k" });
    expect(res.ok).toBe(false);
    expect(res.inFlight).toBe(true);
  });

  it("still reports an ordinary failure as a failure", async () => {
    process.env.RESEND_API_KEY = "re_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "nope" }, { status: 422 })));
    const res = await (await load())({ ...message, idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, error: "nope" });
    expect(res.duplicate).toBeUndefined();
  });
});

describe("keyForBatch — the key a batch actually goes out under", () => {
  const row = (id: number, key?: string) => ({ id, ...(key ? { idempotency_key: key } : {}) });

  it("hashes the ids when nothing in the batch has been dispatched", () => {
    expect(keyForBatch([row(1), row(2)])).toBe(outboxIdempotencyKey([1, 2]));
  });

  it("reuses the key a dispatched row already carries", () => {
    expect(keyForBatch([row(101, "stayful-outbox-abc")])).toBe("stayful-outbox-abc");
  });

  it("gives a stranded remnant the same key the whole batch was sent under", () => {
    // The bug in one assertion. Rows 101 and 102 go out together; finish() marks 101 sent and
    // the run dies; ten minutes later only 102 is selectable. Hashing that remnant produces a
    // key Resend has never seen, and the recipient reads the message twice.
    const original = keyForBatch([row(101), row(102)]);
    const remnant = keyForBatch([row(102, original)]);
    expect(remnant).toBe(original);
    expect(remnant).not.toBe(outboxIdempotencyKey([102]));
  });

  it("ignores a key that is only whitespace", () => {
    expect(keyForBatch([row(1, "   ")])).toBe(outboxIdempotencyKey([1]));
  });
});
