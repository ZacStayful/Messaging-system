import { publicUrlOf, formParams, verifyTwilioSignature } from "@/lib/twilio/signature";
import { verifyWebhookToken } from "@/lib/whatsapp/inbound";

/**
 * The two checks every Twilio webhook makes, in one place.
 *
 * Both, always. The secret path segment alone is not enough — a URL travels through proxy logs,
 * browser history and the Twilio console itself, and once it leaks anyone can post a
 * "call completed" for a call that never happened. The signature alone is not enough either,
 * because it only proves the request came from *a* Twilio account, and an unsigned request
 * should never get as far as reading a body.
 *
 * Note the deliberate departure from the WhatsApp webhook's "set means required" rule for its
 * header secret: there the second factor is optional because TimelinesAI's dashboard may not be
 * able to send custom headers. Twilio always signs, so an absent TWILIO_AUTH_TOKEN is a
 * misconfiguration to fail on, not a check to skip.
 */
export type WebhookRead =
  { ok: true; params: Record<string, string>; url: string } | { ok: false; status: 401 | 503; error: string };

export async function readSignedWebhook(request: Request, pathToken: string): Promise<WebhookRead> {
  const expected = process.env.TWILIO_WEBHOOK_TOKEN;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!expected) return { ok: false, status: 503, error: "TWILIO_WEBHOOK_TOKEN is not set" };
  if (!authToken) return { ok: false, status: 503, error: "TWILIO_AUTH_TOKEN is not set" };

  if (!verifyWebhookToken(pathToken, expected)) return { ok: false, status: 401, error: "unauthorised" };

  const url = publicUrlOf(request);
  const params = formParams(await request.text());
  if (!verifyTwilioSignature(url, params, request.headers.get("x-twilio-signature"), authToken)) {
    // One message for a wrong token, a tampered parameter and a missing header alike: telling
    // them apart is the whole of what an attacker wants from this endpoint.
    return { ok: false, status: 401, error: "unauthorised" };
  }
  return { ok: true, params, url };
}

/**
 * Where to tell Twilio to post next, derived from the request it just made.
 *
 * Not siteUrl(): Twilio signs the URL it was given, and we verify against the host the request
 * actually arrived on. Deriving callbacks from the incoming request keeps those two the same
 * string by construction, so a preview deployment or a changed domain cannot produce callbacks
 * that are signed for one host and verified against another.
 */
export function callbackOrigin(url: string): string {
  return new URL(url).origin;
}
