import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isPrivateAddress, safeHttpUrl } from "@/lib/urls";

/**
 * Fetching a URL a user typed, without becoming their port scanner.
 *
 * `safeHttpUrl` rejects the obvious shapes, but it reads the string the user gave us and a
 * string does not decide where the socket goes. Two things defeat it on its own:
 *
 *   1. **A name that resolves inwards.** `169.254.169.254.nip.io` is not an IP literal and does
 *      not end in `.internal`; it resolves to the cloud metadata address. Anyone can point a
 *      hostname at any address, and wildcard-DNS services mean they need not even own one.
 *   2. **A redirect.** Checking the URL the user supplied says nothing about where a 302 sends
 *      us next, and `fetch(..., { redirect: "follow" })` never asks again.
 *
 * So this does not use `fetch`. Node's http/https take a `lookup`, which runs *in the connect
 * path*: the address is checked at the moment it is used, not once beforehand, which is the
 * only way to close the gap between "we resolved it" and "we connected to it" — otherwise a
 * name whose TTL is zero can answer honestly for the check and privately for the connection.
 * Redirects are followed by hand, and every hop starts again at the top of these rules.
 */

/** Generous enough for a slow site, short enough that a hung host cannot hold a request open. */
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

export class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`${host} resolves to an address we will not connect to`);
    this.name = "BlockedAddressError";
  }
}

/**
 * A `lookup` that resolves normally and then refuses anything private. Node calls this for each
 * connection attempt, so it is the check and the connect in one step.
 */
const guardedLookup: typeof dnsLookup = ((
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
) => {
  const cb = typeof options === "function" ? (options as typeof callback) : callback;
  const opts = typeof options === "function" ? {} : (options as Record<string, unknown>);
  dnsLookup(hostname, { ...opts, all: true } as never, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [];
    // Every answer must be public. Picking the first acceptable one out of a mixed set would
    // let a host volunteer one good address alongside the one it actually wants us to reach.
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return cb(new BlockedAddressError(hostname));
    }
    const first = list[0];
    if ((opts as { all?: boolean }).all) return cb(null, list as never);
    cb(null, first.address as never, first.family);
  });
}) as typeof dnsLookup;

function once(url: URL, headers: Record<string, string>): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      { method: "GET", headers, lookup: guardedLookup, timeout: TIMEOUT_MS },
      (res: IncomingMessage) => resolve(res),
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Where a `Location` header actually points, or null if we will not go there.
 *
 * Separated out because it is the half of the redirect rule that can be tested without a
 * socket: a hop is only followed if the resolved URL passes the same lexical check the original
 * did. The other half — that the *address* behind it is public — is the guarded lookup, which
 * runs again automatically because each hop opens a new connection.
 *
 * Relative locations are normal and resolve against the hop we are on.
 */
export function redirectTarget(location: string, base: URL): URL | null {
  // A blank Location resolves to the URL we are already on, so following it would spend a hop
  // re-fetching the same page. A 3xx without a destination is malformed; treat it as no hop.
  if (!location.trim()) return null;
  try {
    return safeHttpUrl(new URL(location, base).toString());
  } catch {
    return null;
  }
}

export interface PublicResponse {
  /** The URL the body actually came from, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/**
 * GETs a public URL, following redirects by hand and re-checking each hop.
 *
 * Reads at most `maxBytes`, so a hostile host cannot stream forever into memory. Returns null
 * for anything refused: a blocked address, a bad scheme, too many hops, a timeout.
 */
export async function fetchPublicUrl(
  raw: string,
  opts: { maxBytes: number; accept?: string; userAgent?: string },
): Promise<PublicResponse | null> {
  let target = safeHttpUrl(raw);
  if (!target) return null;

  const headers: Record<string, string> = {
    accept: opts.accept ?? "*/*",
    "user-agent": opts.userAgent ?? "StayfulBot/1.0",
    "accept-encoding": "identity",
  };

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: IncomingMessage;
    try {
      res = await once(target, headers);
    } catch {
      // A blocked address, a refused connection and a timeout are all the same answer here:
      // we are not fetching this. Telling them apart is what turns this into a port scanner.
      return null;
    }

    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.resume(); // drain, so the socket can be reused or closed cleanly
      if (hop === MAX_REDIRECTS) return null;
      // Start again on the new hop: redirectTarget re-applies the lexical rule, and opening the
      // next connection re-applies the address rule through guardedLookup.
      const next = redirectTarget(location, target);
      if (!next) return null;
      target = next;
      continue;
    }

    const contentType = String(res.headers["content-type"] ?? "");
    const chunks: Buffer[] = [];
    let received = 0;
    try {
      for await (const chunk of res) {
        const buf = chunk as Buffer;
        chunks.push(buf);
        received += buf.length;
        if (received >= opts.maxBytes) {
          res.destroy();
          break;
        }
      }
    } catch {
      // Truncated mid-body: keep whatever arrived rather than losing the whole preview.
    }
    return {
      url: target.toString(),
      status,
      contentType,
      body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, opts.maxBytes)),
    };
  }
  return null;
}
