/**
 * The little bit of the Slack Web API the import needs.
 *
 * Deliberately not `@slack/web-api`: a handful of GET-shaped methods, one bearer token, and
 * `fetch` is already how this codebase talks to Monday, Resend and TimelinesAI. Every call goes
 * through `fetchWithTimeout` so a stalled response cannot hold a cron slice until Vercel kills it.
 *
 * The token is a *user* token (xoxp-) from an internal app installed by an admin: it sees every
 * public channel — Slack's own words are that only user tokens can read public channels they are
 * not in — plus the private ones that person belongs to. Nothing is ever joined, so the import
 * announces itself in no channel. An internal customer-built app also keeps the ordinary rate
 * limits on `conversations.history`; Slack's May 2025 change applies to distributed apps.
 */

import { fetchWithTimeout } from "@/lib/net/withTimeout";

const DEFAULT_BASE = "https://slack.com/api";

export class SlackNotConfiguredError extends Error {
  constructor() {
    super("SLACK_USER_TOKEN is not set");
    this.name = "SlackNotConfiguredError";
  }
}

export class SlackApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`${method}: ${code}`);
    this.name = "SlackApiError";
  }
  get rateLimited(): boolean {
    return this.code === "ratelimited";
  }
}

export interface SlackUser {
  id: string;
  team_id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_admin?: boolean;
  tz?: string;
  profile?: {
    email?: string;
    display_name?: string;
    real_name?: string;
    image_512?: string;
    image_192?: string;
    bot_id?: string;
    title?: string;
  };
}

export interface SlackConversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_member?: boolean;
  is_general?: boolean;
  created?: number;
  creator?: string;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  mode?: string;
  url_private?: string;
  url_private_download?: string;
  original_w?: number;
  original_h?: number;
}

export interface SlackReaction {
  name: string;
  users?: string[];
  count?: number;
}

export interface SlackMessage {
  type?: string;
  subtype?: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string; id?: string };
  text?: string;
  blocks?: unknown[];
  attachments?: { fallback?: string; text?: string; title?: string; title_link?: string }[];
  files?: SlackFile[];
  reactions?: SlackReaction[];
  pinned_to?: string[];
  pinned_info?: { pinned_by?: string; pinned_ts?: number };
  edited?: { user?: string; ts?: string };
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  parent_user_id?: string;
  hidden?: boolean;
  root?: { ts?: string };
}

export interface SlackBookmark {
  id: string;
  title?: string;
  link?: string;
  emoji?: string;
  type?: string;
}

interface Envelope {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
  [key: string]: unknown;
}

function base(): string {
  return process.env.SLACK_API_BASE?.trim() || DEFAULT_BASE;
}

function token(): string {
  const t = process.env.SLACK_USER_TOKEN?.trim();
  if (!t) throw new SlackNotConfiguredError();
  return t;
}

/**
 * One call. A `ratelimited` answer is retried once after the `Retry-After` Slack asks for
 * (capped so a cron slice cannot sleep through its own budget); a second one is thrown for the
 * caller to release its work and stop.
 */
