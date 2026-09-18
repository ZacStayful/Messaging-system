import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseUkMobile } from "@/lib/phone";
import { chooseRoute } from "@/lib/whatsapp/routing";
import { gather } from "@/lib/whatsapp/gather";
import { ingestAttachment } from "@/lib/storage/ingest";
import { voicemailBody } from "@/lib/twilio/summary";
import { readSignedWebhook } from "@/lib/twilio/webhook";

export const runtime = "nodejs";
// Fetching the audio from Twilio and pushing it to storage is the slow part.
export const maxDuration = 30;

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Files a voicemail nobody could place, and always answers 200.
 *
 * Exactly what the WhatsApp webhook does with an unroutable message, and for the same reason: a
 * 4xx makes Twilio retry, and a voicemail that cannot be routed will not route on the third
 * attempt either. The row is how the team finds out someone rang.
 *
 * `external_ref` carries the RecordingSid, which the existing
 * `inbound_unmatched_ref_idx on (channel, external_ref)` turns into idempotency for nothing.
 */
async function unmatched(admin: Admin, p: Record<string, string>, reason: string, orgId: string | null) {
  await admin.from("inbound_messages_unmatched").insert({
    channel: "voice",
    external_ref: p.RecordingSid ?? null,
    from_identifier: p.From ?? "unknown",
    body: null,
    payload: p as never,
    reason,
    ...(orgId ? { org_id: orgId } : {}),
  });
  return NextResponse.json({ ok: true, unmatched: reason });
}

/**
 * A voicemail is ready.
 *
 * The audio is **copied into the attachments bucket**, which is the one place this feature
 * deliberately inverts the rule `/api/twilio/recording` follows. A call recording stays at
 * Twilio and is team-only, because it is a recording *of the team* and a customer sitting in the
 * group must not play it back. A voicemail is the opposite: it is from the contact, addressed to
 * us, and belongs in the thread like anything else they sent — so it plays inline, exactly like
 * the voice notes the composer already produces.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSignedWebhook(request, token);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const p = read.params;
  if (p.RecordingStatus !== "completed" || !p.RecordingUrl || !p.RecordingSid) {
    return NextResponse.json({ ok: true, ignored: "not a completed recording" });
  }

  // Which of our numbers they rang, and therefore whose voicemail this is.
  const { data: number } = await admin
    .from("voice_numbers")
    .select("org_id")
    .eq("phone", p.To ?? "")
    .maybeSingle();
  const orgId = number?.org_id ?? null;

  /**
   * Who rang.
   *
   * `profiles.phone` is `+447…` only — ACCEPT_RE and the matching CHECK on the column both say
   * so — which means a UK landline or an overseas caller can never resolve to a person however
   * well we know them. A contractor ringing from the office is therefore always unmatched. That
   * is a real limit rather than a bug: widening it means the four places named in 0018:26.
   */
  const parsed = normaliseUkMobile(p.From ?? "");
  if (!parsed.ok) return unmatched(admin, p, "bad_number", orgId);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, org_id, display_name, deactivated_at")
    .eq("phone", parsed.e164!)
    .maybeSingle();
  if (!profile) return unmatched(admin, p, "unknown_sender", orgId);
  if (profile.deactivated_at) return unmatched(admin, p, "deactivated", orgId);

  const decision = chooseRoute(await gather(admin, profile.id, profile.org_id));
  if (decision.kind === "unmatched") return unmatched(admin, p, decision.reason, profile.org_id);
  const { conversationId, parentMessageId, via } = decision;

  // Membership can have been revoked since the route was recorded, and the service role would
  // write anyway. The maintenance inbox is the deliberate exception — contractors are not
  // members of it, which is what stops each of them reading the others' quotes.
  if (via !== "maintenance_inbox") {
    const { data: stillIn } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!stillIn) return unmatched(admin, p, "not_a_member", profile.org_id);
  }

  const seconds = Number.parseInt(p.RecordingDuration ?? "", 10);
  const duration = Number.isFinite(seconds) ? seconds : null;

  // The message first: its id is part of the storage path, and the path is what the storage
  // policies read to decide who may download the audio.
  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      org_id: profile.org_id,
      conversation_id: conversationId,
      sender_id: profile.id,
      parent_id: parentMessageId,
      body: voicemailBody(profile.display_name, duration),
      kind: "text",
      visibility: "public",
      sent_via: "voice",
      external_ref: p.RecordingSid,
      // Dedupe rides on messages_external_ref_voice_idx (0033) rather than on meta.client_id:
      // that is the shape email and WhatsApp already use for a redelivered inbound webhook, and
      // a third mechanism for the same job is a third thing to get wrong.
      meta: {
        voicemail_from: parsed.e164,
        voicemail_received_on: p.To ?? null,
        duration_seconds: duration,
        routed_via: via,
      },
    })
    .select("id")
    .maybeSingle();

  if (messageError) {
    if (messageError.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ ok: true, error: messageError.message });
  }
  if (!message) return NextResponse.json({ ok: true, error: "the voicemail could not be filed" });

  // Twilio serves the media at the recording URL plus an extension, and the URL is readable by
  // anyone holding it — hence the account credentials and the copy into our own bucket.
  const source = `${p.RecordingUrl.replace(/\.(mp3|wav)$/, "")}.mp3`;
  const upstream = await fetch(source, {
    headers: {
      authorization: `Basic ${Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`,
      ).toString("base64")}`,
    },
  });

  if (upstream.ok) {
    const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
    await ingestAttachment(admin, {
      orgId: profile.org_id,
      conversationId,
      messageId: message.id,
      fileName: `Voicemail ${stamp}.mp3`,
      mime: "audio/mpeg",
      body: await upstream.arrayBuffer(),
      voice: true,
      durationMs: duration ? duration * 1000 : undefined,
    });
  }
  // A failed fetch leaves the line in the thread without the audio. Better than losing the fact
  // that somebody rang, and Twilio still holds the recording if it has to be chased.

  // The call row last, because calls.conversation_id is not null and the conversation is not
  // known until chooseRoute has run. A ring-back hung up before the beep leaves no row at all.
  await admin.from("calls").insert({
    org_id: profile.org_id,
    conversation_id: conversationId,
    parent_message_id: parentMessageId,
    twilio_call_sid: p.CallSid ?? null,
    direction: "inbound",
    from_number: parsed.e164!,
    to_number: p.To ?? "",
    to_user_id: profile.id,
    status: "completed",
    duration_seconds: duration,
    ended_at: new Date().toISOString(),
    // No summary_message_id: the voicemail message *is* the record, and a call_summary beside it
    // would be two lines for one event.
  });

  return NextResponse.json({ ok: true, conversation_id: conversationId, via });
}
