import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Requests per key per minute. Generous for real use, low enough to notice a runaway loop.
 *
 * Since 0040 these describe a token bucket rather than a fixed window, and the pair is read two
 * ways: RATE_LIMIT is both the sustained allowance per RATE_WINDOW_SECONDS *and* the size of the
 * bucket, so a key that has been idle can still spend the whole allowance at once — which is what
 * the fixed window allowed, so clients that batch are unaffected — while a key that keeps going
 * settles at RATE_LIMIT / RATE_WINDOW_SECONDS requests a second and can no longer double its
 * allowance by straddling a window boundary.
 */
export const RATE_LIMIT = 600;
export const RATE_WINDOW_SECONDS = 60;

export type RateVerdict = "ok" | "over" | "unavailable";

/**
 * Does this key have a token to spend?
 *
 * One definition, called by both the REST surface and the MCP server. They had a byte-identical
 * copy each, which is how they had already drifted: the same over-limit condition answered 429
 * in one and 401 in the other.
 *
 * **It fails closed.** The previous version destructured the error away —
 * `const { data: withinLimit } = await admin.rpc(...)` — and postgrest-js resolves
 * `{ data: null, error }` rather than throwing, so a statement timeout, an unapplied migration,
 * a deadlock on the upsert or an exhausted connection pool all produced `null`. The test was
 * `=== false`, so `null` sailed through: the limiter switched itself off for precisely as long
 * as the database was struggling, silently, which is the one time it is load-bearing.
 *
 * Returning "unavailable" rather than throwing keeps the decision with the caller, because the
 * two surfaces answer it differently, and makes the third state impossible to ignore by
 * accident the way a nullable boolean was.
 */
export async function checkRateLimit(keyId: string): Promise<RateVerdict> {
  // One call, one transaction, which is what the bucket's refill depends on: now() is frozen
  // inside a transaction, so several calls batched into one would measure the same instant and
  // earn nothing between them. That errs strict rather than permissive, and no caller does it.
  const admin = createAdminClient();
  // No service role means no counter. Unreachable through either caller today, since both
  // authenticate the key through the same client first — but "unreachable" is not a reason to
  // answer "ok" to a question we cannot answer.
  if (!admin) {
    console.error("[rate-limit] SUPABASE_SERVICE_ROLE_KEY is not set; cannot count requests");
    return "unavailable";
  }

  try {
    const { data, error } = await admin.rpc("api_rate_hit", {
      p_key_id: keyId,
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (error) {
      console.error("[rate-limit] api_rate_hit failed:", error.message);
      return "unavailable";
    }
    // The RPC returns false when over. Anything that is not a boolean is not an answer.
    if (typeof data !== "boolean") {
      console.error("[rate-limit] api_rate_hit returned no verdict");
      return "unavailable";
    }
    return data ? "ok" : "over";
  } catch (e) {
    // A genuine rejection — DNS, TLS, the network. This used to escape as an unhandled rejection
    // because the call sat outside the route's try block, surfacing as an opaque 500.
    console.error("[rate-limit] api_rate_hit threw:", e instanceof Error ? e.message : e);
    return "unavailable";
  }
}

/** What to tell someone who has been turned away. Shared so the two surfaces word it alike. */
export const RATE_LIMITED_MESSAGE = `More than ${RATE_LIMIT} requests in a minute. Slow down and retry.`;
export const RATE_UNAVAILABLE_MESSAGE = "Rate limiting is temporarily unavailable. Retry shortly.";
