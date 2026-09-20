/**
 * One recovery at a time, and not too often.
 *
 * Every recovery path in the app is triggered by the same thing: a Supabase channel reporting
 * SUBSCRIBED again after a drop. That is not a tidy signal. The hook fires it on *every*
 * SUBSCRIBED after the first, two channels on one transport both report, and a flapping
 * connection reports over and over — so the callback has to be safe to invoke far more often
 * than the work behind it is worth doing.
 *
 * Extracted from ConversationView, which had this inline, because the store needs the identical
 * rule for the sidebar and a second hand-written copy is a copy that drifts.
 *
 * The one behaviour worth stating outright, because it is the reason this holds a promise rather
 * than firing and forgetting: **a failed run does not start the clock.** The whole premise of a
 * recovery path is a connection that is not working, so the run itself is the thing most likely
 * to fail — and if a failure counted as a recovery, the next reconnect would be told to wait and
 * the client would stay stale for exactly as long as the trouble lasted. A failure leaves the
 * guard as it found it, so the next SUBSCRIBED tries again immediately.
 */

/**
 * A reconnect is a human-scale event; the floor only has to stop a flapping socket hammering it.
 * Shared by the conversation view and the shell so the two recoveries pace the same.
 */
export const RECOVER_MIN_INTERVAL_MS = 5_000;

export interface RecoveryGuardOptions {
  /** Minimum gap between two *completed* recoveries. A reconnect is a human-scale event. */
  minIntervalMs: number;
  /** Names this guard in the log line when a run fails. */
  label: string;
}

/**
 * Returns a function that takes the work to do and runs it at most once at a time, and at most
 * once per interval. The work is passed per call rather than captured once, so a React caller
 * can hand over a fresh closure on every render while the guard itself stays stable.
 *
 * The returned promise never rejects: callers are status callbacks with nowhere to put an error,
 * and `void guard(...)` at the call site would otherwise be an unhandled rejection on every
 * failed reconnect. The failure is logged and the clock is left alone instead.
 */
export function makeRecoveryGuard({
  minIntervalMs,
  label,
}: RecoveryGuardOptions): (run: () => Promise<void>) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let lastSucceededAt = 0;

  return function recover(run: () => Promise<void>): Promise<void> {
    // Two channels reporting SUBSCRIBED at once should do the work once, and both should be able
    // to await the same answer.
    if (inFlight) return inFlight;
    if (lastSucceededAt && Date.now() - lastSucceededAt < minIntervalMs) return Promise.resolve();

    const attempt = (async () => {
      try {
        await run();
        lastSucceededAt = Date.now();
      } catch (e) {
        console.error(`[realtime] ${label} recovery failed`, e instanceof Error ? e.message : e);
      } finally {
        inFlight = null;
      }
    })();
    inFlight = attempt;
    return attempt;
  };
}
