import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Domain that receives replies, e.g. "reply.stayful.co.uk" (MX records point at Resend). */
export function replyDomain(): string | null {
  return process.env.EMAIL_REPLY_DOMAIN || null;
}

export function replyAddress(token: string): string | null {
  const domain = replyDomain();
  return domain ? `reply+${token}@${domain}` : null;
}

/** 20-char URL-safe token for a customer + conversation pair. */
export function newReplyToken(): string {
  return randomBytes(15)
    .toString("base64url")
    .replace(/[-_]/g, (c) => (c === "-" ? "a" : "b"))
    .slice(0, 20);
}

/** Pulls the token out of any recipient address of the form reply+TOKEN@domain. */
export function tokenFromRecipients(recipients: string[]): string | null {
  for (const raw of recipients) {
    const addr = raw.match(/<([^>]+)>/)?.[1] ?? raw;
    const m = /^reply\+([A-Za-z0-9]{8,64})@/i.exec(addr.trim());
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
