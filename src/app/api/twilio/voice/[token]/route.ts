import { createAdminClient } from "@/lib/supabase/admin";
import { dialTwiML, sayAndHangupTwiML, TWIML_CONTENT_TYPE } from "@/lib/twilio/twiml";
import { callbackOrigin, readSignedWebhook } from "@/lib/twilio/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio expects TwiML even when we are refusing; a non-XML body is a dead silent line. */
function twiml(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": TWIML_CONTENT_TYPE } });
}

/**
 * The TwiML App's Voice URL. Twilio fetches this the moment the browser dials, and whatever
 * comes back is the call.
 *
 * The browser sends one parameter of ours — `CallId`, the row start_call already created — and
 * everything else is read from that row rather than from the request. This is on purpose: the
 * number dialled and the caller ID shown are the two things that must not be attacker-chosen,
 * and a `To` taken from the POST body would let anyone who reached this endpoint place a call
 * anywhere in the world on Stayful's account.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSignedWebhook(request, token);
  if (!read.ok) {
    // 503 is our own misconfiguration and worth saying out loud; 401 gets a flat refusal.
    return read.status === 503
      ? twiml(sayAndHangupTwiML("Calling is not configured."), 503)
      : new Response("unauthorised", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return twiml(sayAndHangupTwiML("Calling is not configured."), 503);

  const callId = read.params.CallId;
  const callSid = read.params.CallSid;
  // `From` on a Voice SDK call is `client:<identity>`, and the identity is the profile id the
  // token route minted for. Checking it binds this TwiML to the person who started the call:
  // a team member who guessed another call's id would still be dialling as themselves.
  const client = (read.params.From ?? "").startsWith("client:") ? read.params.From.slice(7) : null;

  if (!callId || !client) return twiml(sayAndHangupTwiML("That call could not be placed."), 400);

  const { data: call } = await admin
    .from("calls")
    .select("id, direction, from_number, to_number, started_by, status, twilio_call_sid")
    .eq("id", callId)
    .maybeSingle();

  if (!call || call.direction !== "outbound" || call.started_by !== client) {
    return twiml(sayAndHangupTwiML("That call could not be placed."), 403);
  }
  // A row is good for one call. Without this, a replayed request with the same CallId would dial
  // the contact again — from a request that is perfectly signed, because it once was.
  if (call.twilio_call_sid && call.twilio_call_sid !== callSid) {
    return twiml(sayAndHangupTwiML("That call has already been placed."), 409);
  }

  await admin
    .from("calls")
    .update({ twilio_call_sid: callSid, status: "initiated" })
    .eq("id", call.id)
    .is("twilio_call_sid", null);

  const origin = callbackOrigin(read.url);
  return twiml(
    dialTwiML({
      to: call.to_number,
      callerId: call.from_number,
      record: true,
      statusCallback: `${origin}/api/twilio/status/${token}`,
      recordingStatusCallback: `${origin}/api/twilio/recording/${token}`,
    }),
  );
}
