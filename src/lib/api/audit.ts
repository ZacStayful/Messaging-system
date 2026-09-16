import type { ApiClient, ApiKeyContext } from "./auth";

/**
 * Records that something was changed through the API or the MCP server.
 *
 * `audit_log.actor_type` has documented `api_key` since the first migration, but nothing wrote
 * it: the rows the SQL RPCs write carry the column's `'user'` default, so an API write was
 * indistinguishable from someone clicking in the app. This is the piece that tells them apart.
 *
 * Written through the caller's own client, so the existing insert policy
 * ("audit: anyone records their own actions", which requires `actor_id = auth.uid()`) applies
 * with no change. Best-effort by design: a failed audit insert must not fail the request the
 * caller actually made, so it is logged and swallowed.
 */
export async function logApiCall(
  db: ApiClient,
  ctx: ApiKeyContext,
  entry: { action: string; entity: string; entity_id?: string | null; diff?: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    org_id: ctx.orgId,
    actor_id: ctx.userId,
    actor_type: "api_key",
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entity_id ?? null,
    diff: { ...(entry.diff ?? {}), key_id: ctx.keyId, key_name: ctx.keyName },
  });
  if (error) console.error("[api] audit insert failed", entry.action, error.message);
}
