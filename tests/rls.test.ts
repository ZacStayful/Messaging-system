/**
 * Row Level Security suite. Runs against the live Supabase project using the two
 * seeded test accounts (supabase/seed.sql). Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SEED_TEST_PASSWORD
 */
import { beforeAll, describe, expect, it } from "vitest";
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
