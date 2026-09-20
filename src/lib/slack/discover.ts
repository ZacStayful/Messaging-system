/**
 * Discovery: what is in the workspace, and what to do with each part of it.
 *
 * Two steps, because the second needs one Slack call per channel and a cron slice is 45 seconds:
 *   1. `discoverWorkspace` — users.list and conversations.list, upserted with a decision for each
 *      person and `pending` for each channel. A handful of requests.
 *   2. `decidePendingConversations` — conversations.members per channel, then decideConversation;
 *      as many as fit in the budget, the rest next minute.
 *
 * Nothing here creates anything in the app. Decisions made by hand on the settings page
 * (decision_source = 'manual') survive a re-run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { listConversations, listMembers, listUsers, teamInfo, SlackApiError, type SlackConversation } from "./client";
import { addressesFromTopic, decideConversation, type CustomerAddress, type ExistingConversation } from "./conversations";
import { patchSlackConfig, type SlackSettings } from "./settings";
import { decideUser, type ExistingProfile } from "./users";
import type { Budget } from "./lease";

type Admin = SupabaseClient<Database>;

export interface DiscoveryReport {
  teamId: string;
  users: number;
  conversations: number;
}

export async function discoverWorkspace(admin: Admin, settings: SlackSettings): Promise<DiscoveryReport> {
  const team = await teamInfo();
  if (settings.teamId && settings.teamId !== team.id) {
    throw new Error(`the token belongs to workspace ${team.id} (${team.name}), not the configured ${settings.teamId}`);
  }

  const { data: org } = await admin.from("organisations").select("settings").eq("id", settings.orgId).single();
  const teamDomains = (((org?.settings as { team_domains?: unknown } | null)?.team_domains as string[] | undefined) ?? []).map((d) =>
    d.toLowerCase(),
  );
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email, slack_user_id, display_name")
    .eq("org_id", settings.orgId);
  const existing: ExistingProfile[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email?.toLowerCase() ?? null,
    slackUserId: p.slack_user_id,
    displayName: p.display_name,
  }));
  const profilesByEmail = new Map(existing.filter((p) => p.email).map((p) => [p.email!, p]));
  const profilesBySlackId = new Map(existing.filter((p) => p.slackUserId).map((p) => [p.slackUserId!, p]));
  const takenDisplayNames = new Set(existing.map((p) => p.displayName.trim().toLowerCase()));

  const { data: previous } = await admin
    .from("slack_users")
    .select("slack_user_id, decision, decision_source, resolved_display, outcome, profile_id")
    .eq("org_id", settings.orgId);
  const previousById = new Map((previous ?? []).map((r) => [r.slack_user_id, r]));
  // Names already given to imported people stay theirs.
  for (const r of previous ?? []) if (r.resolved_display && r.profile_id) takenDisplayNames.add(r.resolved_display.toLowerCase());

  const users = await listUsers();
  const ctx = { teamDomains, profilesByEmail, profilesBySlackId, takenDisplayNames };
  const userRows = users.map((u) => {
    const prev = previousById.get(u.id);
    if (prev?.resolved_display) takenDisplayNames.delete(prev.resolved_display.toLowerCase());
    const d = decideUser(u, ctx);
    const keepManual = prev?.decision_source === "manual";
    return {
      org_id: settings.orgId,
      slack_user_id: u.id,
      name: u.name ?? null,
      real_name: u.real_name ?? u.profile?.real_name ?? null,
      display_name: u.profile?.display_name || null,
      email: d.email,
      is_bot: Boolean(u.is_bot || u.is_app_user || u.profile?.bot_id),
      is_app_user: Boolean(u.is_app_user),
      is_restricted: Boolean(u.is_restricted),
      is_ultra_restricted: Boolean(u.is_ultra_restricted),
      deleted: Boolean(u.deleted),
      tz: u.tz ?? null,
      image_url: d.imageUrl,
      raw: u as unknown as Json,
      decision: keepManual ? prev!.decision : d.decision,
      decision_source: keepManual ? "manual" : "auto",
      resolved_display: prev?.profile_id ? (prev.resolved_display ?? d.displayName) : d.displayName,
      profile_id: prev?.profile_id ?? d.profileId,
      outcome: prev?.outcome ?? d.reason,
      updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < userRows.length; i += 200) {
    const { error } = await admin.from("slack_users").upsert(userRows.slice(i, i + 200), { onConflict: "org_id,slack_user_id" });
    if (error) throw new Error(`slack_users: ${error.message}`);
  }

  const conversations = await listConversations();
  const { data: previousConvs } = await admin
    .from("slack_conversations")
    .select("slack_channel_id, decision, decision_source, status, conversation_id")
    .eq("org_id", settings.orgId);
  const prevConv = new Map((previousConvs ?? []).map((r) => [r.slack_channel_id, r]));
  const convRows = conversations.map((c) => {
    const prev = prevConv.get(c.id);
    // A channel already being imported keeps its state; a re-discovery only refreshes the facts.
    const settled = prev && prev.status !== "discovered" && prev.status !== "skipped";
    return {
      org_id: settings.orgId,
      slack_channel_id: c.id,
      kind: c.is_private ? "group" : "channel",
      name: c.name ?? null,
      is_private: Boolean(c.is_private),
      is_archived: Boolean(c.is_archived),
      is_member: c.is_member !== false,
      topic: c.topic?.value || null,
      purpose: c.purpose?.value || null,
      creator: c.creator ?? null,
      created_ts: c.created ? String(c.created) : null,
      ...(settled || prev?.decision_source === "manual" ? {} : { decision: "pending", skip_reason: null, status: "discovered" }),
      updated_at: new Date().toISOString(),
    };
  });
  for (let i = 0; i < convRows.length; i += 200) {
    const { error } = await admin
      .from("slack_conversations")
      .upsert(convRows.slice(i, i + 200), { onConflict: "org_id,slack_channel_id" });
    if (error) throw new Error(`slack_conversations: ${error.message}`);
  }

  await patchSlackConfig(admin, settings.orgId, { team_id: team.id, team_name: team.name, discovered_at: new Date().toISOString() });
  return { teamId: team.id, users: userRows.length, conversations: convRows.length };
}

/** Reads members and decides for as many pending channels as the budget allows. Returns how many are left. */
export async function decidePendingConversations(admin: Admin, settings: SlackSettings, budget: Budget): Promise<{ decided: number; remaining: number }> {
  const { data: pending } = await admin
    .from("slack_conversations")
    .select("*")
    .eq("org_id", settings.orgId)
    .eq("decision", "pending")
    .order("is_private", { ascending: true })
    .order("name");
  if (!pending?.length) return { decided: 0, remaining: 0 };

  const [{ data: users }, { data: convs }, { data: linked }, { data: customers }] = await Promise.all([
    admin.from("slack_users").select("slack_user_id, is_bot, is_app_user, is_restricted, is_ultra_restricted, decision").eq("org_id", settings.orgId),
    admin.from("conversations").select("id, slug, type, property_id, archived_at").eq("org_id", settings.orgId),
    admin.from("slack_conversations").select("conversation_id").eq("org_id", settings.orgId).not("conversation_id", "is", null),
    admin.from("slack_conversations").select("slack_channel_id, topic, name").eq("org_id", settings.orgId),
  ]);
  const guests = new Set((users ?? []).filter((u) => u.is_restricted || u.is_ultra_restricted).map((u) => u.slack_user_id));
  const bots = new Set((users ?? []).filter((u) => u.is_bot || u.is_app_user).map((u) => u.slack_user_id));
  const linkedIds = new Set((linked ?? []).map((l) => l.conversation_id));
  const existingBySlug = new Map<string, ExistingConversation>();
  for (const c of convs ?? []) {
    if (!c.slug) continue;
    existingBySlug.set(c.slug, { id: c.id, type: c.type, propertyId: c.property_id, archivedAt: c.archived_at, slackLinked: linkedIds.has(c.id) });
  }
  const customerAddresses: CustomerAddress[] = (customers ?? []).flatMap((c) => addressesFromTopic(c.slack_channel_id, c.topic));

  let decided = 0;
  for (const row of pending) {
    if (!budget.has(6_000)) break;
    const conv: SlackConversation = {
      id: row.slack_channel_id,
      name: row.name ?? undefined,
      is_private: row.is_private,
      is_archived: row.is_archived,
      is_member: row.is_member,
      topic: { value: row.topic ?? undefined },
      purpose: { value: row.purpose ?? undefined },
      created: row.created_ts ? Number(row.created_ts) : undefined,
    };
    let members: string[] = [];
    let memberError: string | null = null;
    if (!row.is_archived) {
      try {
        members = await listMembers(row.slack_channel_id);
      } catch (e) {
        if (e instanceof SlackApiError && e.rateLimited) break;
        memberError = e instanceof Error ? e.message : String(e);
      }
    }
    const d = decideConversation(conv, members, {
      isGuest: (id) => guests.has(id),
      isBot: (id) => bots.has(id),
      existingBySlug,
      customerAddresses,
      skipNamePatterns: settings.skipNamePatterns,
    });
    if (memberError && d.decision !== "skip") {
      // Cannot read the room's members: leave it pending with the reason, try again next slice.
      await admin
        .from("slack_conversations")
        .update({ last_error: memberError, updated_at: new Date().toISOString() })
        .eq("org_id", row.org_id)
        .eq("slack_channel_id", row.slack_channel_id);
      continue;
    }
    const { error } = await admin
      .from("slack_conversations")
      .update({
        members: members as unknown as Json,
        decision: d.decision,
        skip_reason: d.skipReason,
        target_kind: d.targetKind,
        conversation_id: d.targetConversationId,
        property_address: d.propertyAddress,
        address_guessed: d.addressGuessed,
        customer_channel_id: d.customerChannelId,
        status: d.decision === "skip" ? "skipped" : "discovered",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", row.org_id)
      .eq("slack_channel_id", row.slack_channel_id);
    if (error) throw new Error(`slack_conversations: ${error.message}`);
    if (d.targetConversationId) {
      const ex = existingBySlug.get(d.slug);
      if (ex) ex.slackLinked = true;
    }
    decided += 1;
  }
  return { decided, remaining: pending.length - decided };
}
