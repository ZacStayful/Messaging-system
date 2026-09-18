/**
 * Is this really Vercel Cron?
 *
 * Fails closed on an unset CRON_SECRET rather than waving the request through: an unguarded cron
 * endpoint is a public URL that drains a queue, and now also one that deletes recordings.
 *
 * Lifted out of the notifications route when retention became a second cron. One definition, so
 * a change to how crons authenticate cannot land on one of them and miss the other.
 */
export function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
