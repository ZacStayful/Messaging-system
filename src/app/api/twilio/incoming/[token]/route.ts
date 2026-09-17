import { createAdminClient } from "@/lib/supabase/admin";
import { sayAndHangupTwiML, voicemailTwiML, TWIML_CONTENT_TYPE } from "@/lib/twilio/twiml";
import { callbackOrigin, readSignedWebhook } from "@/lib/twilio/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function twiml(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": TWIML_CONTENT_TYPE } });
}

/**
 * Somebody rang the Stayful number.
 *
 * They will. Ofcom has required since May 2023 that a caller ID be valid, dialable and uniquely
 * identifying, so the number every outbound call shows has to answer — and a cleaner returning a
 * missed call is the likeliest person to try it. Before this route existed the number rang out
 * forever, which looks like a real line and behaves like a disconnected one.
 *
 * Register it on the *number's* own page, "A call comes in". That is a different field on a
 * different page from the TwiML App's Voice URL, and wiring the same one twice is the easy
 * mistake to make.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSignedWebhook(request, token);
  if (!read.ok) {
    return read.status === 503
      ? twiml(sayAndHangupTwiML("This number is not available."), 503)
      : new Response("unauthorised", { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) return twiml(sayAndHangupTwiML("This number is not available."), 503);

  /**
   * The organisation comes from the number that was dialled, never from the caller.
   *
   * This is what voice_numbers is for. At this moment the caller is very often a stranger — a
   * wrong number, a cold call, a contact ringing from a handset we have never seen — so `From`
   * can tell us nothing reliable, while `To` is a number we bought and therefore own.
   */
  const to = read.params.To ?? "";
  const { data: number } = await admin
    .from("voice_numbers")
    .select("org_id, organisations(name)")
    .eq("phone", to)
    .maybeSingle();

  if (!number) {
    // A number pointed at us that we have no row for. Say something rather than hanging in
    // silence, which to a caller is indistinguishable from a broken line.
    return twiml(sayAndHangupTwiML("Sorry, this number is not in service."));
  }

  const org = (number.organisations as unknown as { name: string } | null)?.name ?? "Stayful";
  const origin = callbackOrigin(read.url);

  return twiml(
    voicemailTwiML({
      greeting:
        `Thanks for calling ${org}. We can't take your call right now. ` +
        `Please leave a message after the tone and we'll get back to you.`,
      recordingStatusCallback: `${origin}/api/twilio/voicemail/${token}`,
    }),
  );
}
