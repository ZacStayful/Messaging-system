/**
 * The engine: one conversation at a time, as far as a budget allows, resumable at every step.
 *
 * A conversation moves through
 *   ready → members → history → files → bookmarks → complete
 * and then, once a day, back through a catch-up pass that ends in `complete` again. Every step
 * writes its progress before returning, so a slice that runs out of time — or a function Vercel
 * kills — costs nothing but the page it was reading.
 *
 * History is read *backwards* (conversations.history returns newest first) from `history_low_ts`;
 * the catch-up reads *forwards* from `history_high_ts`. Both are exclusive bounds Slack applies
 * itself, so the two never overlap and never skip.
 *
 * `runSlice` is what the cron calls: users first, then channels, then files, then whatever daily
 * catch-up is due.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { actingUserClient } from "@/lib/api/auth";
import { safeHttpUrl } from "@/lib/urls";
import {
  SlackApiError,
  conversationInfo,
  historyPage,
  joinChannel,
  listBookmarks,
  listMembers,
  threadReplies,
  type SlackMessage,
} from "./client";
import { applyMessages, markDeletedInWindow, type ApplyContext, type ApplyReport } from "./apply";
import { materialiseConversation } from "./conversations";
import { loadDirectory } from "./directory";
import { decidePendingConversations, discoverWorkspace } from "./discover";
import { processFiles } from "./files";
import { Budget, acquireLease } from "./lease";
import { patchSlackConfig, readSlackSettings, type SlackSettings } from "./settings";
import { applyUserDecision, type DecidedUser } from "./users";
import { normaliseMessage } from "./normalise";

type Admin = SupabaseClient<Database>;
type LinkRow = Database["public"]["Tables"]["slack_conversations"]["Row"];

const MAX_ATTEMPTS = 5;
const PAGE = 200;
/** How far back the catch-up re-reads, so an edit or reaction on a recent message is seen. */
const CATCHUP_OVERLAP_S = 3600;
/** Threads re-read each day: anything with a reply in this window. */
const RECENT_THREAD_DAYS = 30;
const RECENT_THREADS_PER_SLICE = 50;
/** Once a week the last 90 days are re-read in full, which is also when deletions are noticed. */
const DEEP_EVERY_DAYS = 7;
const DEEP_WINDOW_DAYS = 90;

export interface SliceReport {
  phase: string;
  discovery?: { users: number; conversations: number } | { decided: number; remaining: number };
  users?: { applied: number; remaining: number };
  conversations: {
    channel: string;
    name: string | null;
    from: string;
    to: string;
    report?: Partial<ApplyReport>;
    error?: string;
  }[];
  files?: { done: number; skipped: number; failed: number };
  stopped?: string;
}

class OutOfTime extends Error {
  constructor() {
    super("out of time");
    this.name = "OutOfTime";
  }
}

function tsMin(messages: SlackMessage[]): string | null {
  return messages.reduce<string | null>((m, x) => (m === null || Number(x.ts) < Number(m) ? x.ts : m), null);
}
function tsMax(messages: SlackMessage[]): string | null {
  return messages.reduce<string | null>((m, x) => (m === null || Number(x.ts) > Number(m) ? x.ts : m), null);
}

async function patchLink(admin: Admin, link: LinkRow, patch: Partial<LinkRow>): Promise<LinkRow> {
  const { data, error } = await admin
    .from("slack_conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", link.org_id)
    .eq("slack_channel_id", link.slack_channel_id)
    .select("*")
    .single();
  if (error || !data) throw new Error(`slack_conversations: ${error?.message ?? "no row"}`);
  return data;
}

