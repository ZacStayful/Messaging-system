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
    expect(data?.map((c) => c.id)).toEqual([CUSTOMER_GROUP]);
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
    const { error } = await customer
      .from("messages")
      .insert({ org_id: ORG, conversation_id: CUSTOMER_GROUP, sender_id: CUSTOMER_ID, body: "sneaky", visibility: "internal" });
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
    const { error } = await customer.from("profiles").update({ account_type: "team", role: "admin" }).eq("id", CUSTOMER_ID);
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
