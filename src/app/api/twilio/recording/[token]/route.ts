import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSignedWebhook } from "@/lib/twilio/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The recording is ready.
 *
 * Only the reference is stored. The audio stays at Twilio and is played back through a server
 * route that re-checks the listener, because a Twilio recording URL is readable by anyone
 * holding it — copying it into a message would hand it to every member of the thread, including
 * the customer the call was about.
 *
 * It lands in call_recordings rather than in a column on calls for the same reason: RLS is
 * row-level, so "the team may hear this, the customer may not" needs a row of its own.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSignedWebhook(request, token);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const p = read.params;
  // Recording callbacks report the leg that was recorded; for a dual-channel <Dial> recording
  // that is the parent, but take either so this does not depend on where the attribute sits.
  const sid = p.CallSid || p.ParentCallSid;
  const recordingSid = p.RecordingSid;
  const url = p.RecordingUrl;
  if (!sid || !recordingSid || !url || p.RecordingStatus !== "completed") {
    return NextResponse.json({ ok: true, ignored: "not a completed recording" });
  }

  const { data: call } = await admin.from("calls").select("id, org_id").eq("twilio_call_sid", sid).maybeSingle();
  if (!call) return NextResponse.json({ ok: true, ignored: "unknown call" });

  const seconds = Number.parseInt(p.RecordingDuration ?? "", 10);
  const { error } = await admin.from("call_recordings").upsert(
    {
      call_id: call.id,
      org_id: call.org_id,
      recording_sid: recordingSid,
      url,
      duration_seconds: Number.isFinite(seconds) ? seconds : null,
    },
    { onConflict: "call_id" },
  );
  if (error) return NextResponse.json({ ok: true, error: error.message });

  return NextResponse.json({ ok: true, call_id: call.id });
}
