/**
 * Is this really Vercel Cron?
 *
 * Fails closed on an unset CRON_SECRET rather than waving the request through: an unguarded cron
 * endpoint is a public URL that drains a queue, and now also one that deletes recordings.
 *
 * Lifted out of the notifications route when retention became a second cron. One definition, so
 * a change to how crons authenticate cannot land on one of them and miss the other.
 *
 * The comparison is constant-time, through the same helper as the webhook tokens: `===` returns
 * at the first wrong character, which lets a caller measure how much of the secret they have.
 */
import { verifyWebhookToken } from "@/lib/whatsapp/inbound";

export function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return verifyWebhookToken(request.headers.get("authorization"), `Bearer ${secret}`);
}
