import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { applyMessages, markDeletedInWindow, type ApplyContext } from "@/lib/slack/apply";
import { SlackApiError, downloadFile, threadReplies, type SlackMessage } from "@/lib/slack/client";
import { Directory } from "@/lib/slack/directory";
import { FILE_MAX_ATTEMPTS, processFiles } from "@/lib/slack/files";
import { Budget } from "@/lib/slack/lease";
import type { ImportRow } from "@/lib/slack/normalise";
import { MAX_FILE_BYTES } from "@/lib/storage/attachments";
import { ingestAttachment } from "@/lib/storage/ingest";

/**
 * The writers of the Slack import: what they ask the database to do, and what they do with the
 * answer. Slack itself is stubbed at the client module, and the attachments bucket at
 * ingestAttachment; the database is the historyCapture fake with rpc recording added.
 */

vi.mock("@/lib/slack/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/slack/client")>()),
  threadReplies: vi.fn(),
  downloadFile: vi.fn(),
}));
vi.mock("@/lib/storage/ingest", () => ({ ingestAttachment: vi.fn() }));

afterEach(() => {
  vi.mocked(threadReplies).mockReset();
  vi.mocked(downloadFile).mockReset();
  vi.mocked(ingestAttachment).mockReset();
});

interface Write {
  table: string;
  op: "insert" | "update" | "upsert";
  payload: unknown;
  options?: unknown;
}
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}
interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * The historyCapture fixture, plus what a writer needs: every rpc is recorded and answered by
 * a handler set per name, and the update/upsert/filter methods chain. Filters are ignored —
 * every table answers with its canned rows whatever the query — so the checks are on what was
 * written and what was asked of the database, not on how it was asked.
 */
function fakeAdmin(tables: Record<string, unknown[]> = {}) {
  const writes: Write[] = [];
  const rpcCalls: RpcCall[] = [];
  const rpcHandlers: Record<string, (args: Record<string, unknown>) => RpcResult> = {};
  const builder = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const filters = [
      "select",
      "eq",
      "neq",
      "in",
      "is",
      "not",
      "ilike",
      "gt",
      "lt",
      "gte",
      "lte",
      "or",
      "match",
      "order",
      "limit",
    ];
    for (const m of filters) chain[m] = self;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.single = async () => ({ data: rows[0] ?? null, error: null });
    chain.insert = (payload: unknown) => {
      writes.push({ table, op: "insert", payload });
      return chain;
    };
    chain.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload });
      return chain;
    };
    chain.upsert = (payload: unknown, options?: unknown) => {
      writes.push({ table, op: "upsert", payload, options });
      return chain;
    };
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return chain;
  };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
    rpcCalls.push({ name, args });
    return rpcHandlers[name]?.(args) ?? { data: null, error: null };
  };
  const admin = { from: builder, rpc } as unknown as SupabaseClient<Database>;
  return { admin, writes, rpcCalls, rpcHandlers };
}

const updates = (writes: Write[], table: string) =>
  writes.filter((w) => w.table === table && w.op === "update").map((w) => w.payload);

