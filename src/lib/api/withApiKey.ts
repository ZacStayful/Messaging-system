import { NextResponse } from "next/server";
import type { Scope } from "./keys";
import { NotConfiguredError, jwtConfigured } from "./jwt";
import { verifyApiKey, userClient, type ApiClient, type ApiKeyContext } from "./auth";
import { ApiError, fail } from "./respond";
import { createAdminClient } from "@/lib/supabase/admin";

/** Requests per key per minute. Generous for real use, low enough to notice a runaway loop. */
const RATE_LIMIT = 600;
const RATE_WINDOW_SECONDS = 60;

export interface ApiHandlerArgs {
  request: Request;
  ctx: ApiKeyContext;
  /** Acts as the key's user, so RLS applies. */
  db: ApiClient;
  params: Record<string, string>;
}

type Handler = (args: ApiHandlerArgs) => Promise<NextResponse>;

interface Options {
  /** Every scope the route needs; all must be present on the key. */
  scopes: Scope[];
  /** Routes that only make sense for a Stayful team account (creating groups, inviting). */
  team?: boolean;
}

/**
 * Wraps a route handler with key verification, scope checking, rate limiting and one
 * consistent error shape. Shared with the MCP server, so the two surfaces cannot end up
 * authenticating differently.
 */
export function withApiKey(handler: Handler, options: Options) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    let ctx: ApiKeyContext | null;
    try {
      ctx = await verifyApiKey(request);
    } catch (e) {
      console.error("[api] key verification failed", e);
      return fail("internal", "The request could not be authenticated.");
    }

    if (!ctx) {
      return fail("unauthorized", "Provide a valid API key as `Authorization: Bearer <key>`.", undefined, {
        headers: { "www-authenticate": 'Bearer realm="stayful"' },
      });
    }

    const missing = options.scopes.filter((s) => !ctx!.scopes.includes(s));
    if (missing.length) {
      return fail("insufficient_scope", `This key is missing the ${missing.join(", ")} scope.`, { missing });
    }
    if (options.team && ctx.profile.account_type !== "team") {
      return fail("forbidden", "This endpoint is only available to keys acting as a Stayful team member.");
    }

    const admin = createAdminClient();
    if (admin) {
      const { data: withinLimit } = await admin.rpc("api_rate_hit", {
        p_key_id: ctx.keyId,
        p_limit: RATE_LIMIT,
        p_window_seconds: RATE_WINDOW_SECONDS,
      });
      if (withinLimit === false) {
        return fail("rate_limited", `More than ${RATE_LIMIT} requests in a minute. Slow down and retry.`, undefined, {
          headers: { "retry-after": String(RATE_WINDOW_SECONDS) },
        });
      }
      void admin.rpc("api_touch_key", { p_key_id: ctx.keyId });
    }

    // Checked up front rather than caught: supabase-js invokes the accessToken callback inside
    // its own promise chain with a .catch(), so a NotConfiguredError thrown there would be
    // swallowed and resurface as an opaque failure on the first query instead of this 503.
    if (!jwtConfigured()) {
      console.error("[api] SUPABASE_JWT_SECRET is not set; the API cannot act as a user");
      return fail("not_configured", "The API is not configured on this deployment. Set SUPABASE_JWT_SECRET.");
    }
    const db: ApiClient = userClient(ctx);

    try {
      const params = await context.params;
      return await handler({ request, ctx, db, params: params ?? {} });
    } catch (e) {
      return mapError(e);
    }
  };
}

/**
 * Turns whatever went wrong into an honest status code. Postgres and PostgREST already carry
 * the useful detail, so a policy refusal or a raised exception is passed through rather than
 * flattened into a generic 500 — but a genuinely unexpected error is logged and answered with
 * a generic message, because its text may contain more than the caller should see.
 */
function mapError(e: unknown): NextResponse {
  if (e instanceof ApiError) return fail(e.code, e.message, e.details);
  if (e instanceof NotConfiguredError) {
    return fail("not_configured", "The API is not configured on this deployment. Set SUPABASE_JWT_SECRET.");
  }

  const err = e as { code?: string; message?: string } | null;
  const message = err?.message ?? "";
  // 42501 = insufficient_privilege, which is what an RLS refusal looks like from PostgREST.
  if (err?.code === "42501" || /not allowed|row-level security/i.test(message)) {
    return fail("forbidden", message || "You do not have access to that.");
  }
  if (err?.code === "23505") return fail("conflict", message || "That already exists.");
  if (err?.code === "PGRST116") return fail("not_found", "Not found.");

  console.error("[api] unhandled error", e);
  return fail("internal", "Something went wrong handling that request.");
}
