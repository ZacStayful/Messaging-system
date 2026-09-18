import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The rate limiter's three answers, and in particular the one it used not to have.
 *
 * The old code was `const { data: withinLimit } = await admin.rpc(...)` followed by
 * `if (withinLimit === false)`. postgrest-js resolves `{ data: null, error }` rather than
 * throwing, so every database failure produced `null`, and `null === false` is false: the
 * request went through. The limiter turned itself off exactly while the database was struggling,
 * which is the one time anything depends on it.
 *
 * These mock the admin client rather than the database, because what is being tested is how a
 * failed check is interpreted, not what Postgres does with a counter.
 */

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

const { checkRateLimit } = await import("@/lib/api/rateLimit");

afterEach(() => {
  rpc.mockReset();
  vi.restoreAllMocks();
});

describe("checkRateLimit", () => {
  it("passes a request under the limit", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkRateLimit("key-1")).toBe("ok");
  });

  it("refuses a request over the limit", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkRateLimit("key-1")).toBe("over");
  });

  // The regression. A statement timeout, an unapplied migration, a deadlock on the upsert or an
  // exhausted pool all arrive here as an error alongside a null result.
  it("refuses when the check itself failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "canceling statement due to statement timeout" } });
    expect(await checkRateLimit("key-1")).toBe("unavailable");
  });

  it("refuses when the answer is not a verdict", async () => {
    // A null with no error is not a "yes". It used to be treated as one.
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await checkRateLimit("key-1")).toBe("unavailable");
    rpc.mockResolvedValue({ data: undefined, error: null });
    expect(await checkRateLimit("key-1")).toBe("unavailable");
  });

  it("refuses when the call throws outright", async () => {
    // Used to escape as an unhandled rejection: the call sat outside the route's try block.
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockRejectedValue(new Error("fetch failed"));
    expect(await checkRateLimit("key-1")).toBe("unavailable");
  });

  it("says why, so an operator is not left guessing at a 429", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await checkRateLimit("key-1");
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]?.join(" "))).toContain("boom");
  });
});
