import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorised } from "@/lib/cron/auth";
import { runSlice } from "@/lib/slack/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Slack worker. Every minute, from vercel.json; each run does as much as fits in 45 seconds
 * and leaves the rest for the next one. Discovery, the user pass, the backfill and the daily
 * catch-up are all the same loop (src/lib/slack/backfill.ts); which of them runs is decided by
 * what the tables say is due, so this is a no-op costing a few queries when nothing is.
 *
 * A single `worker` lease keeps two overlapping runs from walking the same history; a run that
 * finds it held simply answers and goes away.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  try {
    const report = await runSlice(admin, 45_000);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("slack: slice failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
