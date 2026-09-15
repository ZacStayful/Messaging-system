import { createHmac } from "node:crypto";

/**
 * Thrown when SUPABASE_JWT_SECRET is missing. The API and MCP server answer 503 rather than
 * 401 for this, because "the server is not set up" and "your key is wrong" should not look
 * the same to whoever is holding the key.
 */
export class NotConfiguredError extends Error {
  constructor(message = "SUPABASE_JWT_SECRET is not set") {
    super(message);
    this.name = "NotConfiguredError";
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * A short-lived Supabase access token for one user, signed with the project's JWT secret.
 *
 * This is what lets an API request run as a real person: with it, every RLS policy and every
 * `auth.uid()`-based RPC in this schema behaves exactly as it does for a signed-in browser, so
 * there is no second implementation of the authorisation rules to drift out of step. The
 * alternative — a service-role client plus checks rewritten in TypeScript — would have meant
 * reimplementing ~25 SQL functions, since auth.uid() is load-bearing in all of them.
 *
 * `role: "authenticated"` is the claim that matters and the one easily forgotten: without it
 * PostgREST treats the request as anonymous and every policy denies.
 *
 * Minted per request. HMAC-SHA256 costs microseconds, so there is nothing to cache and no
 * token sitting around to leak. Two minutes is long enough for any single request and short
 * enough that a token captured in a log is worthless by the time anyone reads it.
 */
export function mintUserToken(userId: string, ttlSeconds = 120): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new NotConfiguredError();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: userId,
    role: "authenticated",
    aud: "authenticated",
    iss: "supabase",
    iat: now,
    exp: now + ttlSeconds,
    is_anonymous: false,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

export function jwtConfigured(): boolean {
  return !!process.env.SUPABASE_JWT_SECRET;
}
