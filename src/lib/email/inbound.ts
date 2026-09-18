import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Domain that receives replies, e.g. "reply.stayful.co.uk" (MX records point at Resend). */
export function replyDomain(): string | null {
  return process.env.EMAIL_REPLY_DOMAIN || null;
}

export function replyAddress(token: string): string | null {
  const domain = replyDomain();
  return domain ? `reply+${token}@${domain}` : null;
}

/**
 * How long a reply token stays valid **from the moment it was issued**.
 *
 * Not from last use, which is what it used to be and which amounted to "for ever" for any
 * conversation still in use: every notification sent and every reply received pushed it out
 * another 30 days.
 *
 * The token is the whole of the authentication. It sits in the Reply-To of a notification, and
 * the inbound webhook carries no SPF, DKIM or DMARC result, so the From line beside it is an
 * unauthenticated header and proves nothing. A credential printed in an email that anyone may
 * forward has to perish on its own schedule. Mirrors the default on
 * email_reply_threads.expires_at (0036) — change one, change both.
 */
export const REPLY_TOKEN_TTL_MS = 7 * 24 * 60 * 60_000;

/** 20-char URL-safe token. One per notification email since 0036, not one per pair. */
export function newReplyToken(): string {
  return randomBytes(15)
    .toString("base64url")
    .replace(/[-_]/g, (c) => (c === "-" ? "a" : "b"))
    .slice(0, 20);
}

/**
 * Pulls the token out of a recipient address of the form reply+TOKEN@<our reply domain>.
 *
 * The domain is checked now. It used to match `reply+TOKEN@` on *any* domain, so a token in a Cc
 * to `reply+…@anywhere.example` counted — and the recipient list is attacker-influenced, since
 * anyone can address a mail to whatever they like. Requiring our own domain costs nothing and
 * removes a way of smuggling a token in past the address that was actually delivered to.
 *
 * Returns null when no reply domain is configured: reply-by-email is off, so nothing can match.
 */
export function tokenFromRecipients(recipients: string[], domain: string | null = replyDomain()): string | null {
  if (!domain) return null;
  const pattern = new RegExp(`^reply\\+([A-Za-z0-9]{8,64})@${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  for (const raw of recipients) {
    const addr = raw.match(/<([^>]+)>/)?.[1] ?? raw;
    const m = pattern.exec(addr.trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * Verifies a Svix-signed webhook (what Resend uses). Secret is the "whsec_..." value
 * from the Resend webhook settings. Rejects signatures older than five minutes.
 */
export function verifySvixSignature(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${rawBody}`).digest("base64");
  const expectedBuf = Buffer.from(expected);
  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
  });
}

const QUOTE_MARKERS = [
  /^On .+ wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^From:\s.+$/i,
  /^Sent from my (iPhone|iPad|Samsung|Android|Galaxy|Huawei|mobile)/i,
  /^_{5,}$/,
  /^-{5,}$/,
  /^Le .+ a écrit\s*:$/i,
];

/** Keeps only the customer's new text: drops quoted history, signatures and "On … wrote:" blocks. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith(">")) break;
    if (QUOTE_MARKERS.some((re) => re.test(line.trim()))) break;
    // "On Mon, 15 Sep 2026 at 09:00, Stayful <x@y>" sometimes wraps onto two lines before "wrote:"
    if (/^On .+,$/.test(line.trim()) && /wrote:\s*$/i.test(lines[i + 1] ?? "")) break;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Very small HTML-to-text for clients that send HTML only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
