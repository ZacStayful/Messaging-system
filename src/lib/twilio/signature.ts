import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Is this request really from Twilio?
 *
 * Twilio signs every webhook. The scheme is its own: take the full URL it requested, append each
 * POST parameter as `key` immediately followed by `value` in **alphabetical order by key**, then
 * HMAC-SHA1 the result with the account's auth token and base64 it. That string arrives as
 * `X-Twilio-Signature`.
 *
 * Two details matter and are easy to get wrong:
 *
 *   - The URL must be exactly what Twilio requested, query string and all. Behind a proxy,
 *     `request.url` can be the internal one; this takes the URL as an argument so the caller
 *     decides, and the caller should build it from the public host.
 *   - Sorting is on the key, and the value is concatenated with no separator. `a=1, b=2` gives
 *     `<url>a1b2`, not `<url>a=1&b=2`.
 *
 * The auth token is the signing key — not an API key. An API key signs browser access tokens and
 * cannot verify this, which is why both live in the environment.
 *
 * Pure, so the whole thing is unit-testable without a network: the single highest-value test in
 * the calling feature, because everything downstream trusts whatever this lets through.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const signed = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(signed, "utf8")).digest("base64");
}

/**
 * Constant-time check of the `X-Twilio-Signature` header.
 *
 * Returns false rather than throwing for every failure — a missing header, a wrong token, a
 * tampered parameter — so a caller cannot accidentally tell them apart in a response and hand
 * an attacker an oracle.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
  authToken: string | undefined,
): boolean {
  if (!header || !authToken) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const given = Buffer.from(header);
  if (expected.length !== given.length) {
    // timingSafeEqual throws on a length mismatch. Compare against itself so the work done —
    // and therefore the time taken — does not depend on the length of what was sent.
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(expected, given);
}

/**
 * The URL Twilio signed, rebuilt from the request.
 *
 * Vercel terminates TLS and proxies, so `request.url` is not reliably the address Twilio asked
 * for: the protocol can read `http` and the host can be internal. Twilio signed the public URL,
 * so that is what has to be reconstructed — from the forwarded headers, falling back to the
 * request itself when they are absent (a direct call in a test).
 */
export function publicUrlOf(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (host) {
    url.host = host;
    url.protocol = `${proto}:`;
  }
  return url.toString();
}

/** Twilio posts `application/x-www-form-urlencoded`; the signature is over those pairs. */
export function formParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}