/** The parents in a page that have replies, and every reply of theirs, oldest first. */
async function repliesFor(channelId: string, parents: SlackMessage[], budget: Budget): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  for (const p of parents) {
    if ((p.reply_count ?? 0) === 0 || (p.thread_ts && p.thread_ts !== p.ts)) continue;
    if (!budget.has(5_000)) throw new OutOfTime();
    const thread = await threadReplies(channelId, p.ts);
    for (const r of thread) if (r.ts !== p.ts) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The backfill phases
// ---------------------------------------------------------------------------

async function phaseMembers(ctx: ApplyContext, link: LinkRow, actorId: string): Promise<LinkRow> {
  const members = await listMembers(link.slack_channel_id);
  const rows: { user_id: string; member_side: "internal" | "external" }[] = [];
  const outcomes: Record<string, string> = {};
  for (const slackId of members) {
    const person = ctx.directory.person(slackId);
    if (!person) {
      outcomes[slackId] = "no_profile";
      continue;
    }
    if (person.isBot) {
      outcomes[slackId] = "bot";
      continue;
    }
    if (person.accountType === "customer" && link.target_kind !== "owner") {
      outcomes[slackId] = "external_in_internal";
      continue;
    }
    rows.push({ user_id: person.profileId, member_side: person.accountType === "customer" ? "external" : "internal" });
  }
  // The actor is always in: someone has to be able to open every imported room.
  if (!rows.some((r) => r.user_id === actorId)) rows.push({ user_id: actorId, member_side: "internal" });
  const { data, error } = await ctx.admin.rpc("import_slack_members", {
    p_conversation_id: link.conversation_id!,
    p_rows: rows as unknown as Json,
    p_joined_at: link.created_ts ? new Date(Number(link.created_ts) * 1000).toISOString() : undefined,
  });
  if (error) throw new Error(`import_slack_members: ${error.message}`);
  const byProfile = (data ?? {}) as Record<string, string>;
  for (const slackId of members) {
    const pid = ctx.directory.profileId(slackId);
    if (pid && byProfile[pid]) outcomes[slackId] = byProfile[pid];
  }
  return patchLink(ctx.admin, link, {
    members: members as unknown as Json,
    member_outcomes: outcomes as unknown as Json,
    status: link.status === "complete" ? "complete" : "history",
  });
}

async function phaseHistory(
  ctx: ApplyContext,
  link: LinkRow,
  budget: Budget,
  out: SliceReport["conversations"][number],
): Promise<LinkRow> {
  let current = link;
  while (budget.has(10_000)) {
    const page = await historyPage(current.slack_channel_id, {
      latest: current.history_low_ts ?? undefined,
      limit: PAGE,
    });
    if (page.messages.length === 0) {
      return patchLink(ctx.admin, current, { status: "files" });
    }
    const replies = await repliesFor(current.slack_channel_id, page.messages, budget);
    const report = await applyMessages(
      ctx,
      current.conversation_id!,
      current.slack_channel_id,
      [...page.messages, ...replies],
      { bulk: true },
    );
    out.report = report;
    const low = tsMin(page.messages)!;
    const high = current.history_high_ts ?? tsMax(page.messages)!;
    current = await patchLink(ctx.admin, current, {
      history_low_ts: low,
      history_high_ts: high,
      imported_messages: current.imported_messages + (report.inserted - report.insertedReplies),
      imported_replies: current.imported_replies + report.insertedReplies,
      ...(page.hasMore ? {} : { status: "files" }),
    });
    if (!page.hasMore) return current;
  }
  return current;
}

async function phaseFiles(ctx: ApplyContext, link: LinkRow, budget: Budget): Promise<LinkRow> {
  const report = await processFiles(ctx.admin, budget, link.conversation_id!);
  const patched = await patchLink(ctx.admin, link, {
    imported_files: link.imported_files + report.done,
    skipped_files: link.skipped_files + report.skipped + report.failed,
  });
  if (report.remaining) return patched;
  const { count } = await ctx.admin
    .from("slack_files")
    .select("slack_file_id", { count: "exact", head: true })
    .eq("conversation_id", link.conversation_id!)
    .eq("status", "pending");
  if ((count ?? 0) > 0) return patched;
  return patchLink(ctx.admin, patched, { status: link.status === "complete" ? "complete" : "bookmarks" });
}

async function phaseBookmarks(ctx: ApplyContext, link: LinkRow, actorId: string): Promise<LinkRow> {
  let bookmarks: Awaited<ReturnType<typeof listBookmarks>> = [];
  try {
    bookmarks = await listBookmarks(link.slack_channel_id);
  } catch (e) {
    if (e instanceof SlackApiError && e.rateLimited) throw e;
    // A workspace whose app lacks bookmarks:read still imports; the bar is a nicety.
  }
  const rows = bookmarks
    .filter((b) => b.link && safeHttpUrl(b.link))
    .map((b, i) => ({
      org_id: ctx.orgId,
      conversation_id: link.conversation_id!,
      title: (b.title?.trim() || safeHttpUrl(b.link!)!.hostname).slice(0, 120),
      url: b.link!,
      emoji: b.emoji ?? null,
      position: 10_000 + i * 1000,
      created_by: actorId,
      template_key: `slack:${b.id}`,
    }));
  if (rows.length) {
    await ctx.admin
      .from("conversation_bookmarks")
      .upsert(rows, { onConflict: "conversation_id,template_key", ignoreDuplicates: true });
  }
  if (link.status === "complete") return link;
  const { error } = await ctx.admin.rpc("slack_finish_backfill", { p_conversation_id: link.conversation_id! });
  if (error) throw new Error(`slack_finish_backfill: ${error.message}`);
  return patchLink(ctx.admin, link, {});
}

// ---------------------------------------------------------------------------
// The daily catch-up
// ---------------------------------------------------------------------------

async function catchUp(
  ctx: ApplyContext,
  link: LinkRow,
  actorId: string,
  budget: Budget,
  out: SliceReport["conversations"][number],
): Promise<LinkRow> {
  let current = link;
  const channel = current.slack_channel_id;

  // 1. The channel itself: renamed, re-described, archived.
  const info = await conversationInfo(channel);
  const patch: Database["public"]["Tables"]["conversations"]["Update"] = {};
  if ((info.topic?.value ?? "") !== (current.topic ?? "")) patch.topic = info.topic?.value || null;
  if ((info.purpose?.value ?? "") !== (current.purpose ?? "")) patch.description = info.purpose?.value || null;
  if (info.is_archived) patch.archived_at = new Date().toISOString();
  if (Object.keys(patch).length) await ctx.admin.from("conversations").update(patch).eq("id", current.conversation_id!);
  current = await patchLink(ctx.admin, current, {
    name: info.name ?? current.name,
    topic: info.topic?.value || null,
    purpose: info.purpose?.value || null,
    is_archived: Boolean(info.is_archived),
  });

  // 2. New members (nobody is removed: leaving Slack is not leaving the record).
  current = await phaseMembers(ctx, current, actorId);

  // 3. New top-level messages, plus recent ones again for edits and reactions.
  const since = current.history_high_ts
    ? String(Math.max(0, Number(current.history_high_ts) - CATCHUP_OVERLAP_S))
    : undefined;
  let cursor: string | undefined;
  let newest = current.history_high_ts;
  const report: ApplyReport = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    orphans: 0,
    filesQueued: 0,
    droppedReactions: 0,
    insertedReplies: 0,
  };
  do {
    if (!budget.has(10_000)) throw new OutOfTime();
    const page = await historyPage(channel, { oldest: since, cursor, limit: PAGE });
    if (page.messages.length) {
      const replies = await repliesFor(channel, page.messages, budget);
      const r = await applyMessages(ctx, current.conversation_id!, channel, [...page.messages, ...replies]);
      for (const k of Object.keys(report) as (keyof ApplyReport)[]) report[k] += r[k];
      const max = tsMax(page.messages)!;
      if (!newest || Number(max) > Number(newest)) newest = max;
    }
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  current = await patchLink(ctx.admin, current, {
    history_high_ts: newest,
    imported_messages: current.imported_messages + (report.inserted - report.insertedReplies),
    imported_replies: current.imported_replies + report.insertedReplies,
  });

  // 4. Threads with recent replies, which a forward walk over parents cannot see.
  const recentSince = new Date(Date.now() - RECENT_THREAD_DAYS * 86_400_000).toISOString();
  const { data: parents } = await ctx.admin
    .from("messages")
    .select("id, external_ref, last_reply_at")
    .eq("conversation_id", current.conversation_id!)
    .eq("sent_via", "slack")
    .is("parent_id", null)
    .gt("reply_count", 0)
    .gte("last_reply_at", recentSince)
    .order("last_reply_at", { ascending: false })
    .limit(RECENT_THREADS_PER_SLICE);
  for (const p of parents ?? []) {
    if (!budget.has(6_000)) throw new OutOfTime();
    const ts = p.external_ref?.split(":")[1];
    if (!ts) continue;
    const thread = await threadReplies(channel, ts);
    const r = await applyMessages(ctx, current.conversation_id!, channel, thread);
    for (const k of Object.keys(report) as (keyof ApplyReport)[]) report[k] += r[k];
    const seen = new Set(thread.map((t) => t.ts));
    await markDeletedInWindow(ctx.admin, channel, { oldest: ts, latest: "9999999999.999999", threadTs: ts }, seen);
  }

  // 5. Once a week, the last 90 days again, which is when deletions are noticed.
  const lastDeep = current.threads_checked_at ? new Date(current.threads_checked_at).getTime() : 0;
  if (Date.now() - lastDeep > DEEP_EVERY_DAYS * 86_400_000) {
    const oldest = String(Math.floor(Date.now() / 1000) - DEEP_WINDOW_DAYS * 86_400);
    const seen = new Set<string>();
    let deepCursor: string | undefined;
    let latestSeen = oldest;
    do {
      if (!budget.has(10_000)) throw new OutOfTime();
      const page = await historyPage(channel, { oldest, cursor: deepCursor, limit: PAGE });
      for (const m of page.messages) {
        seen.add(m.ts);
        if (Number(m.ts) > Number(latestSeen)) latestSeen = m.ts;
      }
      if (page.messages.length) {
        const r = await applyMessages(ctx, current.conversation_id!, channel, page.messages, { bulk: true });
        for (const k of Object.keys(report) as (keyof ApplyReport)[]) report[k] += r[k];
      }
      deepCursor = page.hasMore ? page.nextCursor : undefined;
    } while (deepCursor);
    await markDeletedInWindow(ctx.admin, channel, { oldest, latest: latestSeen, threadTs: null }, seen);
    current = await patchLink(ctx.admin, current, { threads_checked_at: new Date().toISOString() });
  }

  // 6. Files and bookmarks, then done for today.
  out.report = report;
  current = await phaseFiles(ctx, current, budget);
  await phaseBookmarks(ctx, current, actorId);
  const { error } = await ctx.admin.rpc("slack_finish_backfill", { p_conversation_id: current.conversation_id! });
  if (error) throw new Error(`slack_finish_backfill: ${error.message}`);
  return patchLink(ctx.admin, current, {});
}

// ---------------------------------------------------------------------------
// One conversation, one slice
// ---------------------------------------------------------------------------

export async function syncConversation(
  ctx: ApplyContext,
  actorId: string,
  link: LinkRow,
  budget: Budget,
  out: SliceReport["conversations"][number],
): Promise<LinkRow> {
  let current = link;
  try {
    if (current.status === "ready") {
      if (!current.is_member && !current.is_private) {
        await joinChannel(current.slack_channel_id);
        current = await patchLink(ctx.admin, current, { is_member: true });
      }
      const made = await materialiseConversation(ctx.admin, ctx.actor, actorId, current);
      if ("error" in made) throw new Error(made.error);
      current = await patchLink(ctx.admin, current, {
        conversation_id: made.conversationId,
        property_id: made.propertyId,
        status: "members",
      });
      ctx.directory.channelNames.set(current.slack_channel_id, current.name ?? current.slack_channel_id);
    }
    if (current.status === "members") current = await phaseMembers(ctx, current, actorId);
    if (current.status === "history") current = await phaseHistory(ctx, current, budget, out);
    if (current.status === "files") current = await phaseFiles(ctx, current, budget);
    if (current.status === "bookmarks") current = await phaseBookmarks(ctx, current, actorId);
    if (
      current.status === "complete" &&
      current.next_sync_at &&
      new Date(current.next_sync_at).getTime() <= Date.now()
    ) {
      current = await catchUp(ctx, current, actorId, budget, out);
    }
    out.to = current.status;
    return patchLink(ctx.admin, current, { claimed_at: null, attempts: 0, last_error: null });
  } catch (e) {
    if (e instanceof OutOfTime) {
      out.to = current.status;
      return patchLink(ctx.admin, current, { claimed_at: null });
    }
    if (e instanceof SlackApiError && e.rateLimited) {
      out.error = "rate limited";
      await patchLink(ctx.admin, current, { claimed_at: null });
      throw e;
    }
    const message = e instanceof Error ? e.message : String(e);
    const attempts = current.attempts + 1;
    out.error = message;
    out.to = attempts >= MAX_ATTEMPTS ? "error" : current.status;
    return patchLink(ctx.admin, current, {
      claimed_at: null,
      attempts,
      last_error: message,
      ...(attempts >= MAX_ATTEMPTS ? { status: "error" } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// The users pass
// ---------------------------------------------------------------------------

async function applyPendingUsers(
  admin: Admin,
  actor: Admin,
  settings: SlackSettings,
  budget: Budget,
): Promise<{ applied: number; remaining: number }> {
  const { data: rows } = await admin
    .from("slack_users")
    .select("*")
    .eq("org_id", settings.orgId)
    .is("profile_id", null)
    .neq("decision", "skip")
    .order("is_bot")
    .order("slack_user_id");
  const pending = (rows ?? []).filter(
    (r) => !r.outcome || !["linked", "invited", "created", "updated", "skipped"].includes(r.outcome),
  );
  let applied = 0;
  for (const r of pending) {
    if (!budget.has(6_000)) break;
    const d: DecidedUser = {
      slackUserId: r.slack_user_id,
      decision: r.decision as DecidedUser["decision"],
      reason: r.outcome ?? "",
      email: r.email,
      fullName: r.real_name || r.display_name || r.name || r.slack_user_id,
      displayName: r.resolved_display || r.display_name || r.real_name || r.name || r.slack_user_id,
      accountType: r.decision === "create_customer" ? "customer" : "team",
      role: r.decision === "create_customer" ? "owner" : "staff",
      timezone: r.tz,
      imageUrl: r.image_url,
      deactivated: r.deleted || r.decision === "create_bot",
      isBot: r.decision === "create_bot" || r.is_bot,
      profileId: r.profile_id,
    };
    if (d.decision === "link" && !d.profileId) {
      // Decided by hand as "link" but with nothing to link to: find the account by email now.
      const { data: p } = d.email
        ? await admin.from("profiles").select("id").ilike("email", d.email).maybeSingle()
        : { data: null };
      d.profileId = p?.id ?? null;
    }
    const result = await applyUserDecision(admin, actor, settings.actorUserId!, d);
    await admin
      .from("slack_users")
      .update({
        profile_id: result.profileId,
        outcome: result.outcome,
        error: result.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", r.org_id)
      .eq("slack_user_id", r.slack_user_id);
    applied += 1;
  }
  return { applied, remaining: pending.length - applied };
}

// ---------------------------------------------------------------------------
// The slice
// ---------------------------------------------------------------------------

export async function runSlice(
  admin: Admin,
  budgetMs: number,
  opts: { holder?: string; maxConversations?: number } = {},
): Promise<SliceReport> {
  const budget = new Budget(budgetMs);
  const holder = opts.holder ?? `slice-${Date.now()}`;
  const report: SliceReport = { phase: "idle", conversations: [] };

  const settings = await readSlackSettings(admin);
  if (!settings?.enabled) return { ...report, stopped: "disabled" };
  if (settings.paused) return { ...report, stopped: "paused" };
  if (!settings.actorUserId) return { ...report, stopped: "no actor" };
  if (!process.env.SLACK_USER_TOKEN) return { ...report, stopped: "SLACK_USER_TOKEN not set" };

  if (!(await acquireLease(admin, "worker", holder, 120))) return { ...report, stopped: "another run holds the lease" };
  const renew = () => acquireLease(admin, "worker", holder, 120);
  const actor = actingUserClient(settings.actorUserId);

  try {
    // Discovery, when asked for and not yet done.
    const discoverDue =
      settings.discoverRequestedAt && (!settings.discoveredAt || settings.discoverRequestedAt > settings.discoveredAt);
    if (discoverDue) {
      report.phase = "discover";
      report.discovery = await discoverWorkspace(admin, settings);
    }
    const decided = await decidePendingConversations(admin, settings, budget);
    if (decided.decided || decided.remaining) {
      report.phase = "decide";
      report.discovery = decided;
      if (decided.remaining) return report;
    }
    await renew();

    // People before rooms: every later step resolves Slack ids to profiles.
    const anyWork = await admin
      .from("slack_conversations")
      .select("slack_channel_id", { count: "exact", head: true })
      .eq("org_id", settings.orgId)
      .in("status", ["ready", "members", "history", "files", "bookmarks"]);
    const dueCatchUp = await admin
      .from("slack_conversations")
      .select("slack_channel_id", { count: "exact", head: true })
      .eq("org_id", settings.orgId)
      .eq("status", "complete")
      .lte("next_sync_at", new Date().toISOString());
    if ((anyWork.count ?? 0) === 0 && (dueCatchUp.count ?? 0) === 0) {
      report.phase = "idle";
      const files = await processFiles(admin, budget);
      report.files = files;
      return report;
    }

    report.phase = "users";
    report.users = await applyPendingUsers(admin, actor, settings, budget);
    if (report.users.remaining > 0) return report;
    await renew();

    report.phase = "conversations";
    const directory = await loadDirectory(admin, settings.orgId);
    const ctx: ApplyContext = {
      admin,
      actor,
      orgId: settings.orgId,
      directory,
      importBotMessages: settings.importBotMessages,
    };
    let done = 0;
    while (budget.has(12_000) && done < (opts.maxConversations ?? 50)) {
      const { data: claimed } = await admin.rpc("slack_claim_conversation", { p_stale: "10 minutes" });
      const link = (claimed as LinkRow | null) ?? null;
      if (!link || !link.slack_channel_id) break;
      const entry = { channel: link.slack_channel_id, name: link.name, from: link.status, to: link.status };
      report.conversations.push(entry);
      try {
        await syncConversation(ctx, settings.actorUserId, link, budget, entry);
      } catch (e) {
        if (e instanceof SlackApiError && e.rateLimited) {
          report.stopped = "rate limited";
          return report;
        }
        throw e;
      }
      done += 1;
      await renew();
    }

    // Anything the backfill queued that its own files phase did not finish.
    if (budget.has(15_000)) report.files = await processFiles(admin, budget);

    if (settings.backfillRequestedAt && !settings.backfillCompletedAt) {
      const { count } = await admin
        .from("slack_conversations")
        .select("slack_channel_id", { count: "exact", head: true })
        .eq("org_id", settings.orgId)
        .in("status", ["ready", "members", "history", "files", "bookmarks"]);
      if ((count ?? 0) === 0) {
        await patchSlackConfig(admin, settings.orgId, { backfill_completed_at: new Date().toISOString() });
        // Team members who are live should not open a feed of ten thousand mentions.
        await admin
          .from("profiles")
          .update({ activity_seen_at: new Date().toISOString() })
          .eq("org_id", settings.orgId)
          .eq("account_type", "team");
      }
    }
    return report;
  } finally {
    await admin
      .from("slack_leases")
      .update({ expires_at: new Date(0).toISOString() })
      .eq("name", "worker")
      .eq("holder", holder);
  }
}

export { normaliseMessage };
