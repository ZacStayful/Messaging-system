"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mondayConfigured } from "@/lib/monday/client";
import { MONDAY_INTEGRATION_KEY, readIntegration } from "@/lib/monday/provision";
import { listLeadItems } from "@/lib/monday/leads";
import { importLeadCustomers, type LeadImportResult } from "@/lib/monday/importLeads";
import {
  SLACK_INTEGRATION_KEY,
  patchSlackConfig,
  settingsFrom,
  slackConfigured,
  type SlackSettings,
} from "@/lib/slack/settings";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves the Monday integration's switch and configuration.
 *
 * Runs as the signed-in admin, so the RLS policy on `integrations` — not this function — is what
 * decides whether they are allowed to. The one thing enforced here is that the integration
 * cannot be switched on without a person for it to act as: every group it creates is created by
 * someone, and "nobody" is not an answer the database can give.
 */
export async function saveMondaySettings(formData: FormData): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const enabled = formData.get("enabled") === "on";
  const actorUserId = String(formData.get("actor_user_id") ?? "").trim();
  const standardMemberIds = formData.getAll("standard_member_ids").map(String).filter(Boolean);
  const skipGroupIds = String(formData.get("skip_group_ids") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (enabled && !actorUserId) {
    return { ok: false, error: "Choose which team member the integration should act as before switching it on." };
  }

  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  const { error } = await supabase.from("integrations").upsert(
    {
      org_id: me.org_id,
      key: MONDAY_INTEGRATION_KEY,
      enabled,
      config: {
        actor_user_id: actorUserId || null,
        standard_member_ids: standardMemberIds,
        skip_group_ids: skipGroupIds,
      },
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface LeadImportResponse {
  ok: boolean;
  error?: string;
  results?: LeadImportResult[];
}

/**
 * Pulls the two customer groups off the lead database board and puts every person in them on
 * file: a group each, an account that cannot sign in, nothing sent. Admin-only, like the page.
 *
 * Runs as the signed-in admin for the group and the account, so the RPC gates and RLS apply to
 * them; the service role is used only for the bookkeeping tables the team can read but not write.
 */
export async function importLeadDatabase(): Promise<LeadImportResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { data: me } = await supabase.from("profiles").select("org_id, account_type, role").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };
  if (me.account_type !== "team" || me.role !== "admin") return { ok: false, error: "Only an admin can import." };

  if (!mondayConfigured()) return { ok: false, error: "MONDAY_API_TOKEN is not set, so the board cannot be read." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  // The switch is about the Clients webhook; only the "always add" list is borrowed here.
  const settings = await readIntegration(admin);

  let items;
  try {
    items = await listLeadItems();
  } catch (e) {
    return { ok: false, error: `Monday could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { results } = await importLeadCustomers(
    admin,
    { db: supabase, userId: user.id, orgId: me.org_id, standardMemberIds: settings?.standardMemberIds ?? [] },
    items,
  );
  revalidatePath("/settings/integrations");
  return { ok: true, results };
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export interface SlackActionResult {
  ok: boolean;
  error?: string;
  /** Plain English for the page to show when something was done. */
  message?: string;
}

type Db = SupabaseClient<Database>;

type SlackGate = { ok: true; supabase: Db; userId: string; orgId: string } | { ok: false; error: string };

const USER_DECISIONS = ["link", "invite_team", "create_customer", "create_team", "create_bot", "skip"] as const;
const CHANNEL_DECISIONS = ["create", "link", "skip"] as const;
const TARGET_KINDS = ["owner", "internal", "property"] as const;

type UserDecision = (typeof USER_DECISIONS)[number];
type ChannelDecision = (typeof CHANNEL_DECISIONS)[number];
type TargetKind = (typeof TARGET_KINDS)[number];

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Who may touch the Slack import: a signed-in admin. The page 404s for everyone else, but a
 * server action is an endpoint of its own and has to check for itself — all the more because the
 * slack_* tables have no client write policies, so every write below is made with the service
 * role once this has said yes.
 */
async function slackAdmin(): Promise<SlackGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };
  const { data: me } = await supabase.from("profiles").select("org_id, account_type, role").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };
  if (me.account_type !== "team" || me.role !== "admin") {
    return { ok: false, error: "Only an admin can change the Slack import." };
  }
  return { ok: true, supabase, userId: user.id, orgId: me.org_id };
}

/** The row as it is now, read as the caller (the team can read integrations). */
async function currentSlackSettings(supabase: Db, orgId: string): Promise<SlackSettings> {
  const { data } = await supabase
    .from("integrations")
    .select("enabled, config")
    .eq("org_id", orgId)
    .eq("key", SLACK_INTEGRATION_KEY)
    .maybeSingle();
  return settingsFrom(orgId, Boolean(data?.enabled), (data?.config ?? {}) as Record<string, unknown>);
}

/** Why the worker would do nothing with a request, or null when it would run. */
function notRunnable(settings: SlackSettings): string | null {
  if (!slackConfigured()) return "SLACK_USER_TOKEN is not set, so the worker cannot talk to Slack.";
  if (!settings.enabled) return "The Slack import is switched off. Save it on first.";
  if (!settings.actorUserId) return "Choose which admin the import acts as, and save, first.";
  return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Saves the Slack switch and settings. As the signed-in admin, like the Monday row: the RLS
 * policy on `integrations` decides. The worker's own keys in the config — the workspace id, the
 * discovery and backfill timestamps, paused — are read first and kept.
 */
export async function saveSlackSettings(formData: FormData): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const { supabase, userId, orgId } = gate;

  const enabled = formData.get("enabled") === "on";
  const actorUserId = String(formData.get("actor_user_id") ?? "").trim();
  const importBotMessages = formData.get("import_bot_messages") === "on";
  const skipNamePatterns = String(formData.get("skip_name_patterns") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (enabled && !actorUserId) {
    return { ok: false, error: "Choose which admin the import should act as before switching it on." };
  }
  if (actorUserId) {
    // The account functions the worker calls are admin-only; acting as anyone else fails later.
    const { data: actor } = await supabase
      .from("profiles")
      .select("account_type, role, deactivated_at")
      .eq("id", actorUserId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!actor || actor.account_type !== "team" || actor.role !== "admin" || actor.deactivated_at) {
      return { ok: false, error: "The import has to act as an active admin." };
    }
  }

  const { data: existing } = await supabase
    .from("integrations")
    .select("config")
    .eq("org_id", orgId)
    .eq("key", SLACK_INTEGRATION_KEY)
    .maybeSingle();
  const config: Record<string, unknown> = {
    ...((existing?.config ?? {}) as Record<string, unknown>),
    actor_user_id: actorUserId || null,
    skip_name_patterns: skipNamePatterns,
    import_bot_messages: importBotMessages,
  };

  const { error } = await supabase.from("integrations").upsert(
    {
      org_id: orgId,
      key: SLACK_INTEGRATION_KEY,
      enabled,
      config: config as Json,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Asks the worker to list the workspace's people and channels. Nothing in the app changes. */
export async function requestSlackDiscovery(): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const blocked = notRunnable(await currentSlackSettings(gate.supabase, gate.orgId));
  if (blocked) return { ok: false, error: blocked };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  await patchSlackConfig(admin, gate.orgId, { discover_requested_at: new Date().toISOString() });
  revalidatePath("/settings/integrations");
  return {
    ok: true,
    message: "Discovery requested. The worker picks it up within a minute; refresh to see what it found.",
  };
}

/**
 * Queues every channel decided as create or link. Refused while any channel is still pending —
 * its members have not been read, so owner or internal is not yet known — and whenever the
 * worker could not run, because a request it will never act on is worse than an error.
 */
export async function startSlackBackfill(): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const blocked = notRunnable(await currentSlackSettings(gate.supabase, gate.orgId));
  if (blocked) return { ok: false, error: blocked };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const { count: pending } = await admin
    .from("slack_conversations")
    .select("slack_channel_id", { count: "exact", head: true })
    .eq("org_id", gate.orgId)
    .eq("decision", "pending");
  if (pending) {
    return {
      ok: false,
      error: `${plural(pending, "channel is", "channels are")} still pending — the worker is reading their members.`,
    };
  }

  const now = new Date().toISOString();
  const { data: queued, error } = await admin
    .from("slack_conversations")
    .update({ status: "ready", updated_at: now })
    .eq("org_id", gate.orgId)
    .in("decision", ["create", "link"])
    .eq("status", "discovered")
    .select("slack_channel_id");
  if (error) return { ok: false, error: error.message };
  if (!queued?.length) {
    return { ok: false, error: "Nothing to import: no channel is set to create or link and waiting." };
  }

  await patchSlackConfig(admin, gate.orgId, { backfill_requested_at: now, backfill_completed_at: null });
  revalidatePath("/settings/integrations");
  return {
    ok: true,
    message: `${plural(queued.length, "channel", "channels")} queued. The worker takes them one at a time; refresh to follow along.`,
  };
}

/** Brings every finished channel's daily catch-up forward to now. */
export async function syncSlackNow(): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("slack_conversations")
    .update({ next_sync_at: now, updated_at: now })
    .eq("org_id", gate.orgId)
    .eq("status", "complete")
    .select("slack_channel_id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length)
    return { ok: false, error: "No channel has finished its backfill yet, so there is nothing to catch up." };
  revalidatePath("/settings/integrations");
  return { ok: true, message: `${plural(data.length, "channel", "channels")} due now.` };
}

/** Stops the worker between slices (a running slice finishes its page first) — or lets it go again. */
export async function setSlackPaused(paused: boolean): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  await patchSlackConfig(admin, gate.orgId, { paused: paused === true });
  revalidatePath("/settings/integrations");
  return { ok: true, message: paused ? "Paused. Nothing more happens until you resume." : "Resumed." };
}

/**
 * Puts a failed channel back where it was: at the start if it has no conversation yet, at its
 * members if history never began, in its history if the backfill never finished, and otherwise
 * back on the daily catch-up, due now.
 */
export async function retrySlackConversation(slackChannelId: string): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const { data: row } = await admin
    .from("slack_conversations")
    .select("status, conversation_id, history_low_ts, completed_at")
    .eq("org_id", gate.orgId)
    .eq("slack_channel_id", slackChannelId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That channel is not in the list." };
  if (row.status !== "error") return { ok: false, error: "Only a channel that failed can be retried." };

  const now = new Date().toISOString();
  const status = !row.conversation_id
    ? "ready"
    : row.completed_at
      ? "complete"
      : row.history_low_ts
        ? "history"
        : "members";
  const { error } = await admin
    .from("slack_conversations")
    .update({
      status,
      attempts: 0,
      last_error: null,
      claimed_at: null,
      updated_at: now,
      ...(status === "complete" ? { next_sync_at: now } : {}),
    })
    .eq("org_id", gate.orgId)
    .eq("slack_channel_id", slackChannelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true, message: "Queued again." };
}

export interface SlackChannelDecisionInput {
  slackChannelId: string;
  decision: string;
  targetKind: string | null;
  /** For a link: the existing conversation the Slack history should land in. */
  conversationId: string | null;
}

/**
 * Sets what happens to a channel, by hand. Only while it is discovered or skipped: once it is
 * queued the decision has been acted on. A link target has to be one of the org's own
 * conversations and not already the target of another channel (the unique index would say so
 * too, less kindly); an existing customer group stays a customer group and a property group
 * stays a property, whatever kind was picked, because that is what the members phase relies on.
 */
export async function setSlackConversationDecision(input: SlackChannelDecisionInput): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  if (!isOneOf(CHANNEL_DECISIONS, input.decision)) return { ok: false, error: "Choose create, link or skip." };
  const decision: ChannelDecision = input.decision;
  if (input.targetKind !== null && !isOneOf(TARGET_KINDS, input.targetKind)) {
    return { ok: false, error: "Choose an internal channel, a customer group or a property group." };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const { data: row } = await admin
    .from("slack_conversations")
    .select("status, target_kind, conversation_id")
    .eq("org_id", gate.orgId)
    .eq("slack_channel_id", input.slackChannelId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That channel is not in the list." };
  if (row.status !== "discovered" && row.status !== "skipped") {
    return { ok: false, error: "This channel is already being imported; its decision cannot change now." };
  }

  let targetKind: TargetKind =
    input.targetKind ?? (isOneOf(TARGET_KINDS, row.target_kind) ? row.target_kind : "internal");
  let conversationId: string | null = null;
  if (decision === "link") {
    if (!input.conversationId) return { ok: false, error: "Choose the group the channel should link to." };
    const { data: target } = await admin
      .from("conversations")
      .select("id, type, property_id, archived_at")
      .eq("org_id", gate.orgId)
      .eq("id", input.conversationId)
      .maybeSingle();
    if (!target || target.archived_at) return { ok: false, error: "That group could not be found." };
    const { data: taken } = await admin
      .from("slack_conversations")
      .select("name")
      .eq("org_id", gate.orgId)
      .eq("conversation_id", target.id)
      .neq("slack_channel_id", input.slackChannelId)
      .maybeSingle();
    if (taken) return { ok: false, error: `That group is already linked to #${taken.name ?? "another channel"}.` };
    conversationId = target.id;
    if (target.type === "owner") targetKind = "owner";
    else if (target.property_id) targetKind = "property";
    else if (targetKind === "owner") targetKind = "internal";
  }

  const { error } = await admin
    .from("slack_conversations")
    .update({
      decision,
      decision_source: "manual",
      conversation_id: conversationId,
      status: decision === "skip" ? "skipped" : "discovered",
      skip_reason: decision === "skip" ? "manual" : null,
      ...(decision === "skip" ? {} : { target_kind: targetKind }),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", gate.orgId)
    .eq("slack_channel_id", input.slackChannelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Sets what happens to a Slack member, by hand. Only while nothing has been created for them. */
export async function setSlackUserDecision(slackUserId: string, decision: string): Promise<SlackActionResult> {
  const gate = await slackAdmin();
  if (!gate.ok) return gate;
  if (!isOneOf(USER_DECISIONS, decision)) return { ok: false, error: "That is not one of the choices." };
  const chosen: UserDecision = decision;
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const { data: row } = await admin
    .from("slack_users")
    .select("profile_id")
    .eq("org_id", gate.orgId)
    .eq("slack_user_id", slackUserId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That person is not in the list." };
  if (row.profile_id) return { ok: false, error: "This person is already on file; there is nothing left to decide." };

  const { error } = await admin
    .from("slack_users")
    .update({ decision: chosen, decision_source: "manual", updated_at: new Date().toISOString() })
    .eq("org_id", gate.orgId)
    .eq("slack_user_id", slackUserId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}
