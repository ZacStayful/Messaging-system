import { manualAway, notificationsSilenced } from "@/lib/presence";

/**
 * The two decisions the notification drain makes before it sends anything: should this row go
 * out at all, and which rows travel together.
 *
 * They live here rather than inline in the cron route because they are where the bugs are — a
 * misplaced predicate here is the difference between someone receiving nothing and someone
 * being messaged after asking not to be — and a route handler cannot be unit-tested without a
 * database, a cron secret and a live Resend key.
 */

export interface OutboxRowLike {
  id: number;
  channel: string;
  recipient_user_id: string | null;
  /** Where the email actually goes. Part of the grouping key: see groupKey below. */
  recipient_email?: string | null;
  payload: unknown;
}

export interface RecipientPrefs {
  /** Matches what the drain selects from profiles; presence fields feed notificationsSilenced. */
  presence_mode: string;
  away_until: string | null;
  dnd_until: string | null;
  email_notifications?: string | null;
  whatsapp_notifications?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Why this row should not be sent, or null to send it.
 *
 * The enqueue trigger checks the same preferences, but a minute passes between queuing and
 * sending, and going quiet the moment you set yourself away is the whole point of that feature.
 */
export function skipReason(row: { channel: string }, pref: RecipientPrefs | undefined): string | null {
  if (!pref) return null;
  if (notificationsSilenced(pref)) return manualAway(pref) ? "recipient away" : "notifications paused";
  if (row.channel === "whatsapp") {
    if (pref.whatsapp_notifications === "off") return "whatsapp notifications off";
    if (!pref.phone) return "no mobile number";
    return null;
  }
  if (pref.email_notifications === "off") return "email notifications off";
  if (!pref.email) return "no email address";
  return null;
}

interface GroupablePayload {
  conversation_id: string;
  created_at: string;
}

/**
 * The identity a batch is addressed to, or null for a row that must travel alone.
 *
 * `recipient_user_id` is nullable, and the old key interpolated it straight into a template
 * string — so two rows with no recipient in the same conversation both keyed on the literal
 * `"null:<conversation>"` and batched together. The drain then addresses the whole batch to
 * `batch[0].recipient_email` and signs the unsubscribe link for nobody, which is one person
 * receiving another person's messages. A CHECK constraint (0019) happens to make that
 * unreachable today for email rows; this makes it unreachable by construction.
 *
 * `recipient_email` is in the key for the same reason: it is what the send actually uses, so
 * anything it disagrees on must not be merged.
 *
 * NUL separates the parts because it cannot occur in a uuid, an address or a timestamp, so no
 * value can forge a key boundary by containing the separator.
 */
function groupKey(row: OutboxRowLike): string | null {
  if (!row.recipient_user_id) return null;
  const payload = row.payload as GroupablePayload | null;
  if (!payload?.conversation_id) return null;
  return `${row.recipient_user_id}\u0000${row.recipient_email ?? ""}\u0000${payload.conversation_id}`;
}

/** The message's own timestamp, not the row's. NaN means the row cannot be placed in a window. */
function messageTime(row: OutboxRowLike): number {
  const payload = row.payload as GroupablePayload | null;
  return payload?.created_at ? new Date(payload.created_at).getTime() : Number.NaN;
}

/**
 * Batches email rows per recipient and conversation within `windowMs`, so a flurry of replies
 * arrives as one email rather than six.
 *
 * WhatsApp deliberately does not come through here: one message, one chat message, because a
 * batched WhatsApp reads like a digest and the point of the channel is that it feels live.
 *
 * Two things this gets right that the first version did not:
 *
 *   - **The open batch is read back.** The old code stored an overflowing row under a fresh key
 *     (`<key>:<id>`) but only ever *looked up* the base key, so nothing ever found the new batch:
 *     the window anchor stayed pinned to the first row of the whole run, and every row past the
 *     first window became a batch of one. Five messages spanning two windows produced four
 *     emails instead of two — worst for the busiest conversations, which is exactly backwards.
 *   - **Order is imposed rather than assumed.** The drain sorts by the outbox row's `created_at`,
 *     but the window is measured on the *message's*, and the two diverge: the WhatsApp fallback
 *     copies an old payload onto a new row. The old comparison had no `Math.abs`, so an
 *     out-of-order row produced a negative difference and merged however old it was.
 */
export function groupOutboxRows<T extends OutboxRowLike>(rows: T[], windowMs: number): T[][] {
  const ordered = [...rows].sort((a, b) => {
    const diff = messageTime(a) - messageTime(b);
    // id breaks ties, and keeps the order of anything with an unusable timestamp stable.
    return Number.isNaN(diff) || diff === 0 ? a.id - b.id : diff;
  });

  /** The batch still accepting rows for a key. Output holds the same arrays, so pushing shows. */
  const open = new Map<string, T[]>();
  const batches: T[][] = [];

  for (const row of ordered) {
    const key = groupKey(row);
    const at = messageTime(row);
    if (key === null || Number.isNaN(at)) {
      // Alone: nothing about this row is safe to merge on.
      batches.push([row]);
      continue;
    }
    const current = open.get(key);
    if (current && at - messageTime(current[0]) <= windowMs) {
      current.push(row);
      continue;
    }
    // Either the first row for this key, or the open batch has aged out. Re-anchor.
    const fresh = [row];
    open.set(key, fresh);
    batches.push(fresh);
  }

  return batches;
}
