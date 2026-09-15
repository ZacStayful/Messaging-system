import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Every key carries this, so a leaked string is recognisable as a Stayful credential. */
export const KEY_PREFIX = "sk_live_";
/** How much of the plaintext the UI may show, enough to tell two keys apart. */
const PREFIX_CHARS = KEY_PREFIX.length + 6;

export interface GeneratedKey {
  /** Shown to the admin exactly once, at creation. Never stored, never logged. */
  plaintext: string;
  hash: string;
  prefix: string;
}

/**
 * A new API key. 32 random bytes is 256 bits of entropy, which is what makes the fast hash
 * below the right choice rather than a lazy one.
 */
export function generateApiKey(): GeneratedKey {
  const plaintext = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { plaintext, hash: hashApiKey(plaintext), prefix: publicPrefix(plaintext) };
}

/**
 * sha256, deliberately. A slow hash (bcrypt, scrypt) protects low-entropy human passwords
 * from offline dictionary attacks; an API key has no dictionary, so slowing this down would
 * only tax every single request for no security gain.
 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim(), "utf8").digest("hex");
}

/** The displayable head of a key, e.g. "sk_live_a1b2c3". */
export function publicPrefix(plaintext: string): string {
  return plaintext.trim().slice(0, PREFIX_CHARS);
}

/** Constant-time compare for two hex digests of the same length. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/** The bearer token from an Authorization header, or null. Tolerates any header casing. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Every scope the API understands. Closed on purpose: an unknown scope in the database should
 * never silently grant anything, and the key-creation UI offers exactly this list.
 */
export const SCOPES = [
  "conversations:read",
  "conversations:write",
  "messages:read",
  "messages:write",
  "members:write",
  "bookmarks:read",
  "bookmarks:write",
  "users:read",
  "users:invite",
  "status:write",
] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** Human labels for the settings screen. */
export const SCOPE_LABELS: Record<Scope, string> = {
  "conversations:read": "Read groups and direct messages",
  "conversations:write": "Create and rename groups",
  "messages:read": "Read messages",
  "messages:write": "Send messages",
  "members:write": "Add and remove members",
  "bookmarks:read": "Read bookmarks",
  "bookmarks:write": "Add and remove bookmarks",
  "users:read": "Read the people directory",
  "users:invite": "Create accounts and invite people",
  "status:write": "Set status, away and do-not-disturb",
};