describe("applyMessages", () => {
  const ts = (n: number) => `17000000${String(n).padStart(2, "0")}.000100`;
  const person = (profileId: string, displayName: string) => ({
    profileId,
    displayName,
    accountType: "team" as const,
    isBot: false,
    isGuest: false,
    deactivated: false,
  });

  /** Answers import_slack_messages the way the RPC does: a reply whose parent is not in yet is an orphan. */
  const importHandler = (outcomes: Record<string, string> = {}) => {
    const present = new Set<string>();
    return (args: Record<string, unknown>): RpcResult => ({
      data: (args.p_rows as ImportRow[]).map((r) => {
        if (r.thread_ts && !present.has(r.thread_ts)) return { ts: r.ts, message_id: null, outcome: "orphan" };
        present.add(r.ts);
        return { ts: r.ts, message_id: `m-${r.ts}`, outcome: outcomes[r.ts] ?? "inserted" };
      }),
      error: null,
    });
  };

  const setup = () => {
    const db = fakeAdmin();
    const actor = fakeAdmin();
    db.rpcHandlers.import_slack_messages = importHandler();
    const directory = new Directory();
    directory.add("U1", person("p-zac", "Zac"));
    directory.add("U2", person("p-nigel", "Nigel Hyde"));
    const ctx: ApplyContext = {
      admin: db.admin,
      actor: actor.admin,
      orgId: "org-1",
      directory,
      importBotMessages: true,
    };
    return { ...db, actor, ctx };
  };
  const importCalls = (calls: RpcCall[]) => calls.filter((c) => c.name === "import_slack_messages");
  const rowsOf = (call: RpcCall) => call.args.p_rows as ImportRow[];

  it("normalises the window, oldest first, and hands it to import_slack_messages in one call", async () => {
    const { ctx, rpcCalls } = setup();
    const messages: SlackMessage[] = [
      { ts: ts(3), user: "U1", text: "three", reactions: [{ name: "thumbsup", users: ["U1", "U9"] }] },
      { ts: ts(1), user: "U1", text: "one *bold*" },
      { ts: ts(2), thread_ts: ts(1), user: "U2", text: "two" },
      { ts: ts(4), subtype: "tombstone", text: "This message was deleted." },
    ];
    const report = await applyMessages(ctx, "conv-1", "C1", messages);
    const calls = importCalls(rpcCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_conversation_id: "conv-1", p_bulk: false });
    const rows = rowsOf(calls[0]);
    expect(rows.map((r) => r.ts)).toEqual([ts(1), ts(2), ts(3)]);
    expect(rows[0]).toMatchObject({ channel_id: "C1", sender_id: "p-zac", body: "one **bold**", kind: "text" });
    expect(rows[2].reactions).toEqual([{ user_id: "p-zac", emoji: "👍" }]);
    expect(report).toEqual({
      inserted: 3,
      updated: 0,
      unchanged: 0,
      orphans: 0,
      filesQueued: 0,
      droppedReactions: 1,
      insertedReplies: 1,
    });
  });

  it("asks for the bulk path only for a big window, unless told otherwise", async () => {
    const many: SlackMessage[] = Array.from({ length: 51 }, (_, i) => ({ ts: ts(i + 1), user: "U1", text: `m${i}` }));
    const big = setup();
    await applyMessages(big.ctx, "conv-1", "C1", many);
    expect(importCalls(big.rpcCalls)[0].args.p_bulk).toBe(true);
    const fifty = setup();
    await applyMessages(fifty.ctx, "conv-1", "C1", many.slice(0, 50));
    expect(importCalls(fifty.rpcCalls)[0].args.p_bulk).toBe(false);
    const forced = setup();
    await applyMessages(forced.ctx, "conv-1", "C1", many.slice(0, 2), { bulk: true });
    expect(importCalls(forced.rpcCalls)[0].args.p_bulk).toBe(true);
    const refused = setup();
    await applyMessages(refused.ctx, "conv-1", "C1", many, { bulk: false });
    expect(importCalls(refused.rpcCalls)[0].args.p_bulk).toBe(false);
  });

  it("counts what the database says it did", async () => {
    const { ctx, rpcHandlers } = setup();
    rpcHandlers.import_slack_messages = importHandler({ [ts(1)]: "updated", [ts(2)]: "unchanged" });
    const report = await applyMessages(ctx, "conv-1", "C1", [
      { ts: ts(1), user: "U1", text: "a" },
      { ts: ts(2), user: "U1", text: "b" },
      { ts: ts(3), user: "U1", text: "c" },
    ]);
    expect(report).toMatchObject({ inserted: 1, updated: 1, unchanged: 1 });
  });

  it("throws when the import fails, so the slice records the error rather than moving its cursor", async () => {
    const { ctx, rpcHandlers } = setup();
    rpcHandlers.import_slack_messages = () => ({ data: null, error: { message: "boom" } });
    await expect(applyMessages(ctx, "conv-1", "C1", [{ ts: ts(1), user: "U1", text: "a" }])).rejects.toThrow(
      "import_slack_messages: boom",
    );
  });

  it("fetches a missing thread parent once, imports it first, then retries the replies", async () => {
    const { ctx, rpcCalls } = setup();
    const parent: SlackMessage = { ts: ts(1), user: "U1", text: "parent", reply_count: 2 };
    const replies: SlackMessage[] = [
      { ts: ts(2), thread_ts: ts(1), user: "U2", text: "first reply" },
      { ts: ts(3), thread_ts: ts(1), user: "U1", text: "second reply" },
    ];
    vi.mocked(threadReplies).mockResolvedValue([parent, ...replies]);
    const report = await applyMessages(ctx, "conv-1", "C1", [...replies, { ts: ts(4), user: "U1", text: "later" }]);
    expect(threadReplies).toHaveBeenCalledTimes(1);
    expect(threadReplies).toHaveBeenCalledWith("C1", ts(1));
    expect(importCalls(rpcCalls).map((c) => rowsOf(c).map((r) => r.ts))).toEqual([
      [ts(2), ts(3), ts(4)],
      [ts(1)],
      [ts(2), ts(3)],
    ]);
    expect(report).toEqual({
      inserted: 4,
      updated: 0,
      unchanged: 0,
      orphans: 0,
      filesQueued: 0,
      droppedReactions: 0,
      insertedReplies: 2,
    });
  });

  it("counts replies whose parent Slack no longer has as orphans and leaves them out", async () => {
    const { ctx, rpcCalls } = setup();
    vi.mocked(threadReplies).mockRejectedValue(new SlackApiError("conversations.replies", "thread_not_found"));
    const report = await applyMessages(ctx, "conv-1", "C1", [
      { ts: ts(2), thread_ts: ts(1), user: "U2", text: "reply" },
      { ts: ts(4), user: "U1", text: "later" },
    ]);
    expect(importCalls(rpcCalls)).toHaveLength(1);
    expect(report).toMatchObject({ inserted: 1, orphans: 1, insertedReplies: 0 });

    // Slack answering without the parent in it comes to the same thing.
    const again = setup();
    vi.mocked(threadReplies).mockResolvedValue([]);
    const reply: SlackMessage = { ts: ts(2), thread_ts: ts(1), user: "U2", text: "reply" };
    expect(await applyMessages(again.ctx, "conv-1", "C1", [reply])).toMatchObject({ inserted: 0, orphans: 1 });
  });

  it("queues the files of a newly inserted message, once", async () => {
    const { ctx, writes, rpcHandlers } = setup();
    const file = {
      id: "F1",
      name: "photo.png",
      mimetype: "image/png",
      size: 1234,
      url_private: "https://files.slack.com/p",
      url_private_download: "https://files.slack.com/p?download=1",
      mode: "hosted",
    };
    const message: SlackMessage = {
      ts: ts(1),
      user: "U1",
      text: "look",
      files: [file, { id: "F2", mode: "tombstone" }],
    };
    const report = await applyMessages(ctx, "conv-1", "C1", [message]);
    expect(report).toMatchObject({ inserted: 1, filesQueued: 1 });
    expect(writes).toEqual([
      {
        table: "slack_files",
        op: "upsert",
        payload: [
          {
            org_id: "org-1",
            slack_file_id: "F1",
            message_id: `m-${ts(1)}`,
            conversation_id: "conv-1",
            channel_id: "C1",
            name: "photo.png",
            mimetype: "image/png",
            size: 1234,
            url_private: "https://files.slack.com/p?download=1",
            mode: "hosted",
          },
        ],
        options: { onConflict: "message_id,slack_file_id", ignoreDuplicates: true },
      },
    ]);

    // A re-read queues them again rather than assuming the first pass finished. A batch commits
    // its messages before this loop runs, so a slice killed in between would otherwise leave
    // attachments that nothing ever asks for: the page comes back `unchanged` and the files are
    // gone with no trace. The upsert ignores duplicates, so the cost is one statement.
    rpcHandlers.import_slack_messages = importHandler({ [ts(1)]: "unchanged" });
    expect(await applyMessages(ctx, "conv-1", "C1", [message])).toMatchObject({
      inserted: 0,
      unchanged: 1,
      // Counted only for a message this run inserted, so the number stays a count of new work.
      filesQueued: 0,
    });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      table: "slack_files",
      op: "upsert",
      options: { onConflict: "message_id,slack_file_id", ignoreDuplicates: true },
    });
  });

  it("gives an unlisted bot a profile through the actor's client before importing its post", async () => {
    const { ctx, actor, rpcCalls, writes } = setup();
    actor.rpcHandlers.import_slack_account = () => ({ data: "p-monday", error: null });
    const post: SlackMessage = {
      ts: ts(1),
      subtype: "bot_message",
      bot_id: "B9",
      username: "Monday",
      text: "Task done",
    };
    await applyMessages(ctx, "conv-1", "C1", [post]);
    expect(actor.rpcCalls).toEqual([
      {
        name: "import_slack_account",
        args: {
          p_slack_user_id: "B9",
          p_email: null,
          p_timezone: null,
          p_avatar_url: null,
          p_full_name: "Monday (Slack app)",
          p_display_name: "Monday (Slack app)",
          p_account_type: "team",
          p_role: "staff",
          p_deactivated: true,
          p_is_bot: true,
        },
      },
    ]);
    expect(rpcCalls.map((c) => c.name)).toEqual(["import_slack_messages"]);
    expect(writes[0]).toMatchObject({
      table: "slack_users",
      op: "upsert",
      payload: {
        org_id: "org-1",
        slack_user_id: "B9",
        is_bot: true,
        decision: "create_bot",
        profile_id: "p-monday",
        outcome: "created",
      },
      options: { onConflict: "org_id,slack_user_id" },
    });
    expect(ctx.directory.profileId("B9")).toBe("p-monday");
    expect(ctx.directory.userName("B9")).toBe("Monday (Slack app)");
    expect(rowsOf(importCalls(rpcCalls)[0])[0]).toMatchObject({ sender_id: "p-monday", body: "Task done" });

    // Seen again: the directory knows it, so no second account call.
    await applyMessages(ctx, "conv-1", "C1", [post]);
    expect(actor.rpcCalls).toHaveLength(1);
  });

  it("drops a bot post rather than importing it without a sender when no account could be made", async () => {
    const { ctx, actor, rpcCalls } = setup();
    actor.rpcHandlers.import_slack_account = () => ({ data: null, error: { message: "not allowed" } });
    const post: SlackMessage = {
      ts: ts(1),
      subtype: "bot_message",
      bot_id: "B9",
      username: "Monday",
      text: "Task done",
    };
    const report = await applyMessages(ctx, "conv-1", "C1", [post]);
    expect(report.inserted).toBe(0);
    expect(importCalls(rpcCalls)).toEqual([]);
    expect(ctx.directory.person("B9")).toBeNull();
  });

  it("leaves bot posts alone when the setting is off", async () => {
    const { ctx, actor, rpcCalls } = setup();
    ctx.importBotMessages = false;
    const post: SlackMessage = {
      ts: ts(1),
      subtype: "bot_message",
      bot_id: "B9",
      username: "Monday",
      text: "Task done",
    };
    const report = await applyMessages(ctx, "conv-1", "C1", [post]);
    expect(actor.rpcCalls).toEqual([]);
    expect(rpcCalls).toEqual([]);
    expect(report.inserted).toBe(0);
  });
});

