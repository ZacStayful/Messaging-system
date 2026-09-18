import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorised } from "@/lib/cron/auth";
import { cutoff, deleteTwilioRecording, retentionDays } from "@/lib/calls/retention";
import { BUCKET } from "@/lib/storage/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A day's worth in one run is generous; anything larger waits for tomorrow rather than timing out. */
const BATCH = 200;

/**
 * Deletes call audio that has aged out of the retention window.
 *
 * Daily, from vercel.json. Two kinds of audio, deleted differently because they live in different
 * places for a reason that is documented at each of them:
 *
 *   - a **call recording** stays at Twilio and is team-only, being a recording *of* the team, so
 *     expiring it means a DELETE to Twilio and dropping the `call_recordings` row;
 *   - a **voicemail** was copied into our own bucket, being from the contact and meant to be
 *     heard in the thread, so expiring it means removing the object and the attachment row.
 *
 * What survives in both cases is the line in the thread. That a call happened, with whom and for
 * how long, is business record; the audio is the personal data. Deleting the message too would
 * quietly rewrite the history of a conversation six months after the fact, which is a far bigger
 * thing than this job is for.
 */
export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const days = retentionDays();
  const before = cutoff(new Date(), days).toISOString();

  // ---- call recordings ------------------------------------------------------
  const { data: recordings } = await admin
    .from("call_recordings")
    .select("call_id, recording_sid")
    .lt("created_at", before)
    .limit(BATCH);

  let recordingsDeleted = 0;
  const stuck: string[] = [];
  for (const row of recordings ?? []) {
    const { ok } = await deleteTwilioRecording(row.recording_sid);
    if (!ok) {
      // Keep the row. Dropping it while the audio is still at Twilio would lose the only handle
      // we have on it, and the sweep runs again tomorrow.
      stuck.push(row.recording_sid);
      continue;
    }
    await admin.from("call_recordings").delete().eq("call_id", row.call_id);
    recordingsDeleted++;
  }

  // ---- voicemails -----------------------------------------------------------
  // Only voice notes that arrived by voicemail: `sent_via = 'voice'` on the parent message is
  // what distinguishes them from the voice notes people record in the composer, which are
  // ordinary messages and not this job's business.
  const { data: voicemails } = await admin
    .from("attachments")
    .select("id, storage_path, message_id, messages!inner(sent_via)")
    .eq("category", "voice")
    .eq("messages.sent_via", "voice")
    .lt("created_at", before)
    .limit(BATCH);

  let voicemailsDeleted = 0;
  for (const row of voicemails ?? []) {
    const { error: removeError } = await admin.storage.from(BUCKET).remove([row.storage_path]);
    if (removeError) continue;
    await admin.from("attachments").delete().eq("id", row.id);

    // The line stays; it just says so now. A player that has quietly become a dead control is
    // worse than a sentence explaining where the audio went.
    const { data: message } = await admin.from("messages").select("meta").eq("id", row.message_id).maybeSingle();
    const meta = (message?.meta ?? {}) as Record<string, unknown>;
    await admin
      .from("messages")
      .update({ meta: { ...meta, audio_expired: true, audio_expired_after_days: days } })
      .eq("id", row.message_id);
    voicemailsDeleted++;
  }

  return NextResponse.json({
    ok: true,
    retention_days: days,
    before,
    recordings_deleted: recordingsDeleted,
    voicemails_deleted: voicemailsDeleted,
    ...(stuck.length ? { twilio_delete_failed: stuck.length } : {}),
  });
}
