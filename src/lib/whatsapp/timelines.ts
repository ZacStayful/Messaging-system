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
    const res = await fetch(`${whatsappApiBase()}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: message.to,
        text: message.text,
        whatsapp_account_id: process.env.TIMELINES_WHATSAPP_ACCOUNT_ID || undefined,
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
