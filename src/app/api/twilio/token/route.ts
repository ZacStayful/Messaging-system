import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accessTokenInputFromEnv, TwilioNotConfiguredError, voiceAccessToken } from "@/lib/twilio/accessToken";
import { callsConfigured, missingCallEnv } from "@/lib/twilio/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short. The SDK asks for another when it needs one, and a leaked token is then worth minutes. */
const TTL_SECONDS = 600;

/**
 * The credential the browser needs before it can place a call.
 *
 * POST rather than GET so it is never prefetched, never cached by an intermediary, and never
 * sitting in a browser history entry — the response body is a bearer credential for the voice
 * account.
 *
 * Team only. A customer pressing a Call button would place a real, billable call from a number
 * Stayful is responsible for, and RLS cannot help here: the token is minted from environment
 * secrets, so this route is the only thing standing in front of them.
 */
export async function POST() {
  if (!callsConfigured()) {
    return NextResponse.json({ error: "calling is not configured", missing: missingCallEnv() }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // Read through the caller's own session, not the service role: the row comes back only if RLS
  // would have shown it to them anyway.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, account_type, deactivated_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.account_type !== "team" || profile.deactivated_at) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // The identity is the profile id, so a call is attributed to a person rather than to a
    // browser — it is what the TwiML route checks the dialling client against.
    const token = voiceAccessToken({ ...accessTokenInputFromEnv(profile.id), ttlSeconds: TTL_SECONDS });
    return NextResponse.json(
      { token, identity: profile.id, expires_in: TTL_SECONDS },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof TwilioNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    throw e;
  }
}
