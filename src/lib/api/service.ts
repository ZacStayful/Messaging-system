import type { ConversationBookmark, Database, Message } from "@/lib/database.types";
import { untilFor, type ClearId, type DndId } from "@/lib/presence";
import { safeHttpUrl } from "@/lib/urls";
import { createAccountAndInvite, type InviteOutcome, type InviteRole } from "./invite";
import { ApiError } from "./respond";
import type { ApiClient, ApiKeyContext } from "./auth";

/**
 * The whole API surface, once.
 *
 * Both the REST routes and the MCP tools call these functions and neither contains any logic
 * of its own, which is the only thing keeping two front doors onto the same data from drifting
 * apart. Everything here runs on a client that acts as the key's user, so RLS is doing the
 * access control and these functions only shape input and output.
 */

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const MAX_PAGE = 100;

function clamp(n: number | undefined, fallback: number, max = MAX_PAGE): number {
  if (!n || !Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Throws whatever PostgREST said, so an RLS refusal reaches the caller intact. */
function must<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw result.error;
  if (result.data === null || result.data === undefined) {
    throw new ApiError("not_found", `${what} was not found, or you do not have access to it.`);
  }
  return result.data as NonNullable<T>;
}

async function assertMember(db: ApiClient, conversationId: string): Promise<void> {
  const { data } = await db.from("conversation_members").select("user_id").eq("conversation_id", conversationId);
  if (!data?.length) {
    throw new ApiError("not_found", "That conversation was not found, or you are not a member of it.");
  }
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

export function me(ctx: ApiKeyContext) {
  const p = ctx.profile;
  return {
    id: p.id,
    display_name: p.display_name,
    full_name: p.full_name,
    email: p.email,
    account_type: p.account_type,
    role: p.role,
    timezone: p.timezone,
    presence_mode: p.presence_mode,
    away_until: p.away_until,
    dnd_until: p.dnd_until,
    status_text: p.status_text,
    status_emoji: p.status_emoji,
    acting_via: { key_id: ctx.keyId, key_name: ctx.keyName, scopes: ctx.scopes },
  };
}

export interface StatusInput {
  text?: string | null;
  emoji?: string | null;
  clearAfter?: ClearId;
  away?: boolean;
  awayUntil?: ClearId;
  dndFor?: DndId;
}

export async function setMyStatus(db: ApiClient, ctx: ApiKeyContext, input: StatusInput) {
  const patch: ProfileUpdate = {};

  if (input.text !== undefined || input.emoji !== undefined) {
    const text = (input.text ?? "").trim();
    const emoji = (input.emoji ?? "").trim();
    const has = text || emoji;
    patch.status_text = has ? text || null : null;
    patch.status_emoji = has ? emoji || null : null;
    patch.status_expires_at = has && input.clearAfter ? untilFor(input.clearAfter) : null;
  }
  if (input.away !== undefined) {
    patch.presence_mode = input.away ? "away" : "auto";
    patch.away_since = input.away ? new Date().toISOString() : null;
    patch.away_until = input.away && input.awayUntil ? untilFor(input.awayUntil) : null;
  }
  if (input.dndFor !== undefined) patch.dnd_until = untilFor(input.dndFor);

  if (!Object.keys(patch).length) throw new ApiError("invalid_request", "Nothing to change.");
  const row = must(await db.from("profiles").update(patch).eq("id", ctx.userId).select().single(), "Your profile");
  return me({ ...ctx, profile: row });
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function listConversations(db: ApiClient, opts: { includeArchived?: boolean } = {}) {
  const rows = must(await db.rpc("my_conversations"), "Your conversations");
  return (opts.includeArchived ? rows : rows.filter((c) => !c.archived_at)).map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    member_ids: c.member_ids,
    unread_count: c.unread_count,
    last_message_at: c.last_message_at,
    archived_at: c.archived_at,
    muted: c.muted,
  }));
}

