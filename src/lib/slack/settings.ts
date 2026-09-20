import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

export const SLACK_INTEGRATION_KEY = "slack";

/** Channel names that are test rooms, never worth importing. Matched as whole slugs, case-insensitively. */
export const DEFAULT_SKIP_NAME_PATTERNS = ["test", "example-channel", "zac-test", "ai-bot"];

/**
 * What `integrations.config` holds for the Slack integration. References and switches only, like
 * the Monday row (0026): the token lives in the environment.
 */
export interface SlackSettings {
  enabled: boolean;
  orgId: string;
  /** The admin the import acts as: created_by on the groups, the caller of import_slack_account. */
  actorUserId: string | null;
  teamId: string | null;
  skipNamePatterns: string[];
  importBotMessages: boolean;
  discoverRequestedAt: string | null;
  discoveredAt: string | null;
  backfillRequestedAt: string | null;
  backfillCompletedAt: string | null;
  paused: boolean;
}

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_USER_TOKEN);
}

export async function readSlackSettings(admin: Admin): Promise<SlackSettings | null> {
  const { data } = await admin
    .from("integrations")
    .select("org_id, enabled, config")
    .eq("key", SLACK_INTEGRATION_KEY)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return settingsFrom(data.org_id, Boolean(data.enabled), (data.config ?? {}) as Record<string, unknown>);
}

export function settingsFrom(orgId: string, enabled: boolean, config: Record<string, unknown>): SlackSettings {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const list = (v: unknown): string[] | null =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : null;
  return {
    enabled,
    orgId,
    actorUserId: str(config.actor_user_id),
    teamId: str(config.team_id),
    skipNamePatterns: list(config.skip_name_patterns) ?? DEFAULT_SKIP_NAME_PATTERNS,
    importBotMessages: config.import_bot_messages !== false,
    discoverRequestedAt: str(config.discover_requested_at),
    discoveredAt: str(config.discovered_at),
    backfillRequestedAt: str(config.backfill_requested_at),
    backfillCompletedAt: str(config.backfill_completed_at),
    paused: config.paused === true,
  };
}

/** Merges keys into the config. Service role, because the worker writes progress here too. */
export async function patchSlackConfig(admin: Admin, orgId: string, patch: Record<string, unknown>): Promise<void> {
  const { data } = await admin
    .from("integrations")
    .select("config")
    .eq("org_id", orgId)
    .eq("key", SLACK_INTEGRATION_KEY)
    .maybeSingle();
  const config = { ...((data?.config ?? {}) as Record<string, unknown>), ...patch } as Json;
  await admin
    .from("integrations")
    .upsert(
      { org_id: orgId, key: SLACK_INTEGRATION_KEY, config, updated_at: new Date().toISOString() },
      { onConflict: "org_id,key" },
    );
}
