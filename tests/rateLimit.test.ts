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

const { checkRateLimit, RATE_LIMIT, RATE_WINDOW_SECONDS, retryAfterSeconds, secondsPerToken } =
  await import("@/lib/api/rateLimit");

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

/**
 * What a turned-away client is told to do next.
 *
 * `retry-after` used to be a whole window for both verdicts, which was the honest answer under the
 * fixed window 0040 replaced — you really did have to wait for the next one. Against a bucket that
 * refills continuously it parks a well-behaved client for a minute when a tenth of a second would
 * do, which is the opposite of what a limiter wants: a client that backs off correctly should be
 * able to settle at the sustained rate, not be punished for having hit the edge once.
 */
describe("secondsPerToken", () => {
  it("is one second at the configured rate", () => {
    // 600 a minute is ten tokens a second, so a token is always less than a second away.
    expect(secondsPerToken(RATE_LIMIT, RATE_WINDOW_SECONDS)).toBe(1);
  });

  it("grows as the limit falls", () => {
    // The point of deriving it: a tighter limit means a longer wait, with nothing to remember to
    // change by hand.
    expect(secondsPerToken(10, 60)).toBe(6);
    expect(secondsPerToken(1, 60)).toBe(60);
  });

  it("never drops below a second", () => {
    // `retry-after` is whole seconds, so 0 would read as "immediately" and invite a hot loop.
    expect(secondsPerToken(6000, 60)).toBe(1);
    expect(secondsPerToken(1_000_000, 1)).toBe(1);
  });

  it("rounds up rather than down", () => {
    // Rounding down would send the client back a fraction early, to be refused again.
    expect(secondsPerToken(7, 60)).toBe(9); // 8.57… seconds per token
  });
});

describe("retryAfterSeconds", () => {
  it("offers a token's wait to a client that is simply too fast", () => {
    expect(retryAfterSeconds("over")).toBe(1);
  });

  it("backs a client well off when the limiter itself is unavailable", () => {
    // Not a statement about tokens at all: the limiter could not reach the database, and pointing
    // a retry storm at one that is already struggling is the thing a limiter exists to prevent.
    expect(retryAfterSeconds("unavailable")).toBe(RATE_WINDOW_SECONDS);
    expect(retryAfterSeconds("unavailable")).toBeGreaterThan(retryAfterSeconds("over"));
  });
});
