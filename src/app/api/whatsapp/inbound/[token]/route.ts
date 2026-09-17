import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseInboundPayload, verifyWebhookToken, type InboundWhatsApp } from "@/lib/whatsapp/inbound";
import { normaliseUkMobile } from "@/lib/phone";
import { chooseRoute } from "@/lib/whatsapp/routing";
import { gather } from "@/lib/whatsapp/gather";

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

/**
 * Resolves which of our numbers a message arrived on, registering it if we have not seen it.
 *
 * Stayful connects a handful of numbers, one per account manager, and they get added in
 * TimelinesAI rather than here. Self-registering on first contact means a newly connected number
 * works immediately instead of dropping messages until someone remembers to add a row. The row
 * arrives inactive-by-default in no sense — it is usable at once, but never `is_default`, so it
 * cannot quietly take over as the fallback for every new group.
 */
async function resolveAccount(admin: Admin, orgId: string, m: InboundWhatsApp): Promise<string | null> {
  if (!m.receivedOn) return null;
  const { data: existing } = await admin
    .from("whatsapp_accounts")
    .select("id")
    .eq("org_id", orgId)
    .eq("phone", m.receivedOn)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: owner } = m.receivedByEmail
    ? await admin.from("profiles").select("id").eq("org_id", orgId).ilike("email", m.receivedByEmail).maybeSingle()
    : { data: null };
  const { data: created } = await admin
    .from("whatsapp_accounts")
    .insert({
      org_id: orgId,
      phone: m.receivedOn,
      owner_email: m.receivedByEmail,
      owner_user_id: owner?.id ?? null,
      account_name: m.receivedByEmail ?? null,
    })
    .select("id")
    .maybeSingle();
  return created?.id ?? null;
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

  const decision = chooseRoute(await gather(admin, profile.id, profile.org_id));
  if (decision.kind === "unmatched") return unmatched(admin, m, decision.reason, raw);
  const { conversationId, parentMessageId, via } = decision;

  // Re-check membership even when a route pointed us somewhere: they may have been removed
  // since, and the service role would happily write anyway.
  //
  // The one exception is the central maintenance inbox, which contractors are deliberately not
  // members of — that is what stops each of them reading the others' quotes — so a membership
  // check there would reject every message it is meant to receive.
  if (via !== "maintenance_inbox") {
    const { data: stillIn } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!stillIn) return unmatched(admin, m, "not_a_member", raw);
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("archived_at, whatsapp_account_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (conv?.archived_at) return unmatched(admin, m, "archived", raw);

  // Media is not ingested yet, but a photo with no caption must not become an empty message that
  // silently disappears — the team needs to know something arrived.
  const body = m.text.trim() || (m.mediaUrl ? "[Sent an attachment on WhatsApp]" : "");
  if (!body) return unmatched(admin, m, "empty_body", raw);

  const accountId = await resolveAccount(admin, profile.org_id, m);
  // A group with no number yet takes the one they reached us on. This is not "moving" a group —
  // an assigned group keeps its number however the customer gets in touch, per the agreed rule
  // that their number identifies them and ours is only the doorway.
  if (accountId && !conv?.whatsapp_account_id) {
    await admin.from("conversations").update({ whatsapp_account_id: accountId }).eq("id", conversationId);
  }

  const { error } = await admin.from("messages").insert({
    org_id: profile.org_id,
    conversation_id: conversationId,
    sender_id: profile.id,
    body,
    kind: "text",
    visibility: "public",
    sent_via: "whatsapp",
    external_ref: m.externalRef,
    parent_id: parentMessageId,
    meta: {
      whatsapp_chat_id: m.chatId,
      whatsapp_from: parsed.e164,
      // Which Stayful number they reached, so the team can see it even when it is not the
      // group's own and so a mis-sent reply is traceable.
      whatsapp_received_on: m.receivedOn ?? null,
      whatsapp_media_url: m.mediaUrl ?? null,
      // How it got here, so a message filed in the wrong place can be argued with rather than
      // just re-filed. Load-bearing for the maintenance inbox, where every message is waiting
      // for someone to decide which property it belongs to.
      routed_via: via,
    },
  });
  if (error) {
    // messages_external_ref_whatsapp_idx: TimelinesAI redelivered one we already stored.
    if (error.code === "23505") return { ok: true, duplicate: true, ref: m.externalRef };
    return { error: error.message, ref: m.externalRef };
  }

  // One row per (person, conversation) since 0025, so a cleaner accumulates one per property
  // rather than the newest overwriting the last.
  await admin.from("whatsapp_threads").upsert(
    {
      user_id: profile.id,
      org_id: profile.org_id,
      conversation_id: conversationId,
      phone: parsed.e164!,
      parent_message_id: parentMessageId,
      last_inbound_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );

  return { ok: true, ref: m.externalRef, conversation_id: conversationId, via };
}