export async function slackCall<T extends Envelope = Envelope>(
  method: string,
  args: Record<string, string | number | boolean | undefined> = {},
  opts: { timeoutMs?: number; retryOnRateLimit?: boolean } = {},
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) body.set(k, String(v));
  const res = await fetchWithTimeout(
    `${base()}/${method}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    opts.timeoutMs ?? 15_000,
  );
  const retryAfter = Number(res.headers.get("retry-after") ?? "0") || undefined;
  const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as T;
  if (json.ok) return json;
  const code = json.error ?? `http_${res.status}`;
  if (code === "ratelimited" && (opts.retryOnRateLimit ?? true)) {
    await new Promise((r) => setTimeout(r, Math.min(retryAfter ?? 5, 20) * 1000));
    return slackCall<T>(method, args, { ...opts, retryOnRateLimit: false });
  }
  throw new SlackApiError(method, code, retryAfter);
}

/** Walks every page of a cursor-paginated method, collecting `pick(page)`. */
export async function paginate<T, P extends Envelope = Envelope>(
  method: string,
  args: Record<string, string | number | boolean | undefined>,
  pick: (page: P) => T[],
  limit = 200,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await slackCall<P>(method, { ...args, limit, cursor });
    out.push(...pick(page));
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

export async function teamInfo(): Promise<{ id: string; name: string; domain: string }> {
  const r = await slackCall<Envelope & { team: { id: string; name: string; domain: string } }>("team.info");
  return r.team;
}

export async function listUsers(): Promise<SlackUser[]> {
  return paginate<SlackUser, Envelope & { members: SlackUser[] }>("users.list", {}, (p) => p.members ?? []);
}

export async function listConversations(): Promise<SlackConversation[]> {
  return paginate<SlackConversation, Envelope & { channels: SlackConversation[] }>(
    "conversations.list",
    { types: "public_channel,private_channel", exclude_archived: false },
    (p) => p.channels ?? [],
  );
}

export async function conversationInfo(channel: string): Promise<SlackConversation> {
  const r = await slackCall<Envelope & { channel: SlackConversation }>("conversations.info", { channel });
  return r.channel;
}

export async function listMembers(channel: string): Promise<string[]> {
  return paginate<string, Envelope & { members: string[] }>(
    "conversations.members",
    { channel },
    (p) => p.members ?? [],
  );
}

export interface HistoryPage {
  messages: SlackMessage[];
  hasMore: boolean;
}

/** One page, newest first. `latest` (exclusive) walks backwards; `oldest` (exclusive) walks forwards. */
export async function historyPage(
  channel: string,
  opts: { latest?: string; oldest?: string; limit?: number; cursor?: string } = {},
): Promise<HistoryPage & { nextCursor?: string }> {
  const page = await slackCall<Envelope & { messages: SlackMessage[]; has_more?: boolean }>("conversations.history", {
    channel,
    latest: opts.latest,
    oldest: opts.oldest,
    inclusive: false,
    limit: opts.limit ?? 200,
    cursor: opts.cursor,
  });
  return {
    messages: page.messages ?? [],
    hasMore: Boolean(page.has_more),
    nextCursor: page.response_metadata?.next_cursor || undefined,
  };
}

/** Every message in a thread, oldest first, the parent as item 0. */
export async function threadReplies(channel: string, ts: string, oldest?: string): Promise<SlackMessage[]> {
  return paginate<SlackMessage, Envelope & { messages: SlackMessage[] }>(
    "conversations.replies",
    { channel, ts, oldest, inclusive: false },
    (p) => p.messages ?? [],
    1000,
  );
}

export async function listBookmarks(channel: string): Promise<SlackBookmark[]> {
  const r = await slackCall<Envelope & { bookmarks?: SlackBookmark[] }>("bookmarks.list", { channel_id: channel });
  return r.bookmarks ?? [];
}

/** A file's bytes. Slack's private URLs need the same bearer token; nothing else about the URL is trusted. */
export async function downloadFile(
  url: string,
  maxBytes: number,
): Promise<{ ok: true; body: ArrayBuffer; contentType: string | null } | { ok: false; error: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)slack\.com$|(^|\.)slack-edge\.com$|(^|\.)slack-files\.com$/.test(u.hostname)) {
    return { ok: false, error: `refusing to fetch ${u.hostname}` };
  }
  const res = await fetchWithTimeout(
    url,
    { headers: { Authorization: `Bearer ${token()}` }, redirect: "follow" },
    30_000,
  );
  if (!res.ok) return { ok: false, error: `http_${res.status}` };
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, error: "too_large" };
  const body = await res.arrayBuffer();
  if (body.byteLength > maxBytes) return { ok: false, error: "too_large" };
  return { ok: true, body, contentType: res.headers.get("content-type") };
}
