/**
 * One place for "is this link safe to fetch or store". Both the bookmark features and
 * /api/unfurl need the same rule, and having it twice is how the two drift apart.
 */

/**
 * Parses a user-supplied link, returning null for anything we will not touch: a non-http(s)
 * scheme (javascript:, data:, file:), a loopback or internal hostname, or a bare IP literal.
 * The last three matter because the server fetches these URLs for Open Graph previews, and a
 * URL that resolves inside the network is how you turn that into a port scanner.
 */
export function safeHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (!h) return null;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return null;
  // IP literals (v4 or v6) are never fetched: no poking at private networks from the server.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":")) return null;
  return u;
}

/** "notion.so" — what a bookmark chip shows when it has no title of its own. */
export function hostLabel(u: URL): string {
  return u.hostname.replace(/^www\./i, "");
}
