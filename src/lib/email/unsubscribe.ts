import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.EMAIL_LINK_SECRET || process.env.CRON_SECRET || null;
}

/** Signed one-click unsubscribe link; valid as long as the secret is unchanged. */
export function unsubscribeUrl(siteUrl: string, userId: string): string {
  const s = secret();
  const token = s ? createHmac("sha256", s).update(`unsubscribe:${userId}`).digest("base64url") : "";
  return `${siteUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const s = secret();
  if (!s || !token) return false;
  const expected = Buffer.from(createHmac("sha256", s).update(`unsubscribe:${userId}`).digest("base64url"));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
