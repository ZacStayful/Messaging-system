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

/**
 * Is this IP one we must never open a connection to?
 *
 * safeHttpUrl above is a *lexical* check, and lexical checks do not survive contact with DNS:
 * `127.0.0.1.nip.io` is not an IP literal, does not end in `.internal`, and resolves to
 * loopback. Anyone can point a hostname they own at any address, and wildcard-DNS services mean
 * they do not even have to own one. So the real rule is about the address we are about to
 * connect to, which is only knowable after resolution — see fetchPublicUrl in lib/net.
 *
 * Kept here, string-in boolean-out, so it can be unit-tested and so both halves of "is this
 * link safe" live in one file. The ranges are IANA's special-purpose registries; the ones that
 * matter most in practice are 169.254.0.0/16 (cloud metadata) and 127/8, 10/8, 172.16/12,
 * 192.168/16 (everything else on the network this server sits in).
 */
export function isPrivateAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (!addr) return true;

  // IPv4-mapped and IPv4-compatible IPv6 ("::ffff:127.0.0.1") are v4 addresses wearing a hat.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (addr.includes(":")) {
    if (addr === "::" || addr === "::1") return true;
    const head = addr.split(":")[0];
    // A hextet is one to four hex digits. parseInt would take "12345" and hand back a number
    // that passes every range test below, so the shape is checked before the value.
    if (head !== "" && !/^[0-9a-f]{1,4}$/.test(head)) return true;
    const group = head === "" ? 0 : parseInt(head, 16);
    if (Number.isNaN(group)) return true;
    if ((group & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
    if ((group & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((group & 0xff00) === 0xff00) return true; // ff00::/8  multicast
    return false;
  }

  const parts = addr.split(".");
  if (parts.length !== 4) return true;
  const o = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (o.some((n) => Number.isNaN(n) || n > 255)) return true;
  const [a, b] = o;

  if (a === 0) return true; // 0.0.0.0/8      this network
  if (a === 10) return true; // 10.0.0.0/8     private
  if (a === 127) return true; // 127.0.0.0/8    loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12  private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  carrier NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15  benchmarking
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + TEST-NET-1
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0) return true; // 203.0.113.0/24  TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, broadcast
  return false;
}
