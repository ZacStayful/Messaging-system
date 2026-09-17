/**
 * How long audio of a real conversation is kept.
 *
 * Recordings and voicemails are conversations about named people — where a cleaner was, what a
 * contractor quoted, what a customer complained about — so they are personal data, and "keep for
 * ever" is not a defensible answer under UK GDPR. Six months is the agreed window: long enough
 * that an autumn query about a summer changeover can still be checked, short enough to justify.
 *
 * The number is a setting rather than a constant so that changing it is not a deploy, and the
 * parsing is here rather than inline so a typo in the environment cannot silently become a very
 * short window. An unreadable value falls back to the default rather than to zero — the failure
 * mode of this job is deleting things, and it should never fail toward deleting more.
 */
export const DEFAULT_RETENTION_DAYS = 180;

export function retentionDays(raw: string | undefined = process.env.RECORDING_RETENTION_DAYS): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  // 0 is meaningful and allowed — it is how the job is exercised in a test — but anything that is
  // not a finite, non-negative number is a mistake, and a mistake must not widen the sweep.
  if (!Number.isFinite(n) || n < 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(n);
}

/** Anything created before this moment is out of the window. */
export function cutoff(now: Date = new Date(), days: number = retentionDays()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Removes the recording from Twilio.
 *
 * Deleting our row alone would leave the audio sitting in Twilio's account for ever, which is the
 * thing the window exists to prevent — the row is only the pointer. A 404 counts as success: it
 * means the recording is already gone, which is the state we were trying to reach.
 */
export async function deleteTwilioRecording(recordingSid: string): Promise<{ ok: boolean; status: number }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return { ok: false, status: 0 };

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${encodeURIComponent(recordingSid)}.json`,
    {
      method: "DELETE",
      headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
    },
  );
  return { ok: res.ok || res.status === 404, status: res.status };
}
