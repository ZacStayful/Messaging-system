/**
 * Row Level Security suite. Runs against the live Supabase project using the two
 * seeded test accounts (supabase/seed.sql). Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEED_TEST_PASSWORD
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = process.env.SEED_TEST_PASSWORD;

const ORG = "a0000000-0000-4000-8000-000000000001";
const STAFF_ID = "b0000000-0000-4000-8000-000000000091";
const CUSTOMER_ID = "b0000000-0000-4000-8000-000000000092";
const ZAC_ID = "b0000000-0000-4000-8000-000000000001";
const CUSTOMER_GROUP = "c0000000-0000-4000-8000-000000000041"; // staff + customer
const TEAM_ONLY = "c0000000-0000-4000-8000-000000000042"; // staff + zac
const INTERNAL_NOTE = "d0000000-0000-4000-8000-000000000042";

const canRun = !!(URL && KEY && PASSWORD);
const suite = canRun ? describe : describe.skip;

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD! });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

suite("RLS", () => {
  let staff: SupabaseClient<Database>;
  let customer: SupabaseClient<Database>;
  let anon: SupabaseClient<Database>;

  beforeAll(async () => {
    staff = await signIn("test-staff@stayful.test");
    customer = await signIn("test-customer@stayful.test");
    anon = createClient<Database>(URL!, KEY!, { auth: { persistSession: false } });
  });

  it("anon sees nothing", async () => {
    const { data, error } = await anon.from("messages").select("id").limit(5);
    expect(error ?? null).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("customer only sees their own conversations", async () => {
    const { data } = await customer.rpc("my_conversations");
    const ids = data?.map((c) => c.id) ?? [];
    expect(ids).toContain(CUSTOMER_GROUP);
    expect(ids).not.toContain(TEAM_ONLY);
    // every visible conversation lists the customer as a member
    expect(data?.every((c) => c.member_ids.includes(CUSTOMER_ID))).toBe(true);
    const { data: direct } = await customer.from("conversations").select("id").eq("id", TEAM_ONLY);
    expect(direct).toEqual([]);
  });

  it("customer cannot read messages from a channel they are not in", async () => {
    const { data } = await customer.from("messages").select("id").eq("conversation_id", TEAM_ONLY);
    expect(data).toEqual([]);
  });

  it("customer cannot read internal notes in their own group", async () => {
    const { data } = await customer.from("messages").select("id, visibility").eq("conversation_id", CUSTOMER_GROUP);
    expect(data?.some((m) => m.id === INTERNAL_NOTE)).toBe(false);
    expect(data?.every((m) => m.visibility === "public")).toBe(true);
  });

  it("staff reads internal notes in their channels", async () => {
    const { data } = await staff.from("messages").select("id").eq("id", INTERNAL_NOTE);
    expect(data?.map((m) => m.id)).toEqual([INTERNAL_NOTE]);
  });

  it("customer cannot post as someone else", async () => {
    const { error } = await customer
      .from("messages")
      .insert({ org_id: ORG, conversation_id: CUSTOMER_GROUP, sender_id: STAFF_ID, body: "spoof" });
    expect(error).not.toBeNull();
  });

  it("customer cannot post an internal note", async () => {
    const { error } = await customer.from("messages").insert({
      org_id: ORG,
      conversation_id: CUSTOMER_GROUP,
      sender_id: CUSTOMER_ID,
      body: "sneaky",
      visibility: "internal",
    });
    expect(error).not.toBeNull();
  });

  it("customer cannot post into a channel they are not in", async () => {
    const { error } = await customer
      .from("messages")
      .insert({ org_id: ORG, conversation_id: TEAM_ONLY, sender_id: CUSTOMER_ID, body: "intruder" });
    expect(error).not.toBeNull();
  });

  it("customer can post in their own group and the row round-trips", async () => {
    const body = `rls-test ${Date.now()}`;
    const { data, error } = await customer
      .from("messages")
      .insert({ org_id: ORG, conversation_id: CUSTOMER_GROUP, sender_id: CUSTOMER_ID, body })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data?.body).toBe(body);
    // clean up (soft delete is the only allowed path)
    if (data) await customer.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
  });

  it("customer only sees profiles of people they share a conversation with", async () => {
    const { data } = await customer.from("profiles").select("id");
    const ids = new Set(data?.map((p) => p.id));
    expect(ids.has(CUSTOMER_ID)).toBe(true);
    expect(ids.has(STAFF_ID)).toBe(true);
    expect(ids.has(ZAC_ID)).toBe(false);
  });

  it("people can set their own status but nobody else's", async () => {
    const ok = await customer
      .from("profiles")
      .update({ status_text: "rls status", status_emoji: "🧪" })
      .eq("id", CUSTOMER_ID)
      .select("status_text")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data?.status_text).toBe("rls status");
    const { data: spoof } = await customer
      .from("profiles")
      .update({ status_text: "hacked" })
      .eq("id", STAFF_ID)
      .select("id");
    expect(spoof).toEqual([]);
    const { data: staffRow } = await staff.from("profiles").select("status_text").eq("id", STAFF_ID).single();
    expect(staffRow?.status_text).not.toBe("hacked");
    await customer.from("profiles").update({ status_text: null, status_emoji: null }).eq("id", CUSTOMER_ID);
  });

  it("saved items: only visible messages, only your own rows", async () => {
    const bad = await customer
      .from("saved_items")
      .insert({ org_id: ORG, user_id: CUSTOMER_ID, message_id: INTERNAL_NOTE });
    expect(bad.error).not.toBeNull();
    const { data: ok, error } = await customer
      .from("saved_items")
      .insert({ org_id: ORG, user_id: CUSTOMER_ID, message_id: "d0000000-0000-4000-8000-000000000041" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { data: staffSees } = await staff.from("saved_items").select("id").eq("id", ok!.id);
    expect(staffSees).toEqual([]);
    await customer.from("saved_items").delete().eq("id", ok!.id);
  });

  it("customer cannot promote themselves", async () => {
    const { error } = await customer
      .from("profiles")
      .update({ account_type: "team", role: "admin" })
      .eq("id", CUSTOMER_ID);
    expect(error).not.toBeNull();
  });

  it("customer cannot open a DM with a team member outside their group", async () => {
    const { error } = await customer.rpc("dm_between", { other: ZAC_ID });
    expect(error).not.toBeNull();
  });

  it("customer can open a DM with a team member in their group", async () => {
    const { data, error } = await customer.rpc("dm_between", { other: STAFF_ID });
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("search only returns what the caller may read", async () => {
    const { data: c } = await customer.rpc("search_messages", { q: "team-only channel" });
    expect(c).toEqual([]);
    const { data: c2 } = await customer.rpc("search_messages", { q: "price sensitive" });
    expect(c2).toEqual([]);
    const { data: c3 } = await customer.rpc("search_messages", { q: "hello from the team" });
    expect(c3?.map((m) => m.message_id)).toContain("d0000000-0000-4000-8000-000000000041");
    const { data: s } = await staff.rpc("search_messages", { q: "price sensitive" });
    expect(s?.map((m) => m.message_id)).toContain(INTERNAL_NOTE);
  });

  it("customer can react to visible messages only", async () => {
    const ok = await customer
      .from("reactions")
      .insert({ org_id: ORG, message_id: "d0000000-0000-4000-8000-000000000041", user_id: CUSTOMER_ID, emoji: "👍" });
    expect(ok.error).toBeNull();
    await customer
      .from("reactions")
      .delete()
      .eq("message_id", "d0000000-0000-4000-8000-000000000041")
      .eq("user_id", CUSTOMER_ID);
    const bad = await customer
      .from("reactions")
      .insert({ org_id: ORG, message_id: INTERNAL_NOTE, user_id: CUSTOMER_ID, emoji: "👍" });
    expect(bad.error).not.toBeNull();
    const spoof = await customer
      .from("reactions")
      .insert({ org_id: ORG, message_id: "d0000000-0000-4000-8000-000000000041", user_id: STAFF_ID, emoji: "👍" });
    expect(spoof.error).not.toBeNull();
  });

  it("threads: replies follow message rules and bookkeeping runs", async () => {
    const parentId = "d0000000-0000-4000-8000-000000000041";
    // A customer cannot reply inside a thread on a message they cannot see.
    const bad = await customer.from("messages").insert({
      org_id: ORG,
      conversation_id: CUSTOMER_GROUP,
      sender_id: CUSTOMER_ID,
      body: "x",
      parent_id: INTERNAL_NOTE,
    });
    expect(bad.error).not.toBeNull();
    // A reply to a visible message works and bumps the parent's reply_count.
    const { data: reply, error } = await customer
      .from("messages")
      .insert({
        org_id: ORG,
        conversation_id: CUSTOMER_GROUP,
        sender_id: CUSTOMER_ID,
        body: "thread reply",
        parent_id: parentId,
      })
      .select()
      .single();
    expect(error).toBeNull();
    const { data: parent } = await customer
      .from("messages")
      .select("reply_count, last_reply_at")
      .eq("id", parentId)
      .single();
    expect(parent?.reply_count).toBeGreaterThanOrEqual(1);
    expect(parent?.last_reply_at).not.toBeNull();
    // The replier follows the thread; the parent author does too. Both see it in my_threads.
    const { data: mine } = await customer.rpc("my_threads", { max_rows: 20 });
    expect(mine?.map((t) => t.message_id)).toContain(parentId);
    const { data: theirs } = await staff.rpc("my_threads", { max_rows: 20 });
    const t = theirs?.find((x) => x.message_id === parentId);
    expect(t).toBeDefined();
    expect(t!.unread_count).toBeGreaterThanOrEqual(1);
    // Marking read zeroes the unread count for the caller only.
    expect((await staff.rpc("mark_thread_read", { p_message_id: parentId })).error).toBeNull();
    const { data: after } = await staff.rpc("my_threads", { max_rows: 20 });
    expect(after?.find((x) => x.message_id === parentId)?.unread_count).toBe(0);
    // A customer cannot read the staff member's follow row, nor anything from a channel they are not in.
    const { data: follows } = await customer.from("thread_follows").select("user_id").eq("message_id", parentId);
    expect(follows?.every((f) => f.user_id === CUSTOMER_ID)).toBe(true);
    // Replies under an internal note are forced internal, so customers never see them.
    const { data: internalReply } = await staff
      .from("messages")
      .insert({
        org_id: ORG,
        conversation_id: CUSTOMER_GROUP,
        sender_id: STAFF_ID,
        body: "team only",
        parent_id: INTERNAL_NOTE,
      })
      .select()
      .single();
    expect(internalReply?.visibility).toBe("internal");
    const { data: hidden } = await customer.from("messages").select("id").eq("parent_id", INTERNAL_NOTE);
    expect(hidden).toEqual([]);
    if (internalReply)
      await staff.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", internalReply.id);
    // Soft-deleting the reply decrements the count.
    if (reply) {
      await customer.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", reply.id);
      const { data: p2 } = await customer.from("messages").select("reply_count").eq("id", parentId).single();
      expect(p2?.reply_count).toBe((parent?.reply_count ?? 1) - 1);
    }
  });

  it("customer cannot start group messages or create groups", async () => {
    const { error } = await customer.rpc("create_group_dm", { p_member_ids: [STAFF_ID, ZAC_ID] });
    expect(error?.message).toMatch(/only Stayful team/);
    const { error: e2 } = await customer.rpc("create_channel", { p_name: "sneaky", p_type: "owner" });
    expect(e2?.message).toMatch(/only Stayful team/);
  });

  it("nobody sees the audit log except admins", async () => {
    const { data: s } = await staff.from("audit_log").select("id").limit(1);
    const { data: c } = await customer.from("audit_log").select("id").limit(1);
    expect(s).toEqual([]);
    expect(c).toEqual([]);
  });
});

suite("customer accounts", () => {
  let staff: SupabaseClient<Database>;
  let customer: SupabaseClient<Database>;
  const email = "rls-created-customer@stayful.test";
  const password1 = `Pw1-${Date.now()}-abc`;

  beforeAll(async () => {
    staff = await signIn("test-staff@stayful.test");
    customer = await signIn("test-customer@stayful.test");
  });

  it("customers cannot create accounts", async () => {
    const { error } = await customer.rpc("create_customer_account", {
      p_email: "nope@stayful.test",
      p_full_name: "Nope",
      p_display_name: "Nope",
      p_password: "Something-long-1",
    });
    expect(error?.message).toMatch(/only Stayful team/);
  });

  it("staff cannot add a customer to a channel they are not in", async () => {
    const { error } = await staff.rpc("create_customer_account", {
      p_email: "nope2@stayful.test",
      p_full_name: "Nope",
      p_display_name: "Nope",
      p_password: "Something-long-1",
      p_conversation_ids: ["c0000000-0000-4000-8000-000000000001"],
    });
    expect(error?.message).toMatch(/conversations you belong to/);
  });

  it("staff creates a customer who can then sign in with the password", async () => {
    const existing = await staff.from("profiles").select("id").eq("email", email).maybeSingle();
    let userId = existing.data?.id;
    if (userId) {
      const { error } = await staff.rpc("reset_customer_password", { p_user_id: userId, p_password: password1 });
      expect(error).toBeNull();
    } else {
      const { data, error } = await staff.rpc("create_customer_account", {
        p_email: email,
        p_full_name: "Created Customer",
        p_display_name: "Created",
        p_password: password1,
        p_conversation_ids: [CUSTOMER_GROUP],
      });
      expect(error).toBeNull();
      userId = data ?? undefined;
    }
    expect(userId).toBeTruthy();

    const fresh = createClient<Database>(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: session, error: loginError } = await fresh.auth.signInWithPassword({ email, password: password1 });
    expect(loginError).toBeNull();
    expect(session.user?.id).toBe(userId);

    const { data: profile } = await fresh
      .from("profiles")
      .select("account_type, role, org_id")
      .eq("id", userId!)
      .single();
    expect(profile).toEqual({ account_type: "customer", role: "owner", org_id: ORG });

    const { data: convs } = await fresh.rpc("my_conversations");
    expect(convs?.map((c) => c.id)).toContain(CUSTOMER_GROUP);
  });

  it("duplicate emails are rejected", async () => {
    const { error } = await staff.rpc("create_customer_account", {
      p_email: email,
      p_full_name: "Again",
      p_display_name: "Again",
      p_password: "Something-long-1",
    });
    expect(error?.message).toMatch(/already exists/);
  });

  it("customers cannot reset other passwords or read the outbox", async () => {
    const { error } = await customer.rpc("reset_customer_password", {
      p_user_id: STAFF_ID,
      p_password: "Something-long-1",
    });
    expect(error).not.toBeNull();
    const { data } = await customer.from("notification_outbox").select("id").limit(1);
    expect(data ?? []).toEqual([]);
  });
});

suite("conversation bookmarks", () => {
  let staff: SupabaseClient<Database>;
  let customer: SupabaseClient<Database>;
  const added: string[] = [];

  beforeAll(async () => {
    staff = await signIn("test-staff@stayful.test");
    customer = await signIn("test-customer@stayful.test");
  });

  afterAll(async () => {
    // Bookmarks are visible to everyone in the group, so don't leave test rows behind.
    for (const id of added) await staff.from("conversation_bookmarks").delete().eq("id", id);
  });

  it("a member can add a bookmark to their own group", async () => {
    const { data, error } = await customer.rpc("add_bookmark", {
      p_conversation_id: CUSTOMER_GROUP,
      p_title: "Customer link",
      p_url: "https://example.com/customer",
    });
    expect(error).toBeNull();
    expect(data?.conversation_id).toBe(CUSTOMER_GROUP);
    expect(data?.position).toBeGreaterThan(0);
    if (data) added.push(data.id);
  });

  it("both members of the group can read it", async () => {
    const { data } = await staff.from("conversation_bookmarks").select("id").eq("conversation_id", CUSTOMER_GROUP);
    expect(data?.map((b) => b.id)).toEqual(expect.arrayContaining(added));
  });

  it("a non-member cannot add one, even through the RPC", async () => {
    const { error } = await customer.rpc("add_bookmark", {
      p_conversation_id: TEAM_ONLY,
      p_title: "Sneaky",
      p_url: "https://example.com/sneaky",
    });
    expect(error).not.toBeNull();
  });

  it("a non-member cannot read another group's bookmarks", async () => {
    const { data: mine } = await staff.rpc("add_bookmark", {
      p_conversation_id: TEAM_ONLY,
      p_title: "Team only",
      p_url: "https://example.com/team",
    });
    expect(mine).toBeTruthy();
    if (mine) added.push(mine.id);

    const { data } = await customer.from("conversation_bookmarks").select("id").eq("conversation_id", TEAM_ONLY);
    expect(data ?? []).toEqual([]);
  });

  it("a customer cannot delete a team member's bookmark", async () => {
    const { data: theirs } = await staff.rpc("add_bookmark", {
      p_conversation_id: CUSTOMER_GROUP,
      p_title: "Staff link",
      p_url: "https://example.com/staff",
    });
    expect(theirs).toBeTruthy();
    if (theirs) added.push(theirs.id);

    await customer.from("conversation_bookmarks").delete().eq("id", theirs!.id);
    // RLS makes the delete a no-op rather than an error, so assert the row survived.
    const { data: still } = await staff.from("conversation_bookmarks").select("id").eq("id", theirs!.id).maybeSingle();
    expect(still?.id).toBe(theirs!.id);
  });

  it("only the team can reorder", async () => {
    const { error } = await customer.rpc("move_bookmark", { p_id: added[0], p_delta: 1 });
    expect(error?.message).toMatch(/team/i);
    const { error: staffError } = await staff.rpc("move_bookmark", { p_id: added[0], p_delta: 1 });
    expect(staffError).toBeNull();
  });

  it("rejects a link that is not http or https", async () => {
    const { error } = await staff.rpc("add_bookmark", {
      p_conversation_id: CUSTOMER_GROUP,
      p_title: "Bad",
      p_url: "javascript:alert(1)",
    });
    expect(error?.message).toMatch(/http/i);
  });
});

suite("api keys", () => {
  let staff: SupabaseClient<Database>;
  let customer: SupabaseClient<Database>;

  beforeAll(async () => {
    staff = await signIn("test-staff@stayful.test");
    customer = await signIn("test-customer@stayful.test");
  });

  it("a customer cannot read api keys at all", async () => {
    const { data } = await customer.from("api_keys").select("id, key_prefix").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("a non-admin team member cannot read api keys either", async () => {
    // The seeded test-staff account is `staff`, not `admin`.
    const { data } = await staff.from("api_keys").select("id").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("a non-admin cannot create one", async () => {
    const { error } = await staff.from("api_keys").insert({
      org_id: ORG,
      user_id: STAFF_ID,
      name: "Should not exist",
      key_hash: "0".repeat(64),
      key_prefix: "sk_live_000000",
      scopes: ["messages:read"],
      created_by: STAFF_ID,
    });
    expect(error).not.toBeNull();
  });

  it("nobody can read the rate-limit table", async () => {
    // 0040 replaced the fixed-window counters with one bucket row per key. RLS is on with no
    // policy, so a signed-in user gets an empty result rather than an error, exactly as before.
    const { data } = await staff.from("api_rate_buckets").select("key_id").limit(1);
    expect(data ?? []).toEqual([]);
  });

  it("the rate-limit and touch helpers are not callable by a signed-in user", async () => {
    const { error } = await staff.rpc("api_rate_hit", {
      p_key_id: "00000000-0000-4000-8000-000000000000",
      p_limit: 1,
      p_window_seconds: 60,
    });
    expect(error).not.toBeNull();
  });

  // 0029. Each of these was possible until that migration; they are here so the fix has to stay
  // fixed, because every one of them is a one-request PATCH against an ordinary column.
  describe("0029: an update cannot move a row somewhere the insert would have been refused", () => {
    it("a customer cannot move their membership into a channel they are not in", async () => {
      const { error } = await customer
        .from("conversation_members")
        .update({ conversation_id: TEAM_ONLY })
        .eq("user_id", CUSTOMER_ID)
        .eq("conversation_id", CUSTOMER_GROUP);
      expect(error).not.toBeNull();

      const { data } = await customer.from("conversation_members").select("conversation_id").eq("user_id", CUSTOMER_ID);
      expect(data?.map((m) => m.conversation_id)).not.toContain(TEAM_ONLY);
    });

    it("a customer can still mark their own conversation read", async () => {
      const { error } = await customer
        .from("conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("user_id", CUSTOMER_ID)
        .eq("conversation_id", CUSTOMER_GROUP);
      expect(error).toBeNull();
    });

    it("a customer cannot redirect a scheduled message into another conversation", async () => {
      const { data: row } = await customer
        .from("scheduled_messages")
        .insert({
          org_id: ORG,
          conversation_id: CUSTOMER_GROUP,
          sender_id: CUSTOMER_ID,
          body: "scheduled from a test",
          send_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        })
        .select("id")
        .single();
      expect(row?.id).toBeTruthy();

      // The cron posts these with the service role and re-validates nothing, so the policy is
      // the only thing standing between this and a message in a channel they cannot read.
      const { error } = await customer
        .from("scheduled_messages")
        .update({ conversation_id: TEAM_ONLY, visibility: "internal" })
        .eq("id", row!.id);
      expect(error).not.toBeNull();

      // ...while editing what they actually scheduled still works.
      const { error: bodyError } = await customer
        .from("scheduled_messages")
        .update({ body: "edited" })
        .eq("id", row!.id);
      expect(bodyError).toBeNull();

      await customer.from("scheduled_messages").delete().eq("id", row!.id);
    });
  });

  describe("sidebar sections", () => {
    // Sections are the one thing in the app that is private to a single person rather than shared
    // with an organisation, so "another team member cannot see it" is the whole feature.
    it("a section is invisible to everyone but the person who made it", async () => {
      const { data: mine, error } = await staff
        .from("sidebar_sections")
        .insert({ org_id: ORG, user_id: STAFF_ID, name: `rls test ${Date.now()}` })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect(mine?.id).toBeTruthy();

      const { data: theirs } = await customer.from("sidebar_sections").select("id").eq("id", mine!.id);
      expect(theirs).toEqual([]);

      // ...and they cannot rename or delete what they cannot see.
      const { data: renamed } = await customer
        .from("sidebar_sections")
        .update({ name: "taken over" })
        .eq("id", mine!.id)
        .select("id");
      expect(renamed ?? []).toEqual([]);

      await staff.from("sidebar_sections").delete().eq("id", mine!.id);
    });

    it("a section cannot be made in someone else's name", async () => {
      const { error } = await customer
        .from("sidebar_sections")
        .insert({ org_id: ORG, user_id: STAFF_ID, name: `not mine ${Date.now()}` });
      expect(error).not.toBeNull();
    });

    it("a conversation cannot be filed into someone else's section", async () => {
      const { data: mine } = await staff
        .from("sidebar_sections")
        .insert({ org_id: ORG, user_id: STAFF_ID, name: `rls target ${Date.now()}` })
        .select("id")
        .single();
      expect(mine?.id).toBeTruthy();

      // Both of these are in CUSTOMER_GROUP, so membership is not what stops this one.
      const { error } = await customer.from("sidebar_section_items").insert({
        org_id: ORG,
        user_id: CUSTOMER_ID,
        conversation_id: CUSTOMER_GROUP,
        section_id: mine!.id,
      });
      expect(error).not.toBeNull();

      await staff.from("sidebar_sections").delete().eq("id", mine!.id);
    });

    it("a conversation you are not in cannot be filed at all", async () => {
      const { data: section } = await customer
        .from("sidebar_sections")
        .insert({ org_id: ORG, user_id: CUSTOMER_ID, name: `customer section ${Date.now()}` })
        .select("id")
        .single();
      expect(section?.id).toBeTruthy();

      const { error } = await customer.from("sidebar_section_items").insert({
        org_id: ORG,
        user_id: CUSTOMER_ID,
        conversation_id: TEAM_ONLY,
        section_id: section!.id,
      });
      expect(error).not.toBeNull();

      // ...while filing a group they are actually in works, and deleting the section clears it.
      const { error: allowed } = await customer.from("sidebar_section_items").insert({
        org_id: ORG,
        user_id: CUSTOMER_ID,
        conversation_id: CUSTOMER_GROUP,
        section_id: section!.id,
      });
      expect(allowed).toBeNull();

      await customer.from("sidebar_sections").delete().eq("id", section!.id);
      const { data: left } = await customer
        .from("sidebar_section_items")
        .select("conversation_id")
        .eq("section_id", section!.id);
      expect(left ?? []).toEqual([]);
    });
  });
});
