import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCallSummary, type CallStatus } from "@/lib/twilio/summary";
import { readSignedWebhook } from "@/lib/twilio/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The statuses after which nothing more happens, and the thread is owed a line. */
const TERMINAL = new Set<string>(["completed", "busy", "no-answer", "failed", "canceled"]);

/**
 * Twilio telling us how the call is going, and finally how it went.
 *
 * Fires on `answered` and `completed` for the leg that rang the contact's mobile. The last one
 * is what writes the summary into the thread — which is the whole point of storing calls at all,
 * because a call nobody can see afterwards is a conversation that happened outside the record.
 *
 * Always answers 200 once the request is authentic, including when there is nothing to do.
 * Twilio retries a non-2xx, and a callback for a call we cannot find will not become findable on
 * the retry.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSignedWebhook(request, token);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const p = read.params;
  // The callback rides on <Number>, so CallSid is the dialled leg and ParentCallSid is the
  // browser leg we recorded. Falling back to CallSid keeps this working if the callback is ever
  // moved onto <Dial> itself, where there is no parent.
  const sid = p.ParentCallSid || p.CallSid;
  const status = (p.CallStatus ?? "") as CallStatus;
  if (!sid || !status) return NextResponse.json({ ok: true, ignored: "incomplete callback" });

  const { data: call } = await admin
    .from("calls")
    .select("id, org_id, conversation_id, parent_message_id, direction, to_user_id, started_by, summary_message_id")
    .eq("twilio_call_sid", sid)
    .maybeSingle();
  if (!call) return NextResponse.json({ ok: true, ignored: "unknown call" });

  const duration = Number.parseInt(p.CallDuration ?? "", 10);
  const now = new Date().toISOString();
  const terminal = TERMINAL.has(status);

  await admin
    .from("calls")
    .update({
      status,
      // Twilio sends no answer timestamp of its own; the moment it says "in-progress" is the
      // moment someone picked up.
      ...(status === "in-progress" ? { answered_at: now } : {}),
      ...(terminal ? { ended_at: now } : {}),
      ...(Number.isFinite(duration) ? { duration_seconds: duration } : {}),
    })
    .eq("id", call.id);

  if (!terminal || call.summary_message_id) return NextResponse.json({ ok: true, status });

  const ids = [call.to_user_id, call.started_by].filter((id): id is string => !!id);
  const { data: people } = ids.length
    ? await admin.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameOf = (id: string | null) => people?.find((x) => x.id === id)?.display_name ?? "them";

  const summary = buildCallSummary({
    id: call.id,
    status,
    direction: call.direction === "inbound" ? "inbound" : "outbound",
    contactName: nameOf(call.to_user_id),
    callerName: call.started_by ? nameOf(call.started_by) : undefined,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    recorded: true,
  });

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      org_id: call.org_id,
      conversation_id: call.conversation_id,
      // Attributed to the team member who placed it, so it reads as their action rather than as
      // something the system did on its own.
      sender_id: call.started_by,
      parent_id: call.parent_message_id,
      body: summary.body,
      kind: "call_summary",
      visibility: "public",
      // messages_client_id_idx makes this the idempotency key: Twilio retries a callback it
      // thinks failed, and one call must not become two lines in the thread.
      meta: { ...summary.meta, client_id: `call:${call.id}` },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ ok: true, error: error.message });
  }

  if (message) {
    await admin.from("calls").update({ summary_message_id: message.id }).eq("id", call.id);
  }
  return NextResponse.json({ ok: true, status, summary_message_id: message?.id ?? null });
}
