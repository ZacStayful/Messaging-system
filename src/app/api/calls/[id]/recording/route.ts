import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plays back a call recording, for the people allowed to hear it.
 *
 * A Twilio recording URL is readable by anyone who holds it, so it never reaches the browser.
 * The audio element points here instead, and this asks the database on the listener's behalf.
 *
 * The check is the `call recordings: team reads` policy from 0032 — read through the caller's own
 * session, not the service role, so a customer sitting in the group gets an empty result and a
 * 404 without this route needing its own copy of the rule. That matters: a customer may see in
 * their thread that a call happened, and must not be able to listen to the team discussing them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    return NextResponse.json({ error: "calling is not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { data: recording } = await supabase.from("call_recordings").select("url").eq("call_id", id).maybeSingle();
  // 404 rather than 403 for a recording they may not hear: whether a call was recorded is itself
  // something a customer should not be able to probe for.
  if (!recording) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Twilio serves the media at the recording URL plus an extension; asking for mp3 keeps it
  // playable in every browser without transcoding here.
  const source = `${recording.url.replace(/\.(mp3|wav)$/, "")}.mp3`;
  const upstream = await fetch(source, {
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "the recording could not be fetched" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
      // Private and short: the response carries audio of a real conversation, and a shared CDN
      // cache keyed on the URL alone would serve it to the next person who asked.
      "cache-control": "private, max-age=60",
      ...(upstream.headers.get("content-length") ? { "content-length": upstream.headers.get("content-length")! } : {}),
    },
  });
}
