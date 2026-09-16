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
 * Batches email rows per recipient and conversation within `windowMs`, so a flurry of replies
 * arrives as one email rather than six.
 *
 * WhatsApp deliberately does not come through here: one message, one chat message, because a
 * batched WhatsApp reads like a digest and the point of the channel is that it feels live.
 */
export function groupOutboxRows<T extends OutboxRowLike>(rows: T[], windowMs: number): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const p = r.payload as GroupablePayload;
    const key = `${r.recipient_user_id}:${p.conversation_id}`;
    const list = groups.get(key) ?? [];
    const first = list[0] ? (list[0].payload as GroupablePayload) : null;
    if (first && new Date(p.created_at).getTime() - new Date(first.created_at).getTime() > windowMs) {
      // Too far from the batch it would have joined: start a new one, keyed so it cannot merge.
      groups.set(`${key}:${r.id}`, [r]);
    } else {
      list.push(r);
      groups.set(key, list);
    }
  }
  return Array.from(groups.values());
}
