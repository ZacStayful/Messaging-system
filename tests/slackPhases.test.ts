import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ApplyContext } from "@/lib/slack/apply";
import { historyPage, listBookmarks, listMembers, threadReplies, type SlackMessage } from "@/lib/slack/client";
import { Directory } from "@/lib/slack/directory";
import { Budget } from "@/lib/slack/lease";
import { syncConversation } from "@/lib/slack/backfill";
import { materialiseConversation } from "@/lib/slack/conversations";

/**
 * The phase machine: ready → members → history → files → bookmarks → complete, and what happens
 * when a slice runs out of time part-way through.
 *
 * This is the part of the import with no second chance. `messages.created_at` is immutable once
 * written (0030), the backfill walks Slack's history *backwards* from a watermark, and a cron
 * slice is killed at 60 seconds whether or not it has finished — so "resumes exactly where it
 * stopped, reading nothing twice" is a property worth asserting rather than assuming.
 */

vi.mock("@/lib/slack/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/slack/client")>()),
  historyPage: vi.fn(),
  threadReplies: vi.fn(),
  listMembers: vi.fn(),
  listBookmarks: vi.fn(),
  conversationInfo: vi.fn(),
  joinChannel: vi.fn(),
}));
vi.mock("@/lib/slack/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/slack/conversations")>()),
  materialiseConversation: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

type LinkRow = Database["public"]["Tables"]["slack_conversations"]["Row"];

const ts = (n: number) => `1700000${String(n).padStart(3, "0")}.000100`;

function link(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    org_id: "org-1",
    slack_channel_id: "C1",
    kind: "group",
    name: "general",
    is_private: true,
    is_archived: false,
    is_member: true,
    topic: null,
    purpose: null,
    creator: null,
    created_ts: "1600000000",
    members: [],
    decision: "create",
    skip_reason: null,
    decision_source: "auto",
    target_kind: "internal",
    property_id: null,
    property_address: null,
    address_guessed: false,
    customer_channel_id: null,
    conversation_id: null,
    status: "ready",
    history_low_ts: null,
    history_high_ts: null,
    next_sync_at: null,
    last_synced_at: null,
    threads_checked_at: null,
    imported_messages: 0,
    imported_replies: 0,
    imported_files: 0,
    skipped_files: 0,
    member_outcomes: {},
    last_error: null,
    claimed_at: null,
    attempts: 0,
    updated_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

/**
 * A database that remembers. The other Slack fixtures answer every query with canned rows, which
 * is enough to check what a writer writes; a phase machine reads its own last write back, so this
 * one applies each patch to the row it is holding — which is also what makes "resume" testable.
 */
function statefulDb(row: LinkRow, pendingFiles = 0) {
  let current = { ...row };
  const patches: Partial<LinkRow>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  let filesLeft = pendingFiles;

  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "gt",
      "lt",
      "gte",
      "lte",
      "or",
      "match",
      "order",
      "limit",
    ])
      chain[m] = self;
    chain.insert = () => chain;
    chain.upsert = () => chain;
    chain.update = (payload: Record<string, unknown>) => {
      if (table === "slack_conversations") {
        patches.push(payload as Partial<LinkRow>);
        current = { ...current, ...(payload as Partial<LinkRow>) };
      }
      return chain;
    };
    chain.single = async () => ({ data: table === "slack_conversations" ? current : null, error: null });
    chain.maybeSingle = async () => ({ data: table === "slack_conversations" ? current : null, error: null });
    chain.then = (resolve: (v: unknown) => void) =>
      // The files phase asks how many rows are still pending before it moves on.
      resolve({ data: [], error: null, count: table === "slack_files" ? filesLeft : 0 });
    return chain;
  };

  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    if (name === "import_slack_messages") {
      const rows = args.p_rows as { ts: string; thread_ts: string | null }[];
      return { data: rows.map((r) => ({ ts: r.ts, message_id: `m-${r.ts}`, outcome: "inserted" })), error: null };
    }
    if (name === "import_slack_members") return { data: {}, error: null };
    if (name === "slack_finish_backfill") {
      current = {
        ...current,
        status: "complete",
        completed_at: new Date().toISOString(),
        claimed_at: null,
        attempts: 0,
        last_error: null,
        next_sync_at: new Date(Date.now() + 86_400_000).toISOString(),
      };
    }
    return { data: null, error: null };
  };

  const admin = { from: builder, rpc } as unknown as SupabaseClient<Database>;
  return {
    admin,
    patches,
    rpcCalls,
    row: () => current,
    setFilesLeft: (n: number) => {
      filesLeft = n;
    },
  };
}

