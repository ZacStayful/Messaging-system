import { fetchWithTimeout } from "@/lib/net/withTimeout";
/**
 * Thin TimelinesAI client (https://timelines.ai/docs/guides/sending-messages). Server-only.
 *
 * Every TimelinesAI-specific detail lives here — the endpoint, the field names, the shape of
 * the response — so that correcting the provider is one file and not a search across the app.
 * Shaped like src/lib/email/resend.ts on purpose: same SendResult, same "configured?" guard,
 * same raw fetch with no SDK.
 *
 * Note this is load-bearing for sign-in, not just notifications: the first-login gate sends its
 * verification code through here.
 */

export interface WhatsAppMessage {
  /** E.164, as produced by normaliseUkMobile. TimelinesAI rejects spaces and brackets. */
  to: string;
  text: string;
  /**
   * Which of our numbers to send from. Stayful runs one per account manager, and the group being
   * messaged decides which — so the customer always sees the same number and their phone shows
   * one continuous conversation rather than a chat per person who replied.
   *
   * TimelinesAI's own account id (`4479…@s.whatsapp.net`) when we know it; falling back to the
   * account's phone number, which is all the inbound webhook tells us about a number.
   */
  accountId?: string | null;
  accountPhone?: string | null;
  /** Optional TimelinesAI chat label, handy for telling app traffic from hand-sent messages. */
  label?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
}

const DEFAULT_BASE = "https://app.timelines.ai/integrations/api";

export function whatsappConfigured(): boolean {
  return !!process.env.TIMELINES_API_TOKEN || dryRun();
}

/** Local and test only: pretend the send worked so the whole drain can be exercised offline. */
export function dryRun(): boolean {
  return process.env.TIMELINES_DRY_RUN === "1";
}

export function whatsappApiBase(): string {
  return (process.env.TIMELINES_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

export async function sendWhatsApp(message: WhatsAppMessage): Promise<SendResult> {
  if (dryRun()) return { ok: true, id: `dry-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };

  const token = process.env.TIMELINES_API_TOKEN;
  if (!token) return { ok: false, skipped: true, error: "TIMELINES_API_TOKEN is not set" };

  try {
    const res = await fetchWithTimeout(`${whatsappApiBase()}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: message.to,
        text: message.text,
        // Per-group account first, then the env fallback for a single-number setup.
        whatsapp_account_id: message.accountId || process.env.TIMELINES_WHATSAPP_ACCOUNT_ID || undefined,
        whatsapp_account_phone: message.accountPhone || undefined,
        label: message.label,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      message_uid?: string;
      id?: string;
      data?: { message_uid?: string };
      message?: string;
      detail?: string;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: body.message || body.detail || body.error || `TimelinesAI responded ${res.status}` };
    }
    return { ok: true, id: body.message_uid ?? body.data?.message_uid ?? body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Did we already send this?
 *
 * Asked only of a row a previous run had already handed to TimelinesAI before dying — see
 * notification_outbox.dispatched_at (0038). TimelinesAI has no idempotency key, so the choice on
 * such a row is otherwise between risking a duplicate and risking a miss. Reading the chat turns
 * the guess into an answer nearly every time.
 *
 * Two calls, both only on that rare path: find the direct chat for the number, then read what we
 * sent in it since the moment we dispatched. Matching is on the exact text, which is safe here
 * because the question is not "has anything like this been said" but "is the message we composed
 * already in the chat" — and we composed it, verbatim, from a template.
 *
 * Returns null when the question cannot be answered — not configured, an API error, no chat. The
 * caller decides what to do with "don't know"; this does not decide for it by returning false.
 */
export async function findSentMessage(opts: {
  phone: string;
  text: string;
  since: string;
}): Promise<{ found: boolean; uid?: string } | null> {
  const token = process.env.TIMELINES_API_TOKEN;
  if (!token || dryRun()) return null;
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const chatRes = await fetchWithTimeout(
      `${whatsappApiBase()}/chats?phone=${encodeURIComponent(opts.phone)}`,
      { headers: auth },
      8000,
    );
    if (!chatRes.ok) return null;
    const chats = (await chatRes.json().catch(() => ({}))) as {
      data?: { chats?: { id?: string | number; chat_id?: string | number }[] };
    };
    const chat = chats.data?.chats?.[0];
    const chatId = chat?.chat_id ?? chat?.id;
    // No chat at all means nothing was ever delivered to this number, which is an answer.
    if (chatId === undefined || chatId === null) return { found: false };

    // from_me, so an inbound message that happens to quote us back cannot be mistaken for ours.
    const historyRes = await fetchWithTimeout(
      `${whatsappApiBase()}/chats/${encodeURIComponent(String(chatId))}/messages` +
        `?from_me=true&after=${encodeURIComponent(opts.since)}`,
      { headers: auth },
      8000,
    );
    if (!historyRes.ok) return null;
    const history = (await historyRes.json().catch(() => ({}))) as {
      data?: { messages?: { uid?: string; text?: string | null }[] };
    };
    // One page is enough: the window starts at the moment we dispatched, so anything we sent is
    // among the first few. Paging further would be looking for a message we did not send.
    const hit = (history.data?.messages ?? []).find((m) => (m.text ?? "") === opts.text);
    return hit ? { found: true, uid: hit.uid } : { found: false };
  } catch {
    return null;
  }
}