export async function getConversation(db: ApiClient, conversationId: string) {
  const all = must(await db.rpc("my_conversations"), "Your conversations");
  const found = all.find((c) => c.id === conversationId);
  if (!found) throw new ApiError("not_found", "That conversation was not found, or you are not a member of it.");
  return found;
}

export interface CreateGroupInput {
  name: string;
  type?: "owner" | "internal" | "job";
  memberIds?: string[];
  topic?: string | null;
}

export async function createGroup(db: ApiClient, input: CreateGroupInput) {
  const name = input.name.trim();
  if (!name) throw new ApiError("invalid_request", "A group needs a name.");
  const id = must(
    await db.rpc("create_channel", {
      p_name: name,
      p_type: input.type ?? "internal",
      p_member_ids: input.memberIds ?? [],
      p_topic: input.topic ?? null,
    }),
    "The group",
  );
  return getConversation(db, id);
}

export async function openDm(db: ApiClient, userId: string) {
  const id = must(await db.rpc("dm_between", { other: userId }), "The direct message");
  return getConversation(db, id);
}

export async function setConversationDetails(
  db: ApiClient,
  conversationId: string,
  patch: { name?: string; topic?: string | null; description?: string | null; archived?: boolean },
) {
  if (patch.name !== undefined) {
    const { error } = await db.rpc("rename_channel", { p_conversation_id: conversationId, p_name: patch.name.trim() });
    if (error) throw error;
  }
  if (patch.topic !== undefined || patch.description !== undefined) {
    const current = await getConversation(db, conversationId);
    const { error } = await db.rpc("set_channel_details", {
      p_conversation_id: conversationId,
      p_topic: patch.topic !== undefined ? patch.topic : current.topic,
      p_description: patch.description !== undefined ? patch.description : null,
    });
    if (error) throw error;
  }
  if (patch.archived !== undefined) {
    const { error } = await db.rpc("archive_channel", {
      p_conversation_id: conversationId,
      p_archived: patch.archived,
    });
    if (error) throw error;
  }
  return getConversation(db, conversationId);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(db: ApiClient, conversationId: string) {
  await assertMember(db, conversationId);
  const rows = must(
    await db
      .from("conversation_members")
      .select("user_id, joined_at, profile:profiles(id, display_name, full_name, email, account_type, role)")
      .eq("conversation_id", conversationId),
    "The members",
  );
  return rows;
}

export async function addMembers(db: ApiClient, conversationId: string, userIds: string[]) {
  if (!userIds.length) throw new ApiError("invalid_request", "Give at least one user id to add.");
  const { error } = await db.rpc("add_members", { p_conversation_id: conversationId, p_user_ids: userIds });
  if (error) throw error;
  return listMembers(db, conversationId);
}

export async function removeMember(db: ApiClient, conversationId: string, userId: string) {
  const { error } = await db.rpc("remove_member", { p_conversation_id: conversationId, p_user_id: userId });
  if (error) throw error;
  return { removed: userId };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function publicMessage(m: Message) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    body: m.body,
    kind: m.kind,
    visibility: m.visibility,
    parent_id: m.parent_id,
    reply_count: m.reply_count,
    sent_via: m.sent_via,
    edited_at: m.edited_at,
    created_at: m.created_at,
  };
}

export async function listMessages(
  db: ApiClient,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
) {
  await assertMember(db, conversationId);
  let q = db
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .is("parent_id", null)
    .order("created_at", { ascending: false })
    .limit(clamp(opts.limit, 50));
  if (opts.before) q = q.lt("created_at", opts.before);
  const rows = must(await q, "The messages");
  // Newest-first over the wire (so `before` paginates naturally), oldest-first in the array.
  return rows.map(publicMessage).reverse();
}