function context(admin: SupabaseClient<Database>): ApplyContext {
  const directory = new Directory();
  directory.add("U1", {
    profileId: "p-zac",
    displayName: "Zac",
    accountType: "team",
    isBot: false,
    isGuest: false,
    deactivated: false,
  });
  return { admin, actor: admin, orgId: "org-1", directory, importBotMessages: true };
}

const msg = (n: number): SlackMessage => ({ ts: ts(n), user: "U1", text: `message ${n}` });

/** Serves `messages` newest first, honouring the exclusive `latest` bound the backfill walks by. */
function paged(messages: SlackMessage[], perPage = 2) {
  return async (_channel: string, opts: { latest?: string } = {}) => {
    const older = messages
      .filter((m) => !opts.latest || Number(m.ts) < Number(opts.latest))
      .sort((a, b) => Number(b.ts) - Number(a.ts));
    return { messages: older.slice(0, perPage), hasMore: older.length > perPage };
  };
}
const entry = () => ({ channel: "C1", name: "general", from: "ready", to: "ready" });

describe("syncConversation", () => {
  it("walks a channel from ready to complete, once, in order", async () => {
    vi.mocked(materialiseConversation).mockResolvedValue({ conversationId: "conv-1", propertyId: null });
    vi.mocked(listMembers).mockResolvedValue(["U1"]);
    vi.mocked(historyPage).mockResolvedValue({ messages: [msg(2), msg(1)], hasMore: false });
    vi.mocked(listBookmarks).mockResolvedValue([]);

    const db = statefulDb(link());
    const out = entry();
    await syncConversation(context(db.admin), "p-zac", link(), new Budget(60_000), out);

    // Each phase names the next one, so the sequence is the record of what ran.
    const statuses = db.patches.map((p) => p.status).filter(Boolean);
    expect(statuses).toEqual(["members", "history", "files", "bookmarks"]);
    expect(db.rpcCalls.map((c) => c.name)).toContain("slack_finish_backfill");
    expect(db.row().status).toBe("complete");
    expect(db.row().claimed_at).toBeNull();
    expect(db.row().attempts).toBe(0);
    // Two top-level messages, no replies.
    expect(db.row().imported_messages).toBe(2);
    expect(db.row().imported_replies).toBe(0);
  });

  it("writes the oldest ts it has read as the low watermark, and the newest as the high", async () => {
    vi.mocked(materialiseConversation).mockResolvedValue({ conversationId: "conv-1", propertyId: null });
    vi.mocked(listMembers).mockResolvedValue(["U1"]);
    // Slack answers newest first; the page holds 3, 2, 1.
    vi.mocked(historyPage).mockResolvedValue({ messages: [msg(3), msg(2), msg(1)], hasMore: false });
    vi.mocked(listBookmarks).mockResolvedValue([]);

    const db = statefulDb(link());
    await syncConversation(context(db.admin), "p-zac", link(), new Budget(60_000), entry());

    expect(db.row().history_low_ts).toBe(ts(1));
    expect(db.row().history_high_ts).toBe(ts(3));
  });

  it("resumes a half-read history from the low watermark, asking Slack for nothing it already has", async () => {
    vi.mocked(listMembers).mockResolvedValue(["U1"]);
    vi.mocked(historyPage).mockImplementation(paged([msg(1), msg(2), msg(6), msg(7)]));
    vi.mocked(listBookmarks).mockResolvedValue([]);

    // A previous slice stopped after one page: the row carries both marks and the history phase.
    const half = link({
      status: "history",
      conversation_id: "conv-1",
      history_low_ts: ts(5),
      history_high_ts: ts(9),
      imported_messages: 4,
    });
    const db = statefulDb(half);
    await syncConversation(context(db.admin), "p-zac", half, new Budget(60_000), entry());

    // `latest` is the low watermark and exclusive, so the page before it is what comes back.
    expect(vi.mocked(historyPage).mock.calls[0][1]).toMatchObject({ latest: ts(5) });
    // The conversation is not created a second time, and the high watermark is left where it was.
    expect(materialiseConversation).not.toHaveBeenCalled();
    expect(db.row().history_high_ts).toBe(ts(9));
    // Only the two older than the watermark; 6 and 7 were read by the previous slice.
    expect(db.row().imported_messages).toBe(6);
  });

  it("stops inside the history phase when the budget runs out, and keeps the phase for next time", async () => {
    vi.mocked(listMembers).mockResolvedValue(["U1"]);
    // Six messages, two to a page: more than one slice's worth.
    vi.mocked(historyPage).mockImplementation(paged([msg(1), msg(2), msg(3), msg(4), msg(5), msg(6)]));

    const started = link({ status: "history", conversation_id: "conv-1" });
    const db = statefulDb(started);
    // The loop asks for 10 seconds before each page; with 9 it declines the first one.
    await syncConversation(context(db.admin), "p-zac", started, new Budget(9_000), entry());

    expect(vi.mocked(historyPage)).not.toHaveBeenCalled();
    expect(db.row().status).toBe("history");
    expect(db.row().claimed_at).toBeNull();
    expect(db.rpcCalls.map((c) => c.name)).not.toContain("slack_finish_backfill");
  });

  it("holds in the files phase while downloads are still queued", async () => {
    const atFiles = link({ status: "files", conversation_id: "conv-1" });
    const db = statefulDb(atFiles, 4);
    await syncConversation(context(db.admin), "p-zac", atFiles, new Budget(60_000), entry());

    expect(db.row().status).toBe("files");
    expect(db.rpcCalls.map((c) => c.name)).not.toContain("slack_finish_backfill");
  });

  it("records the reason on a failure and gives up only after five tries", async () => {
    vi.mocked(listMembers).mockRejectedValue(new Error("channel_not_found"));

    const failing = link({ status: "members", conversation_id: "conv-1" });
    const db = statefulDb(failing);
    await syncConversation(context(db.admin), "p-zac", failing, new Budget(60_000), entry());
    expect(db.row().status).toBe("members");
    expect(db.row().attempts).toBe(1);
    expect(db.row().last_error).toBe("channel_not_found");

    const nearlyDone = link({ status: "members", conversation_id: "conv-1", attempts: 4 });
    const db2 = statefulDb(nearlyDone);
    await syncConversation(context(db2.admin), "p-zac", nearlyDone, new Budget(60_000), entry());
    expect(db2.row().status).toBe("error");
    expect(db2.row().attempts).toBe(5);
  });

  it("imports a thread's replies with its parents and counts them apart", async () => {
    vi.mocked(materialiseConversation).mockResolvedValue({ conversationId: "conv-1", propertyId: null });
    vi.mocked(listMembers).mockResolvedValue(["U1"]);
    const parent: SlackMessage = { ts: ts(1), user: "U1", text: "parent", reply_count: 2 };
    vi.mocked(historyPage).mockResolvedValue({ messages: [parent], hasMore: false });
    vi.mocked(threadReplies).mockResolvedValue([
      parent,
      { ts: ts(2), user: "U1", text: "reply one", thread_ts: ts(1) },
      { ts: ts(3), user: "U1", text: "reply two", thread_ts: ts(1) },
    ]);
    vi.mocked(listBookmarks).mockResolvedValue([]);

    const db = statefulDb(link());
    await syncConversation(context(db.admin), "p-zac", link(), new Budget(60_000), entry());

    expect(vi.mocked(threadReplies)).toHaveBeenCalledWith("C1", ts(1));
    expect(db.row().imported_messages).toBe(1);
    expect(db.row().imported_replies).toBe(2);
  });
});
