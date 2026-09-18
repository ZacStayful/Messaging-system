/**
 * A fetch that gives up.
 *
 * The first timeout in this codebase: nothing in src/lib or src/app used AbortController,
 * AbortSignal, Promise.race or setTimeout before this. Every outbound call to Resend and to
 * TimelinesAI was a bare fetch, and undici applies no overall response deadline — so a provider
 * that accepts the connection and then stalls holds the await until the platform kills the
 * function.
 *
 * That is expensive in the notification drain specifically. It runs on a per-minute cron with
 * maxDuration 60, and every row it has claimed sits in `status='sending'` until the stranded-
 * claim rescue returns it ten minutes later. One hung provider call therefore delays up to two
 * hundred notifications by ten minutes, and the rescue cannot tell "never sent" from "sent, but
 * the bookkeeping never landed".
 *
 * Deliberately returns rather than throws on timeout, matching what both senders already do with
 * a failed request: they answer `{ ok: false, error }` so the caller records the failure and
 * moves on. A timeout is just another kind of failed send.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export class RequestTimeoutError extends Error {
  constructor(ms: number) {
    super(`No response within ${ms}ms`);
    this.name = "RequestTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // AbortSignal.timeout rather than a hand-rolled controller plus setTimeout: no timer to clear,
  // so there is no way to leak one on an early return, and it is not held open by the event loop.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetch(input, { ...init, signal });
  } catch (e) {
    // An aborted fetch rejects with a TimeoutError DOMException, which says nothing useful in a
    // log line. Anything else — DNS, TLS, a reset — is passed through as it was.
    if (e instanceof DOMException && e.name === "TimeoutError") throw new RequestTimeoutError(timeoutMs);
    throw e;
  }
}
