import { fetchWithTimeout } from "@/lib/net/withTimeout";
/** Thin Resend client (https://resend.com/docs/api-reference/emails/send-email). Server-only. */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /**
   * Makes a retry safe. Resend keeps a key for 24 hours and returns the original response rather
   * than sending again, which is the only way the worker can recover from dying between the send
   * and the record without the recipient getting the email twice. Up to 256 characters.
   */
  idempotencyKey?: string;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
  /** Resend recognised the idempotency key: this email was already sent. Not a failure. */
  duplicate?: boolean;
  /** The same key is in flight elsewhere. Neither sent nor failed — leave the row for a retry. */
  inFlight?: boolean;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM || "Stayful <noreply@stayful.co.uk>";
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, error: "RESEND_API_KEY is not set" };
  try {
    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
        headers: message.headers,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.status === 409) {
      // Two different 409s, and they mean opposite things.
      //
      // invalid_idempotent_request: this key was used before with a different payload. For the
      // worker that means the email went out on an earlier attempt and something in it has since
      // changed — most often the Reply-To, because a reply token is minted fresh per notification
      // (0036). The recipient has the first one, which carries a working token, so this is done.
      //
      // concurrent_idempotent_requests: another request with this key is still running, so Resend
      // cannot replay its response yet. Neither sent nor failed: leave the row alone and let the
      // next run settle it.
      if (body.name === "concurrent_idempotent_requests") {
        return { ok: false, inFlight: true, error: "a send with this key is already in progress" };
      }
      return { ok: true, duplicate: true, id: body.id };
    }
    if (!res.ok) return { ok: false, error: body.message || body.name || `Resend responded ${res.status}` };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
