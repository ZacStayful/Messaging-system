import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { CLEAR_OPTIONS, DND_OPTIONS } from "@/lib/presence";
import type { Scope } from "@/lib/api/keys";
import { userClient, type ApiKeyContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/respond";
import * as service from "@/lib/api/service";
import { logApiCall } from "@/lib/api/audit";

/**
 * The MCP face of the same service layer the REST API uses. Every tool body is a few lines of
 * argument shuffling over `src/lib/api/service.ts` — deliberately, because two front doors
 * onto the same data will drift the moment either grows logic of its own.
 */

/** What withMcpAuth stashes in AuthInfo.extra, so a tool can act as the key's user. */
export interface McpAuthExtra {
  ctx: ApiKeyContext;
}

/** The slice of the SDK's tool context we read. Typed locally to avoid leaking its internals. */
interface ToolContext {
  http?: { authInfo?: { extra?: Record<string, unknown> } };
}

const clearIds = CLEAR_OPTIONS.map((o) => o.id);
const dndIds = DND_OPTIONS.map((o) => o.id);
const clearEnum = z.enum(clearIds as [string, ...string[]]);
const dndEnum = z.enum(dndIds as [string, ...string[]]);
const uuid = z.string().uuid();

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Pulls the verified key context off the request and checks this tool's scopes.
 *
 * Scopes are enforced per tool rather than only at the endpoint, because withMcpAuth's
 * requiredScopes gate is endpoint-wide — and the point of scopes is that one key can be
 * read-only while still being able to connect.
 */
function actor(ctx: ToolContext, required: Scope[]): { ctx: ApiKeyContext; db: ReturnType<typeof userClient> } {
  const extra = ctx.http?.authInfo?.extra as McpAuthExtra | undefined;
  if (!extra?.ctx) throw new ApiError("unauthorized", "This request carried no valid API key.");
  const missing = required.filter((s) => !extra.ctx.scopes.includes(s));
  if (missing.length) {
    throw new ApiError("insufficient_scope", `This key is missing the ${missing.join(", ")} scope.`);
  }
  return { ctx: extra.ctx, db: userClient(extra.ctx) };
}

function requireTeam(ctx: ApiKeyContext) {
  if (ctx.profile.account_type !== "team") {
    throw new ApiError("forbidden", "This tool is only available to a key acting as a Stayful team member.");
  }
}

/**
 * Wraps a tool body so a failure reaches the model as a readable message, not a stack trace,
 * and so a write leaves an audit row. `name` is passed for the audit entry; omit it for reads,
 * which are not logged (a row per read would bury the writes).
 */
function tool<A>(run: (args: A, ctx: ToolContext) => Promise<unknown>, writes?: string) {
  return async (args: A, ctx: ToolContext) => {
    try {
      const result = await run(args, ctx);
      if (writes) {
        const extra = ctx.http?.authInfo?.extra as McpAuthExtra | undefined;
        if (extra?.ctx) {
          await logApiCall(userClient(extra.ctx), extra.ctx, {
            action: `mcp.${writes}`,
            entity: "tool",
            entity_id: writes,
          });
        }
      }
      return text(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!(e instanceof ApiError)) console.error("[mcp] tool failed", e);
      return failure(message);
    }
  };
}

/** Appended to every write tool, so an agent knows it is acting in a live workspace. */
const LIVE = "This acts as the API key's Stayful team member and is immediately visible to real people.";

export function registerTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------
  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "Every group, channel and direct message the key's user belongs to, with unread counts. " +
        "Start here: other tools need a conversation id.",
      inputSchema: z.object({
        include_archived: z.boolean().optional().describe("Include archived groups. Defaults to false."),
      }),
    },
    tool(async (args: { include_archived?: boolean }, c) => {
      const { db } = actor(c, ["conversations:read"]);
      return service.listConversations(db, { includeArchived: args.include_archived });
    }),
  );

  server.registerTool(
    "get_conversation",
    {
      title: "Get a conversation",
      description: "One conversation's name, topic, members and unread count.",
      inputSchema: z.object({ conversation_id: uuid }),
    },
    tool(async (args: { conversation_id: string }, c) => {
      const { db } = actor(c, ["conversations:read"]);
      return service.getConversation(db, args.conversation_id);
    }),
  );

  server.registerTool(
    "list_messages",
    {
      title: "Read messages",
      description:
        "Recent messages in a conversation, oldest first. Page backwards by passing the oldest " +
        "created_at you have seen as `before`.",
      inputSchema: z.object({
        conversation_id: uuid,
        before: z.string().optional().describe("ISO timestamp; returns messages older than this."),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    tool(async (args: { conversation_id: string; before?: string; limit?: number }, c) => {
      const { db } = actor(c, ["messages:read"]);
      return service.listMessages(db, args.conversation_id, { before: args.before, limit: args.limit });
    }),
  );

  server.registerTool(
    "list_thread_replies",
    {
      title: "Read a thread",
      description: "The replies to one message.",
      inputSchema: z.object({ message_id: uuid, limit: z.number().int().min(1).max(100).optional() }),
    },
    tool(async (args: { message_id: string; limit?: number }, c) => {
      const { db } = actor(c, ["messages:read"]);
      return service.listReplies(db, args.message_id, { limit: args.limit });
    }),
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search messages",
      description: "Full-text search across every conversation the key's user can read.",
      inputSchema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() }),
    },
    tool(async (args: { query: string; limit?: number }, c) => {
      const { db } = actor(c, ["messages:read"]);
      return service.searchMessages(db, args.query, { limit: args.limit });
    }),
  );

  server.registerTool(
    "list_people",
    {
      title: "List people",
      description: "The people directory — use it to find the user ids that add_members and open_dm need.",
      inputSchema: z.object({
        query: z.string().optional().describe("Filter by name or email."),
        account_type: z.enum(["team", "customer"]).optional(),
      }),
    },
    tool(async (args: { query?: string; account_type?: "team" | "customer" }, c) => {
      const { db } = actor(c, ["users:read"]);
      return service.listPeople(db, { query: args.query, accountType: args.account_type });
    }),
  );

  server.registerTool(
    "list_bookmarks",
    {
      title: "List bookmarks",
      description: "The links pinned to a conversation's bookmark bar.",
      inputSchema: z.object({ conversation_id: uuid }),
    },
    tool(async (args: { conversation_id: string }, c) => {
      const { db } = actor(c, ["bookmarks:read"]);
      return service.listBookmarks(db, args.conversation_id);
    }),
  );

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------
  server.registerTool(
    "send_message",
    {
      title: "Send a message",
      description:
        `Post a message into a conversation. ${LIVE} ` +
        "Pass a stable `client_id` when retrying, so a retry returns the original message instead " +
        "of posting twice. Supports the app's markdown-ish formatting and @[Full Name] mentions.",
      inputSchema: z.object({
        conversation_id: uuid,
        body: z.string().min(1),
        parent_id: uuid.optional().describe("Reply in this message's thread."),
        visibility: z
          .enum(["public", "internal"])
          .optional()
          .describe("`internal` is a team-only note customers never see. Defaults to public."),
        client_id: z.string().max(120).optional(),
      }),
    },
    tool(
      async (
        args: {
          conversation_id: string;
          body: string;
          parent_id?: string;
          visibility?: "public" | "internal";
          client_id?: string;
        },
        c,
      ) => {
        const { ctx, db } = actor(c, ["messages:write"]);
        return service.sendMessage(
          db,
          ctx,
          {
            conversationId: args.conversation_id,
            body: args.body,
            parentId: args.parent_id,
            visibility: args.visibility,
            clientId: args.client_id,
          },
          "mcp",
        );
      },
      "send_message",
    ),
  );

  server.registerTool(
    "create_group",
    {
      title: "Create a group",
      description: `Create a named group or internal channel and add members to it. ${LIVE}`,
      inputSchema: z.object({
        name: z.string().min(1).describe("Lower-case and hyphenated, like a Slack channel."),
        type: z
          .enum(["owner", "internal", "job"])
          .optional()
          .describe("`owner` for a customer-facing group, `internal` for team-only. Defaults to internal."),
        member_ids: z.array(uuid).optional(),
        topic: z.string().optional(),
      }),
    },
    tool(
      async (args: { name: string; type?: "owner" | "internal" | "job"; member_ids?: string[]; topic?: string }, c) => {
        const { ctx, db } = actor(c, ["conversations:write"]);
        requireTeam(ctx);
        return service.createGroup(db, {
          name: args.name,
          type: args.type,
          memberIds: args.member_ids,
          topic: args.topic,
        });
      },
      "create_group",
    ),
  );

  server.registerTool(
    "open_dm",
    {
      title: "Open a direct message",
      description: `Find or create the direct message with one person, and return its conversation id. ${LIVE}`,
      inputSchema: z.object({ user_id: uuid }),
    },
    tool(async (args: { user_id: string }, c) => {
      const { db } = actor(c, ["conversations:write"]);
      return service.openDm(db, args.user_id);
    }, "open_dm"),
  );

  server.registerTool(
    "add_members",
    {
      title: "Add members to a group",
      description: `Add existing people to a group. Use invite_member for someone without an account. ${LIVE}`,
      inputSchema: z.object({ conversation_id: uuid, user_ids: z.array(uuid).min(1) }),
    },
    tool(async (args: { conversation_id: string; user_ids: string[] }, c) => {
      const { ctx, db } = actor(c, ["members:write"]);
      requireTeam(ctx);
      return service.addMembers(db, args.conversation_id, args.user_ids);
    }, "add_members"),
  );

  server.registerTool(
    "remove_member",
    {
      title: "Remove a member from a group",
      description: `Remove someone from a group. They lose access to it immediately. ${LIVE}`,
      inputSchema: z.object({ conversation_id: uuid, user_id: uuid }),
    },
    tool(async (args: { conversation_id: string; user_id: string }, c) => {
      const { ctx, db } = actor(c, ["members:write"]);
      requireTeam(ctx);
      return service.removeMember(db, args.conversation_id, args.user_id);
    }, "remove_member"),
  );

  server.registerTool(
    "invite_member",
    {
      title: "Invite someone to Stayful",
      description:
        "Create an account for someone who does not have one, add them to groups, and email them " +
        `their login details. ${LIVE} The welcome email is the same one the web app sends. ` +
        "Check list_people first — inviting an existing email fails.",
      inputSchema: z.object({
        email: z.string().email(),
        full_name: z.string().min(1),
        display_name: z.string().optional(),
        role: z
          .enum(["owner", "delegate", "staff", "admin"])
          .optional()
          .describe("`owner`/`delegate` are customers; `staff`/`admin` are Stayful team. Defaults to owner."),
        conversation_ids: z.array(uuid).optional().describe("Groups to add a customer to straight away."),
      }),
    },
    tool(
      async (
        args: {
          email: string;
          full_name: string;
          display_name?: string;
          role?: "owner" | "delegate" | "staff" | "admin";
          conversation_ids?: string[];
        },
        c,
      ) => {
        const { ctx, db } = actor(c, ["users:invite"]);
        requireTeam(ctx);
        return service.invitePerson(db, ctx, {
          email: args.email,
          fullName: args.full_name,
          displayName: args.display_name,
          role: args.role,
          conversationIds: args.conversation_ids,
        });
      },
      "invite_member",
    ),
  );

  server.registerTool(
    "add_bookmark",
    {
      title: "Add a bookmark to a group",
      description:
        `Pin a link to a group's bookmark bar, where every member can see it. ${LIVE} ` +
        "http and https only; private and local addresses are rejected.",
      inputSchema: z.object({
        conversation_id: uuid,
        title: z.string().min(1).max(120),
        url: z.string().url(),
        emoji: z.string().max(8).optional(),
        note: z.string().max(500).optional().describe("Anything worth knowing — a gate code, which tab to open."),
      }),
    },
    tool(async (args: { conversation_id: string; title: string; url: string; emoji?: string; note?: string }, c) => {
      const { db } = actor(c, ["bookmarks:write"]);
      return service.addBookmark(db, args.conversation_id, {
        title: args.title,
        url: args.url,
        emoji: args.emoji,
        note: args.note,
      });
    }, "add_bookmark"),
  );

  server.registerTool(
    "remove_bookmark",
    {
      title: "Remove a bookmark",
      description: `Remove a bookmark from its group. ${LIVE}`,
      inputSchema: z.object({ bookmark_id: uuid }),
    },
    tool(async (args: { bookmark_id: string }, c) => {
      const { db } = actor(c, ["bookmarks:write"]);
      return service.deleteBookmark(db, args.bookmark_id);
    }, "remove_bookmark"),
  );

  server.registerTool(
    "set_my_status",
    {
      title: "Set status, away or do-not-disturb",
      description:
        "Change the status of the person this key acts as. Setting `away` shows an Away badge to " +
        `everyone and stops all their notifications until it is cleared. ${LIVE}`,
      inputSchema: z.object({
        text: z.string().max(100).nullable().optional(),
        emoji: z.string().max(8).nullable().optional(),
        clear_after: clearEnum.optional().describe("When the status text should clear."),
        away: z.boolean().optional(),
        away_until: clearEnum.optional(),
        dnd_for: dndEnum.optional().describe("Pause notifications without appearing away."),
      }),
    },
    tool(
      async (
        args: {
          text?: string | null;
          emoji?: string | null;
          clear_after?: string;
          away?: boolean;
          away_until?: string;
          dnd_for?: string;
        },
        c,
      ) => {
        const { ctx, db } = actor(c, ["status:write"]);
        return service.setMyStatus(db, ctx, {
          text: args.text,
          emoji: args.emoji,
          clearAfter: args.clear_after as Parameters<typeof service.setMyStatus>[2]["clearAfter"],
          away: args.away,
          awayUntil: args.away_until as Parameters<typeof service.setMyStatus>[2]["awayUntil"],
          dndFor: args.dnd_for as Parameters<typeof service.setMyStatus>[2]["dndFor"],
        });
      },
      "set_my_status",
    ),
  );

  server.registerTool(
    "whoami",
    {
      title: "Who this key acts as",
      description: "The person this key acts as and the scopes it holds. Useful when a tool returns a scope error.",
      inputSchema: z.object({}),
    },
    tool(async (_args: Record<string, never>, c) => {
      const extra = c.http?.authInfo?.extra as McpAuthExtra | undefined;
      if (!extra?.ctx) throw new ApiError("unauthorized", "This request carried no valid API key.");
      return service.me(extra.ctx);
    }),
  );
}
