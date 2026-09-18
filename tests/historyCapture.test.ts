import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseSentAt } from "@/lib/api/sentAt";
import { captureEmail } from "@/lib/email/capture";
import { captureWhatsAppMessage, decideWhatsAppCapture, type WhatsAppCaptureInput } from "@/lib/whatsapp/capture";

/**
 * A stand-in for the admin client: every table answers with a canned row set whatever the
 * filters, and every insert is recorded. Enough to check what a capture writes, which is the
 * part that matters for a backfill — the created_at and the meta on the row.
 */
function fakeAdmin(tables: Record<string, unknown[]>) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const insertErrors: Record<string, { code: string; message: string }> = {};
  const builder = (table: string) => {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "neq", "in", "is", "not", "ilike", "gte", "order", "limit"]) chain[m] = self;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.single = async () => ({ data: rows[0] ?? null, error: null });
    chain.insert = async (row: Record<string, unknown>) => {
      inserts.push({ table, row });
      return { error: insertErrors[table] ?? null };
    };
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
    return chain;
  };
  const admin = { from: builder } as unknown as SupabaseClient<Database>;
  return { admin, inserts, insertErrors };
}

describe("parseSentAt", () => {
  it("accepts ISO dates and epochs in seconds or milliseconds", () => {
    expect(parseSentAt("2026-05-04T09:30:00Z")).toBe("2026-05-04T09:30:00.000Z");
    expect(parseSentAt("2026-05-04T10:30:00+01:00")).toBe("2026-05-04T09:30:00.000Z");
    expect(parseSentAt(1777887000)).toBe("2026-05-04T09:30:00.000Z");
    expect(parseSentAt("1777887000000")).toBe("2026-05-04T09:30:00.000Z");
    expect(parseSentAt(1777887000000)).toBe("2026-05-04T09:30:00.000Z");
  });

  it("is null when left out, so a live capture keeps the database's stamp", () => {
    expect(parseSentAt(undefined)).toBeNull();
    expect(parseSentAt(null)).toBeNull();
    expect(parseSentAt("")).toBeNull();
  });

  it("rejects nonsense and the future", () => {
    expect(() => parseSentAt("yesterday")).toThrow(/ISO 8601/);
    expect(() => parseSentAt({})).toThrow(/ISO 8601/);
    expect(() => parseSentAt(new Date(Date.now() + 3_600_000).toISOString())).toThrow(/future/);
  });
});

describe("captureEmail with sent_at", () => {
  const tables = {
    profiles: [{ id: "myles", org_id: "org", email: "myles@murraystays.co.uk", deactivated_at: null }],
    conversation_members: [
      { user_id: "myles", conversation_id: "conv-myles", conversations: { type: "owner", archived_at: null } },
    ],
  };
  const mail = {
    messageId: "<abc@mail.gmail.com>",
    from: "Myles <myles@murraystays.co.uk>",
    to: ["zac@stayful.co.uk"],
    subject: "Cleaning",
    text: "Can we move the clean to Friday?",
    html: null,
    // The fake answers every profiles query with the same row, so the lead would also look like
    // a team member; a mailbox automation always says which way the mail went anyway.
    direction: "inbound" as const,
  };

  it("dates the row when it was sent and marks it as backfilled", async () => {
    const { admin, inserts } = fakeAdmin(tables);
    const result = await captureEmail(admin, { ...mail, sentAt: "2026-05-04T09:30:00.000Z", backfill: true });
    expect(result).toEqual({ ok: true, posted: 1, duplicate: undefined });
    const row = inserts.find((i) => i.table === "messages")!.row;
    expect(row.created_at).toBe("2026-05-04T09:30:00.000Z");
    expect(row.meta).toMatchObject({ mirrored: true, backfill: true, email_direction: "inbound" });
    expect(row.sender_id).toBe("myles");
  });

  it("leaves created_at to the database for a live capture", async () => {
    const { admin, inserts } = fakeAdmin(tables);
    await captureEmail(admin, mail);
    const row = inserts.find((i) => i.table === "messages")!.row;
    expect(row).not.toHaveProperty("created_at");
    expect(row.meta).not.toHaveProperty("backfill");
  });
});