export async function listReplies(db: ApiClient, messageId: string, opts: { limit?: number } = {}) {
  const parent = must(
    await db.from("messages").select("conversation_id").eq("id", messageId).maybeSingle(),
    "That message",
  );
  await assertMember(db, parent.conversation_id);
  const rows = must(
    await db
      .from("messages")
      .select("*")
      .eq("parent_id", messageId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(clamp(opts.limit, 50)),
    "The replies",
  );
  return rows.map(publicMessage);
}

export interface SendMessageInput {
  conversationId: string;
  body: string;
  parentId?: string | null;
  visibility?: "public" | "internal";
  /** Idempotency key. Re-sending with the same one returns the original message. */
  clientId?: string;
  externalRef?: string | null;
}

export async function sendMessage(
  db: ApiClient,
  ctx: ApiKeyContext,
  input: SendMessageInput,
  via: "api" | "mcp" = "api",
) {
  const body = input.body.trim();
  if (!body) throw new ApiError("invalid_request", "A message needs a body.");
  const visibility = input.visibility ?? "public";
  if (visibility === "internal" && ctx.profile.account_type !== "team") {
    throw new ApiError("forbidden", "Only a Stayful team member can post an internal note.");
  }
  await assertMember(db, input.conversationId);

  // Idempotency: a retry with the same client_id must not post twice. The unique index in
  // 0016 is what actually guarantees it under a race; this returns the original rather than
  // a 409, because a retried POST wants the message, not an error.
  if (input.clientId) {
    const { data: existing } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", input.conversationId)
      .eq("meta->>client_id", input.clientId)
      .maybeSingle();
    if (existing) return publicMessage(existing);
  }

  const insert = await db
    .from("messages")
    .insert({
      org_id: ctx.orgId,
      conversation_id: input.conversationId,
      sender_id: ctx.userId,
      body,
      parent_id: input.parentId ?? null,
      visibility,
      sent_via: via,
      external_ref: input.externalRef ?? null,
      meta: {
        client_id: input.clientId ?? crypto.randomUUID(),
        source: via,
        api_key_id: ctx.keyId,
      },
    })
    .select()
    .single();

  // Lost an idempotency race with an identical retry: return the row that won.
  if (insert.error?.code === "23505" && input.clientId) {
    const { data: winner } = await db
      .from("messages")
      .select("*")
      .eq("conversation_id", input.conversationId)
      .eq("meta->>client_id", input.clientId)
      .maybeSingle();
    if (winner) return publicMessage(winner);
  }
  return publicMessage(must(insert, "The message"));
}

export async function searchMessages(db: ApiClient, query: string, opts: { limit?: number } = {}) {
  const q = query.trim();
  if (!q) throw new ApiError("invalid_request", "Give something to search for.");
  return must(await db.rpc("search_messages", { q, max_rows: clamp(opts.limit, 40, 50) }), "The search results");
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export async function listPeople(db: ApiClient, opts: { query?: string; accountType?: "team" | "customer" } = {}) {
  let q = db
    .from("profiles")
    .select("id, display_name, full_name, email, account_type, role, timezone, presence_mode, away_until")
    .is("deactivated_at", null)
    .order("display_name", { ascending: true });
  if (opts.accountType) q = q.eq("account_type", opts.accountType);
  if (opts.query?.trim()) {
    const term = `%${opts.query.trim()}%`;
    q = q.or(`display_name.ilike.${term},full_name.ilike.${term},email.ilike.${term}`);
  }
  return must(await q, "The people directory");
}

export async function invitePerson(
  db: ApiClient,
  ctx: ApiKeyContext,
  input: { email: string; fullName: string; displayName?: string; role?: InviteRole; conversationIds?: string[] },
): Promise<Omit<InviteOutcome, "password"> & { password?: string }> {
  const outcome = await createAccountAndInvite(db, ctx.userId, input);
  // The generated password is only worth returning when no email could be sent; otherwise it
  // would put a live credential in an API response and whatever logs sit in front of it.
  if (outcome.emailStatus === "not_configured") return outcome;
  return {
    userId: outcome.userId,
    email: outcome.email,
    emailStatus: outcome.emailStatus,
    emailError: outcome.emailError,
    groups: outcome.groups,
  };
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export async function listBookmarks(db: ApiClient, conversationId: string) {
  await assertMember(db, conversationId);
  return must(
    await db
      .from("conversation_bookmarks")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    "The bookmarks",
  );
}

export interface BookmarkInput {
  title: string;
  url: string;
  emoji?: string | null;
  note?: string | null;
}

export async function addBookmark(db: ApiClient, conversationId: string, input: BookmarkInput) {
  const url = safeHttpUrl(input.url);
  if (!url) {
    throw new ApiError(
      "invalid_request",
      "A bookmark needs a full http:// or https:// link. Private and local addresses are not allowed.",
    );
  }
  if (!input.title.trim()) throw new ApiError("invalid_request", "A bookmark needs a title.");
  return must(
    await db.rpc("add_bookmark", {
      p_conversation_id: conversationId,
      p_title: input.title.trim(),
      p_url: url.toString(),
      p_emoji: input.emoji ?? null,
      p_note: input.note ?? null,
    }),
    "The bookmark",
  );
}

export async function updateBookmark(db: ApiClient, bookmarkId: string, input: Partial<BookmarkInput>) {
  const patch: Partial<ConversationBookmark> = {};
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new ApiError("invalid_request", "A bookmark needs a title.");
    patch.title = input.title.trim().slice(0, 120);
  }
  if (input.url !== undefined) {
    const url = safeHttpUrl(input.url);
    if (!url) throw new ApiError("invalid_request", "A bookmark needs a full http:// or https:// link.");
    patch.url = url.toString();
  }
  if (input.emoji !== undefined) patch.emoji = input.emoji;
  if (input.note !== undefined) patch.note = input.note;
  if (!Object.keys(patch).length) throw new ApiError("invalid_request", "Nothing to change.");

  return must(
    await db
      .from("conversation_bookmarks")
      .update(patch)
      .eq("id", bookmarkId)
      .select()
      .single()
      .then((r) => {
        // conversation_bookmarks_guard (0021) refuses a title or url change on a mandatory
        // bookmark, for anyone. Surface that as a request problem, not a raw Postgres error.
        if (r.error?.message.includes("bookmark_templates")) {
          throw new ApiError(
            "invalid_request",
            "That bookmark is set for every Stayful customer group. Change it in bookmark_templates instead.",
          );
        }
        return r;
      }),
    "That bookmark",
  );
}

export async function deleteBookmark(db: ApiClient, bookmarkId: string) {
  // RLS turns a refusal into zero rows rather than an error, so ask for the row back.
  const { data, error } = await db.from("conversation_bookmarks").delete().eq("id", bookmarkId).select("id");
  if (error) throw error;
  if (!data?.length) {
    // A mandatory bookmark is filtered out by the delete policy (0021) and looks identical to a
    // missing one from here. Say which, so a caller is not left guessing at a retry.
    const { data: row } = await db
      .from("conversation_bookmarks")
      .select("is_mandatory")
      .eq("id", bookmarkId)
      .maybeSingle();
    if (row?.is_mandatory) {
      throw new ApiError(
        "invalid_request",
        "That bookmark is on every Stayful customer group and cannot be removed. Change it in bookmark_templates instead.",
      );
    }
    throw new ApiError("not_found", "That bookmark was not found, or you are not allowed to remove it.");
  }
  return { removed: bookmarkId };
}

export async function moveBookmark(db: ApiClient, bookmarkId: string, delta: number) {
  const { error } = await db.rpc("move_bookmark", { p_id: bookmarkId, p_delta: delta });
  if (error) throw error;
  const row = must(
    await db.from("conversation_bookmarks").select("conversation_id").eq("id", bookmarkId).maybeSingle(),
    "That bookmark",
  );
  return listBookmarks(db, row.conversation_id);
}
