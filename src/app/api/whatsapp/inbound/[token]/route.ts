import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseInboundPayload, verifyWebhookToken, type InboundWhatsApp } from "@/lib/whatsapp/inbound";
import { normaliseUkMobile } from "@/lib/phone";

export const dynamic = "force-dynamic";
// TimelinesAI wants a 2xx within about five seconds, so nothing here calls out to anything.
export const maxDuration = 10;

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Records a message we could not route, and always answers 200.
 *
 * A 4xx would make TimelinesAI retry twice, and a message that cannot be routed will not route
 * on the third attempt either. The row is how the team finds out, rather than the message simply
 * disappearing the way an unroutable inbound email does today.
 */
async function unmatched(admin: Admin, m: InboundWhatsApp, reason: string, raw: unknown) {
  await admin.from("inbound_messages_unmatched").insert({
    channel: "whatsapp",
    external_ref: m.externalRef,
    from_identifier: m.fromPhone,
    body: m.text || null,
    payload: (raw ?? {}) as never,
    reason,
  });
  return { ignored: reason, ref: m.externalRef };
}

/**
 * TimelinesAI inbound webhook. Register it as
 * https://chat.stayful.co.uk/api/whatsapp/inbound/<WHATSAPP_WEBHOOK_TOKEN>.
 *
 * A customer's WhatsApp reply lands in their group looking like any other message from them, so
 * the team reads one thread and never has to know which app it arrived from.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expected) return NextResponse.json({ error: "WHATSAPP_WEBHOOK_TOKEN is not set" }, { status: 503 });

  const { token } = await params;
  if (!verifyWebhookToken(token, expected)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // Optional second factor, enabled only if the dashboard can send custom headers. "Set means
  // required", so it can be switched on without a deploy.
  const headerSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (headerSecret && !verifyWebhookToken(request.headers.get("x-stayful-token"), headerSecret)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const results: unknown[] = [];
  for (const m of normaliseInboundPayload(raw)) {
    // Our own outbound coming back. Storing one would post it as if the customer had written it,
    // which notifies them, which arrives back here. This is the echo loop.
    if (m.direction === "sent") {
      results.push({ ignored: "our own outbound", ref: m.externalRef });
      continue;
    }
    if (m.isGroup) {
      results.push({ ignored: "group chat", ref: m.externalRef });
      continue;
    }
    results.push(await route(admin, m, raw));
  }
  return NextResponse.json({ ok: true, results });
}

async function route(admin: Admin, m: InboundWhatsApp, raw: unknown) {
  const parsed = normaliseUkMobile(m.fromPhone);
  if (!parsed.ok) return unmatched(admin, m, "bad_number", raw);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, org_id, deactivated_at")
    .eq("phone", parsed.e164!)
    .maybeSingle();
  if (!profile) return unmatched(admin, m, "unknown_sender", raw);
  if (profile.deactivated_at) return unmatched(admin, m, "deactivated", raw);

  // Where we last WhatsApped them from. 0018 guarantees one customer group per external member,
  // so the fallback below cannot be ambiguous either.
  const { data: thread } = await admin
    .from("whatsapp_threads")
    .select("conversation_id")
    .eq("user_id", profile.id)
    .maybeSingle();

  let conversationId = thread?.conversation_id ?? null;
  if (!conversationId) {
    const { data: membership } = await admin
      .from("conversation_members")
      .select("conversation_id, conversations!inner(type, archived_at)")
      .eq("user_id", profile.id)
      .eq("member_side", "external")
      .eq("conversations.type", "owner")
      .is("conversations.archived_at", null)
      .limit(1)
      .maybeSingle();
    conversationId = membership?.conversation_id ?? null;
  }
  if (!conversationId) return unmatched(admin, m, "no_group", raw);

  // Re-check membership even when whatsapp_threads pointed us somewhere: they may have been
  // removed from the group since, and the service role would happily write anyway.
  const { data: stillIn } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!stillIn) return unmatched(admin, m, "not_a_member", raw);

  const { data: conv } = await admin.from("conversations").select("archived_at").eq("id", conversationId).maybeSingle();
  if (conv?.archived_at) return unmatched(admin, m, "archived", raw);

  // Media is not ingested yet, but a photo with no caption must not become an empty message that
  // silently disappears — the team needs to know something arrived.
  const body = m.text.trim() || (m.mediaUrl ? "[Sent an attachment on WhatsApp]" : "");
  if (!body) return unmatched(admin, m, "empty_body", raw);

  const { error } = await admin.from("messages").insert({
    org_id: profile.org_id,
    conversation_id: conversationId,
    sender_id: profile.id,
    body,
    kind: "text",
    visibility: "public",
    sent_via: "whatsapp",
    external_ref: m.externalRef,
    meta: { whatsapp_chat_id: m.chatId, whatsapp_from: parsed.e164, whatsapp_media_url: m.mediaUrl ?? null },
  });
  if (error) {
    // messages_external_ref_whatsapp_idx: TimelinesAI redelivered one we already stored.
    if (error.code === "23505") return { ok: true, duplicate: true, ref: m.externalRef };
    return { error: error.message, ref: m.externalRef };
  }

  await admin
    .from("whatsapp_threads")
    .upsert(
      {
        user_id: profile.id,
        org_id: profile.org_id,
        conversation_id: conversationId,
        phone: parsed.e164!,
        last_inbound_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  return { ok: true, ref: m.externalRef, conversation_id: conversationId };
}
