/**
 * The one write path. The backfill and the daily catch-up both hand a window of Slack messages
 * to `applyMessages`, which normalises them, fills any thread parent that is missing, calls
 * import_slack_messages in batches, and queues the files. Nothing else inserts a message.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { threadReplies, type SlackMessage } from "./client";
import { Directory } from "./directory";
import { normaliseMessage, type ImportRow, type NormalisedMessage } from "./normalise";
import { queueFiles } from "./files";

type Admin = SupabaseClient<Database>;

export interface ApplyContext {
  admin: Admin;
  /** The admin's own client, for import_slack_account when a bot posts under an id nobody listed. */
  actor: Admin;
  orgId: string;
  directory: Directory;
  importBotMessages: boolean;
}

export interface ApplyReport {
  inserted: number;
  updated: number;
  unchanged: number;
  orphans: number;
  filesQueued: number;
  droppedReactions: number;
  /** Message ids that were inserted, so a caller can count parents vs replies. */
  insertedReplies: number;
}

const BATCH = 500;

/** A bot that posts under a bot_id with no users.list entry gets a profile on first sight. */
async function ensureBotProfile(ctx: ApplyContext, m: SlackMessage): Promise<void> {
  const botId = m.bot_id;
  if (!botId || ctx.directory.person(botId) || !ctx.importBotMessages) return;
  const name = (m.username ?? m.bot_profile?.name ?? "Slack app").trim();
  const { data: userId, error } = await ctx.actor.rpc("import_slack_account", {
    p_slack_user_id: botId,
    p_full_name: `${name} (Slack app)`,
    p_display_name: `${name} (Slack app)`,
    p_account_type: "team",
    p_role: "staff",
    p_deactivated: true,
    p_is_bot: true,
  });
  if (error || !userId) return;
  await ctx.admin.from("slack_users").upsert(
    {
      org_id: ctx.orgId,
      slack_user_id: botId,
      name,
      real_name: name,
      is_bot: true,
      decision: "create_bot",
      resolved_display: `${name} (Slack app)`,
      profile_id: userId,
      outcome: "created",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,slack_user_id" },
  );
  ctx.directory.add(botId, {
    profileId: userId,
    displayName: `${name} (Slack app)`,
    accountType: "team",
    isBot: true,
    isGuest: false,
    deactivated: true,
  });
}

function normaliseAll(ctx: ApplyContext, channelId: string, messages: SlackMessage[]): NormalisedMessage[] {
  const out: NormalisedMessage[] = [];
  for (const m of messages) {
    const n = normaliseMessage(channelId, m, {
      profileId: (id) => ctx.directory.profileId(id),
      userName: (id) => ctx.directory.userName(id),
      userProfileId: (id) => ctx.directory.profileId(id),
      channelName: (id) => ctx.directory.channelName(id),
      importBotMessages: ctx.importBotMessages,
    });
    if (n) out.push(n);
  }
  // Oldest first, parents before their replies (a reply's ts is always later than its thread_ts).
  out.sort((a, b) => Number(a.row.ts) - Number(b.row.ts));
  return out;
}

async function importBatch(ctx: ApplyContext, conversationId: string, rows: ImportRow[], bulk: boolean) {
  const { data, error } = await ctx.admin.rpc("import_slack_messages", {
    p_conversation_id: conversationId,
    p_rows: rows as unknown as Json,
    p_bulk: bulk,
  });
  if (error) throw new Error(`import_slack_messages: ${error.message}`);
  return (data ?? []) as { ts: string; message_id: string | null; outcome: string }[];
}

/**
 * Applies a window of messages to a conversation. Replies whose parent is not here yet are
 * resolved by fetching the parent from Slack and importing it first; a parent Slack itself no
 * longer has is left out and counted as an orphan.
 */
export async function applyMessages(
  ctx: ApplyContext,
  conversationId: string,
  channelId: string,
  messages: SlackMessage[],
  opts: { bulk?: boolean } = {},
): Promise<ApplyReport> {
  const report: ApplyReport = { inserted: 0, updated: 0, unchanged: 0, orphans: 0, filesQueued: 0, droppedReactions: 0, insertedReplies: 0 };
  for (const m of messages) if (m.subtype === "bot_message" && m.bot_id) await ensureBotProfile(ctx, m);

  let items = normaliseAll(ctx, channelId, messages);
  const bulk = opts.bulk ?? items.length > 50;
  const byTs = new Map(items.map((n) => [n.row.ts, n]));
  for (const n of items) report.droppedReactions += n.droppedReactions;

  for (let pass = 0; pass < 2 && items.length; pass += 1) {
    const orphans: ImportRow[] = [];
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      const results = await importBatch(ctx, conversationId, slice.map((n) => n.row), bulk);
      for (const r of results) {
        const n = byTs.get(r.ts);
        if (r.outcome === "orphan") {
          if (n) orphans.push(n.row);
          continue;
        }
        if (r.outcome === "inserted") {
          report.inserted += 1;
          if (n?.row.thread_ts) report.insertedReplies += 1;
          if (n && r.message_id && n.files.length) {
            await queueFiles(ctx.admin, ctx.orgId, conversationId, channelId, r.message_id, n.files);
            report.filesQueued += n.files.length;
          }
        } else if (r.outcome === "updated") report.updated += 1;
        else report.unchanged += 1;
      }
    }
    if (orphans.length === 0 || pass === 1) {
      report.orphans += pass === 1 ? orphans.length : 0;
      break;
    }
    // Fetch each missing parent once, import it, then retry the orphans.
    const parentsNeeded = Array.from(new Set(orphans.map((o) => o.thread_ts!)));
    const fetched: SlackMessage[] = [];
    for (const ts of parentsNeeded) {
      try {
        const thread = await threadReplies(channelId, ts);
        const parent = thread.find((t) => t.ts === ts);
        if (parent) fetched.push(parent);
      } catch {
        // The parent is gone from Slack too; the replies stay orphans.
      }
    }
    if (fetched.length === 0) {
      report.orphans += orphans.length;
      break;
    }
    const parents = normaliseAll(ctx, channelId, fetched);
    for (const p of parents) byTs.set(p.row.ts, p);
    const parentResults = await importBatch(ctx, conversationId, parents.map((n) => n.row), bulk);
    for (const r of parentResults) {
      if (r.outcome === "inserted") {
        report.inserted += 1;
        const n = byTs.get(r.ts);
        if (n && r.message_id && n.files.length) {
          await queueFiles(ctx.admin, ctx.orgId, conversationId, channelId, r.message_id, n.files);
          report.filesQueued += n.files.length;
        }
      }
    }
    items = orphans.map((o) => byTs.get(o.ts)!).filter(Boolean);
    const stillOrphan = items.filter((n) => !parents.some((p) => p.row.ts === n.row.thread_ts));
    report.orphans += stillOrphan.length;
    items = items.filter((n) => parents.some((p) => p.row.ts === n.row.thread_ts));
  }
  return report;
}

/**
 * Messages this app holds for a window that Slack no longer returned: they were deleted there.
 * Top-level only when `threadTs` is null (history pages carry no replies); one thread's replies
 * when it is set.
 */
export async function markDeletedInWindow(
  admin: Admin,
  channelId: string,
  window: { oldest: string; latest: string; threadTs: string | null },
  seenTs: Set<string>,
): Promise<number> {
  let query = admin
    .from("slack_messages")
    .select("ts")
    .eq("channel_id", channelId)
    .gt("ts", window.oldest)
    .lt("ts", window.latest);
  query = window.threadTs ? query.eq("thread_ts", window.threadTs) : query.is("thread_ts", null);
  const { data } = await query;
  const missing = (data ?? []).map((r) => r.ts).filter((ts) => !seenTs.has(ts));
  if (missing.length === 0) return 0;
  const { data: n } = await admin.rpc("mark_slack_deleted", { p_channel_id: channelId, p_ts_list: missing });
  return n ?? 0;
}
