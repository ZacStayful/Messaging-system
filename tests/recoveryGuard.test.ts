import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRecoveryGuard } from "@/lib/realtime/recoveryGuard";

/**
 * The rule that stops a flapping socket turning every reconnect into a round of queries — and,
 * more importantly, the rule that makes sure a reconnect that *failed* is tried again.
 *
 * This is why recovery awaits its work instead of firing and forgetting. A fire-and-forget
 * refresh cannot coalesce two channels reporting at once, and cannot tell a failure from a
 * success, so it would have to start the clock either way and leave the client stale for the
 * length of the interval precisely when the connection is unreliable.
 */
describe("makeRecoveryGuard", () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the first call", async () => {
    const run = vi.fn(async () => {});
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    await guard(run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("coalesces calls made while a run is in flight", async () => {
    // Both channels of a conversation report SUBSCRIBED on the same reconnect. The work should
    // happen once, and both callers should be able to await the same answer.
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    const first = guard(run);
    const second = guard(run);
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips a call made inside the interval", async () => {
    const run = vi.fn(async () => {});
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    await guard(run);
    vi.advanceTimersByTime(4_999);
    await guard(run);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again once the interval has passed", async () => {
    const run = vi.fn(async () => {});
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    await guard(run);
    vi.advanceTimersByTime(5_000);
    await guard(run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  /**
   * The case a fire-and-forget refresh cannot express, and the reason this file exists.
   *
   * Recovery runs because the connection just failed, so the recovery query is the one most
   * likely to fail too. If that counted as a recovery, the next reconnect would be told to wait
   * and the client would stay stale for exactly as long as the trouble lasted.
   */
  it("does not start the clock when the run fails", async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    await guard(run);
    // No time passes at all: the retry must not be rate-limited by the failure.
    await guard(run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("resolves rather than rejecting when the run fails", async () => {
    // Callers are status callbacks with nowhere to put an error; `void guard(...)` on a rejecting
    // promise would be an unhandled rejection on every failed reconnect.
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "sidebar" });

    await expect(
      guard(async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith("[realtime] sidebar recovery failed", "offline");
  });

  it("measures the interval from when the run finished, not when it started", async () => {
    // A slow recovery on a bad connection should not immediately be eligible to run again.
    const gate = deferred();
    const slow = vi.fn(() => gate.promise);
    const fast = vi.fn(async () => {});
    const guard = makeRecoveryGuard({ minIntervalMs: 5_000, label: "test" });

    const first = guard(slow);
    vi.advanceTimersByTime(6_000);
    gate.resolve();
    await first;

    await guard(fast);
    expect(fast).not.toHaveBeenCalled();
  });
});