describe("markDeletedInWindow", () => {
  it("marks the messages held here that Slack's window no longer returned", async () => {
    const { admin, rpcCalls, rpcHandlers } = fakeAdmin({ slack_messages: [{ ts: "1" }, { ts: "2" }, { ts: "3" }] });
    rpcHandlers.mark_slack_deleted = () => ({ data: 1, error: null });
    const n = await markDeletedInWindow(admin, "C1", { oldest: "0", latest: "9", threadTs: null }, new Set(["1", "3"]));
    expect(n).toBe(1);
    expect(rpcCalls).toEqual([{ name: "mark_slack_deleted", args: { p_channel_id: "C1", p_ts_list: ["2"] } }]);
  });

  it("touches nothing when everything is still there", async () => {
    const { admin, rpcCalls } = fakeAdmin({ slack_messages: [{ ts: "1" }, { ts: "2" }] });
    const window = { oldest: "0", latest: "9", threadTs: "1" };
    expect(await markDeletedInWindow(admin, "C1", window, new Set(["1", "2"]))).toBe(0);
    expect(rpcCalls).toEqual([]);
  });
});

describe("processFiles", () => {
  const pending = (over: Record<string, unknown> = {}) => ({
    org_id: "org-1",
    slack_file_id: "F1",
    message_id: "m1",
    conversation_id: "conv-1",
    channel_id: "C1",
    name: "photo.png",
    mimetype: "image/png",
    size: 1234,
    url_private: "https://files.slack.com/photo.png",
    mode: "hosted",
    status: "pending",
    attempts: 0,
    claimed_at: null,
    last_error: null,
    created_at: "2026-05-04T09:30:00.000Z",
    ...over,
  });
  const message = { id: "m1", body: "here you go", edited_at: "2026-05-04T10:00:00.000Z" };
  const budget = () => new Budget(60_000);

  it("does nothing when nothing is pending", async () => {
    const { admin, writes } = fakeAdmin({ slack_files: [] });
    expect(await processFiles(admin, budget())).toEqual({ done: 0, skipped: 0, failed: 0, remaining: false });
    expect(writes).toEqual([]);
  });

  it("skips a file over 50 MB, says so on the message, and leaves the edit stamp as it was", async () => {
    const { admin, writes } = fakeAdmin({
      slack_files: [pending({ name: "big.zip", mimetype: "application/zip", size: MAX_FILE_BYTES + 1 })],
      messages: [message],
    });
    expect(await processFiles(admin, budget())).toEqual({ done: 0, skipped: 1, failed: 0, remaining: false });
    expect(downloadFile).not.toHaveBeenCalled();
    expect(updates(writes, "messages")).toEqual([
      { body: "here you go\n[file not imported: big.zip (larger than 50 MB)]" },
      { edited_at: "2026-05-04T10:00:00.000Z" },
    ]);
    expect(updates(writes, "slack_files")).toEqual([
      { claimed_at: expect.any(String) },
      { status: "skipped_size", claimed_at: null },
    ]);
  });

  it("skips a type the bucket would refuse, naming the type", async () => {
    const { admin, writes } = fakeAdmin({
      slack_files: [pending({ name: "setup.exe", mimetype: "application/x-msdownload; charset=binary" })],
      messages: [message],
    });
    expect(await processFiles(admin, budget())).toMatchObject({ skipped: 1, done: 0, failed: 0 });
    expect(downloadFile).not.toHaveBeenCalled();
    expect(updates(writes, "messages")[0]).toEqual({
      body: "here you go\n[file not imported: setup.exe (application/x-msdownload)]",
    });
    expect(updates(writes, "slack_files").at(-1)).toEqual({ status: "skipped_mime", claimed_at: null });
  });

  it("does not add the same note twice", async () => {
    const line = "[file not imported: big.zip (larger than 50 MB)]";
    const { admin, writes } = fakeAdmin({
      slack_files: [pending({ name: "big.zip", size: MAX_FILE_BYTES + 1 })],
      messages: [{ ...message, body: `here you go\n${line}` }],
    });
    expect(await processFiles(admin, budget())).toMatchObject({ skipped: 1 });
    expect(updates(writes, "messages")).toEqual([]);
  });

  it("downloads an allowed file and files it as an attachment carrying its Slack id", async () => {
    const body = new ArrayBuffer(3);
    vi.mocked(downloadFile).mockResolvedValue({ ok: true, body, contentType: "image/png" });
    vi.mocked(ingestAttachment).mockResolvedValue({ ok: true });
    const { admin, writes } = fakeAdmin({ slack_files: [pending()], messages: [message] });
    expect(await processFiles(admin, budget())).toEqual({ done: 1, skipped: 0, failed: 0, remaining: false });
    expect(downloadFile).toHaveBeenCalledWith("https://files.slack.com/photo.png", MAX_FILE_BYTES);
    expect(ingestAttachment).toHaveBeenCalledWith(admin, {
      orgId: "org-1",
      conversationId: "conv-1",
      messageId: "m1",
      fileName: "photo.png",
      mime: "image/png",
      body,
      meta: { slack_file_id: "F1" },
    });
    expect(updates(writes, "slack_files").at(-1)).toEqual({ status: "done", claimed_at: null });
    expect(updates(writes, "messages")).toEqual([]);
  });

  it("counts a failed download against the row and gives up after five", async () => {
    vi.mocked(downloadFile).mockResolvedValue({ ok: false, error: "http_404" });
    const first = fakeAdmin({ slack_files: [pending()], messages: [message] });
    expect(await processFiles(first.admin, budget())).toMatchObject({ failed: 1, done: 0 });
    expect(updates(first.writes, "slack_files").at(-1)).toEqual({
      attempts: 1,
      last_error: "http_404",
      claimed_at: null,
    });
    expect(updates(first.writes, "messages")).toEqual([]);

    const last = fakeAdmin({ slack_files: [pending({ attempts: FILE_MAX_ATTEMPTS - 1 })], messages: [message] });
    expect(await processFiles(last.admin, budget())).toMatchObject({ failed: 1 });
    expect(updates(last.writes, "slack_files").at(-1)).toEqual({
      status: "dead",
      attempts: FILE_MAX_ATTEMPTS,
      last_error: "http_404",
      claimed_at: null,
    });
    expect(updates(last.writes, "messages")[0]).toEqual({
      body: "here you go\n[file not imported: photo.png (could not be downloaded)]",
    });
  });

  it("treats a duplicate attachment as already done", async () => {
    vi.mocked(downloadFile).mockResolvedValue({ ok: true, body: new ArrayBuffer(3), contentType: "image/png" });
    vi.mocked(ingestAttachment).mockResolvedValue({
      ok: false,
      error: 'duplicate key value violates unique constraint "attachments_slack_file_idx"',
    });
    const { admin, writes } = fakeAdmin({ slack_files: [pending()], messages: [message] });
    expect(await processFiles(admin, budget())).toMatchObject({ done: 1, failed: 0 });
    expect(updates(writes, "slack_files").at(-1)).toEqual({ status: "done", claimed_at: null });
  });

  it("releases the row and stops the pass when Slack rate-limits the download", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new SlackApiError("files", "ratelimited", 30));
    const { admin, writes } = fakeAdmin({
      slack_files: [pending(), pending({ slack_file_id: "F2" })],
      messages: [message],
    });
    expect(await processFiles(admin, budget())).toEqual({ done: 0, skipped: 0, failed: 0, remaining: true });
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(updates(writes, "slack_files")).toEqual([{ claimed_at: expect.any(String) }, { claimed_at: null }]);
  });

  it("takes fifteen rows a pass and says when more are waiting", async () => {
    const rows = Array.from({ length: 16 }, (_, i) => pending({ slack_file_id: `F${i}`, size: MAX_FILE_BYTES + 1 }));
    const { admin } = fakeAdmin({ slack_files: rows, messages: [message] });
    expect(await processFiles(admin, budget())).toEqual({ done: 0, skipped: 15, failed: 0, remaining: true });
  });

  it("stops before a file when the slice's time is nearly up", async () => {
    const { admin, writes } = fakeAdmin({ slack_files: [pending()], messages: [message] });
    expect(await processFiles(admin, new Budget(1_000))).toEqual({ done: 0, skipped: 0, failed: 0, remaining: true });
    expect(writes).toEqual([]);
  });
});

describe("Budget", () => {
  it("has time while at least the asked-for margin is left", () => {
    const budget = new Budget(10_000, 1_000);
    expect(budget.remainingMs(1_000)).toBe(10_000);
    expect(budget.has(8_000, 3_000)).toBe(true);
    expect(budget.has(8_000, 3_001)).toBe(false);
    expect(budget.has(0, 11_000)).toBe(true);
    expect(budget.has(1, 11_000)).toBe(false);
  });

  it("asks for eight seconds by default", () => {
    const budget = new Budget(10_000, 0);
    expect(budget.has(undefined, 2_000)).toBe(true);
    expect(budget.has(undefined, 2_001)).toBe(false);
  });
});