describe("decideWhatsAppCapture", () => {
  const base: WhatsAppCaptureInput = {
    message: {
      messageUid: "uid-1",
      chatId: "123",
      phone: "+447828117537",
      direction: "inbound",
      text: "Hi Zac, is the key safe sorted?",
      sentAt: "2026-05-04T09:30:00.000Z",
    },
    counterpart: { profileId: "lead-1", orgId: "org-1", leadCategory: "airbnb_management", deactivatedAt: null },
    ownerGroup: { conversationId: "conv-1", archivedAt: null },
    senderUserId: "zac",
  };

  it("posts an inbound message as the lead", () => {
    expect(decideWhatsAppCapture(base)).toEqual({
      kind: "post",
      conversationId: "conv-1",
      orgId: "org-1",
      senderId: "lead-1",
      body: "Hi Zac, is the key safe sorted?",
      phone: "+447828117537",
    });
  });

  it("posts an outbound message as the team member", () => {
    const d = decideWhatsAppCapture({ ...base, message: { ...base.message, direction: "outbound" } });
    expect(d).toMatchObject({ kind: "post", senderId: "zac" });
  });

  it("normalises the number before matching", () => {
    const d = decideWhatsAppCapture({ ...base, message: { ...base.message, phone: "07828 117537" } });
    expect(d).toMatchObject({ kind: "post", phone: "+447828117537" });
  });

  it("describes a media-only message rather than dropping it", () => {
    const d = decideWhatsAppCapture({
      ...base,
      message: { ...base.message, text: "", mediaUrl: "https://example.com/photo.jpg" },
    });
    expect(d).toMatchObject({ kind: "post", body: "[Sent an attachment on WhatsApp]" });
  });

  it("says why it cannot post", () => {
    const reason = (input: WhatsAppCaptureInput) => {
      const d = decideWhatsAppCapture(input);
      return d.kind === "unmatched" ? d.reason : d.kind;
    };
    expect(reason({ ...base, message: { ...base.message, messageUid: " " } })).toBe("no_message_uid");
    expect(reason({ ...base, message: { ...base.message, phone: null } })).toBe("no_phone");
    expect(reason({ ...base, message: { ...base.message, phone: "+15551234567" } })).toBe("bad_number");
    expect(reason({ ...base, counterpart: null })).toBe("unknown_counterpart");
    expect(reason({ ...base, counterpart: { ...base.counterpart!, leadCategory: null } })).toBe("not_a_lead");
    expect(reason({ ...base, counterpart: { ...base.counterpart!, deactivatedAt: "2026-01-01" } })).toBe("deactivated");
    expect(reason({ ...base, ownerGroup: null })).toBe("no_group");
    expect(reason({ ...base, ownerGroup: { conversationId: "c", archivedAt: "2026-01-01" } })).toBe("archived");
    expect(reason({ ...base, message: { ...base.message, text: "  " } })).toBe("empty_body");
    expect(reason({ ...base, message: { ...base.message, direction: "outbound" }, senderUserId: null })).toBe(
      "no_team_sender",
    );
  });
});

describe("captureWhatsAppMessage", () => {
  const tables = {
    profiles: [{ id: "lead-1", org_id: "org-1", lead_category: "r2r", deactivated_at: null }],
    conversation_members: [{ conversation_id: "conv-1", conversations: { type: "owner", archived_at: null } }],
    whatsapp_accounts: [{ owner_user_id: "zac-by-number" }],
  };
  const message = {
    messageUid: "uid-9",
    chatId: "555",
    phone: "+447828117537",
    direction: "outbound" as const,
    text: "Yes, Tuesday works.",
    sentAt: "2026-05-04T09:30:00.000Z",
    sentFrom: "+447957516879",
  };

  it("writes the row at the time it was sent, attributed to the number's owner", async () => {
    const { admin, inserts } = fakeAdmin(tables);
    const result = await captureWhatsAppMessage(admin, message, { fallbackActorId: "key-user" });
    expect(result).toEqual({ ok: true, posted: 1, conversationId: "conv-1" });
    expect(inserts.map((i) => i.table)).toEqual(["messages"]);
    const row = inserts[0].row;
    expect(row).toMatchObject({
      conversation_id: "conv-1",
      sender_id: "zac-by-number",
      sent_via: "whatsapp",
      external_ref: "uid-9",
      created_at: "2026-05-04T09:30:00.000Z",
    });
    expect(row.meta).toMatchObject({
      mirrored: true,
      backfill: true,
      whatsapp_direction: "outbound",
      whatsapp_to: "+447828117537",
      routed_via: "lead_backfill",
    });
  });

  it("falls back to the key's user when the sending number is not on file", async () => {
    const { admin, inserts } = fakeAdmin({ ...tables, whatsapp_accounts: [] });
    await captureWhatsAppMessage(admin, message, { fallbackActorId: "key-user" });
    expect(inserts[0].row.sender_id).toBe("key-user");
  });

  it("answers duplicate when the webhook already stored the uid", async () => {
    const { admin, inserts, insertErrors } = fakeAdmin(tables);
    insertErrors.messages = { code: "23505", message: "duplicate key" };
    const result = await captureWhatsAppMessage(admin, message, { fallbackActorId: "key-user" });
    expect(result).toEqual({ ok: true, posted: 0, duplicate: true, conversationId: "conv-1" });
    // No second attempt, and nothing in the unmatched table for a duplicate.
    expect(inserts).toHaveLength(1);
  });

  it("records a message from someone who is not a lead", async () => {
    const { admin, inserts } = fakeAdmin({ ...tables, profiles: [] });
    const result = await captureWhatsAppMessage(admin, { ...message, direction: "inbound" });
    expect(result).toEqual({ ok: true, ignored: "unknown_counterpart" });
    expect(inserts[0]).toMatchObject({
      table: "inbound_messages_unmatched",
      row: { channel: "whatsapp", external_ref: "uid-9", reason: "capture_unknown_counterpart" },
    });
  });
});
