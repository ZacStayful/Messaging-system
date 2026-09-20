/**
 * A Slack message object → the row import_slack_messages takes. Pure.
 *
 * Subtypes, and what they become:
 *   (none) / me_message / file_share / thread_broadcast   an ordinary message (a reply, if threaded)
 *   bot_message                                           an ordinary message from the bot's profile
 *   channel_join / channel_leave                          kind='system', meta.event member_joined / member_left
 *   channel_topic / channel_purpose / channel_name        kind='system', meta.event topic_changed / channel_renamed
 *   tombstone / pinned_item / channel_archive / …          nothing — pins arrive via pinned_to, the rest is noise
 *
 * Files are returned separately for the download queue; the message body carries the text only.
 */

import type { SlackFile, SlackMessage } from "./client";
import { blocksToText, mrkdwnToBody, type MrkdwnContext } from "./mrkdwn";
import { shortcodeToUnicode } from "./emoji";

export interface ImportRow {
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  sender_id: string | null;
  body: string;
  kind: "text" | "system";
  edited_ts: string | null;
  meta: Record<string, unknown>;
  reactions: { user_id: string; emoji: string }[];
  pinned: boolean;
  pinned_by: string | null;
  pinned_ts: string | null;
}

export interface NormalisedMessage {
  row: ImportRow;
  files: SlackFile[];
  /** A thread parent whose replies need fetching. */
  replyCount: number;
  latestReply: string | null;
  /** Reactions Slack had that no known person or character could be written for. */
  droppedReactions: number;
}

export interface NormaliseContext extends MrkdwnContext {
  /** Profile id for a Slack user or bot id, null when there is none (skipped bot, unknown user). */
  profileId: (slackId: string) => string | null;
  importBotMessages: boolean;
  /** Whether the person is a live team member — a customer's reaction is still recorded, a stranger's is not. */
}

const SYSTEM_EVENTS: Record<string, string> = {
  channel_join: "member_joined",
  channel_leave: "member_left",
  channel_topic: "topic_changed",
  channel_purpose: "topic_changed",
  channel_name: "channel_renamed",
};

const SKIP_SUBTYPES = new Set([
  "tombstone",
  "pinned_item",
  "unpinned_item",
  "channel_archive",
  "channel_unarchive",
  "group_archive",
  "group_unarchive",
  "group_join",
  "group_leave",
  "bot_add",
  "bot_remove",
  "reminder_add",
  "sh_room_created",
  "huddle_thread",
  "ekm_access_denied",
  "channel_convert_to_private",
  "channel_convert_to_public",
  "joiner_notification",
]);

export function isThreadReply(m: SlackMessage): boolean {
  return Boolean(m.thread_ts && m.thread_ts !== m.ts);
}

/** Null when the message has no place here. */
export function normaliseMessage(channelId: string, m: SlackMessage, ctx: NormaliseContext): NormalisedMessage | null {
  if (!m.ts || m.hidden) return null;
  const subtype = m.subtype ?? "";
  if (SKIP_SUBTYPES.has(subtype)) return null;
  if (subtype === "bot_message" && !ctx.importBotMessages) return null;

  const slackSender = m.user ?? m.bot_id ?? null;
  const system = subtype in SYSTEM_EVENTS;
  const senderId = system ? null : slackSender ? ctx.profileId(slackSender) : null;
  if (!system && subtype === "bot_message" && !senderId) return null;

  let text = m.text ?? "";
  if (!text.trim() && (m.blocks?.length || m.attachments?.length)) text = blocksToText(m.blocks, m.attachments);
  const converted = mrkdwnToBody(text, ctx);
  let body = converted.body;
  if (!body && (m.files?.length ?? 0) > 0) body = "";
  if (!body && !system && !(m.files?.length ?? 0)) return null;

  const reactions: { user_id: string; emoji: string }[] = [];
  let dropped = 0;
  for (const r of m.reactions ?? []) {
    const emoji = shortcodeToUnicode(r.name) ?? `:${r.name}:`;
    for (const u of r.users ?? []) {
      const pid = ctx.profileId(u);
      if (pid) reactions.push({ user_id: pid, emoji });
      else dropped += 1;
    }
  }

  const pinned = (m.pinned_to ?? []).includes(channelId);
  const pinnedBy = pinned && m.pinned_info?.pinned_by ? ctx.profileId(m.pinned_info.pinned_by) : null;

  const meta: Record<string, unknown> = {
    slack: {
      channel: channelId,
      ts: m.ts,
      user: m.user ?? null,
      bot_id: m.bot_id ?? null,
      subtype: subtype || null,
      username: m.username ?? m.bot_profile?.name ?? null,
    },
    ...(converted.mentions.length ? { mentions: converted.mentions } : {}),
    ...(system
      ? { event: SYSTEM_EVENTS[subtype], user_id: slackSender ? (ctx.profileId(slackSender) ?? null) : null }
      : {}),
    ...((m.files?.length ?? 0) > 0 ? { attachment_count: m.files!.length } : {}),
  };

  return {
    row: {
      channel_id: channelId,
      ts: m.ts,
      thread_ts: isThreadReply(m) ? m.thread_ts! : null,
      sender_id: senderId,
      body,
      kind: system ? "system" : "text",
      edited_ts: m.edited?.ts ?? null,
      meta,
      reactions,
      pinned,
      pinned_by: pinnedBy,
      pinned_ts: m.pinned_info?.pinned_ts ? String(m.pinned_info.pinned_ts) : null,
    },
    files: (m.files ?? []).filter((f) => f.id && f.mode !== "tombstone" && f.mode !== "hidden_by_limit"),
    replyCount: !isThreadReply(m) ? (m.reply_count ?? 0) : 0,
    latestReply: m.latest_reply ?? null,
    droppedReactions: dropped,
  };
}

/** The line appended to a message for a file that could not be copied. */
export function fileNotImportedLine(name: string | undefined, reason: string): string {
  return `[file not imported: ${name || "file"} (${reason})]`;
}
