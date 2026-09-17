import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchPublicUrl, redirectTarget } from "@/lib/net/fetchPublicUrl";

/**
 * The unfurl endpoint fetches a URL a signed-in person typed. Until this guard existed,
 * `safeHttpUrl` was the only check, and it reads the string rather than the address — so a
 * hostname resolving to 169.254.169.254, or a 302 into the private network, both went through.
 */

let victim: Server;
let victimPort = 0;

beforeAll(async () => {
  // Stands in for an internal service: bound to loopback, serves HTML worth stealing.
  victim = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><title>INTERNAL SECRET</title></html>");
  });
  await new Promise<void>((r) => victim.listen(0, "127.0.0.1", r));
  victimPort = (victim.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => victim.close(() => r()));
});

describe("fetchPublicUrl", () => {
  it("will not fetch a loopback address written as an IP", async () => {
    const res = await fetchPublicUrl(`http://127.0.0.1:${victimPort}/`, { maxBytes: 4096 });
    expect(res).toBeNull();
  });

  // The one that matters: the hostname is not an IP literal and ends in no blocked suffix, so
  // the lexical check passes it. Only resolving it reveals where it goes. nip.io answers with
  // whatever address is in the name, by design, so this needs no fixture of our own.
  it("will not fetch a hostname that resolves to a private address", async () => {
    const res = await fetchPublicUrl(`http://127.0.0.1.nip.io:${victimPort}/`, { maxBytes: 4096 });
    expect(res).toBeNull();
  });

  it("rejects a scheme that is not http(s) before opening anything", async () => {
    expect(await fetchPublicUrl("file:///etc/passwd", { maxBytes: 4096 })).toBeNull();
    expect(await fetchPublicUrl("ftp://example.com/x", { maxBytes: 4096 })).toBeNull();
  });
});

/**
 * Following a redirect needs a *public* first hop, which a test cannot bind, so the decision is
 * tested directly instead. The address half of the rule is covered by isPrivateAddress in
 * urls.test.ts and re-applied automatically, because each hop opens a new connection.
 */
describe("redirectTarget", () => {
  const base = new URL("https://example.com/a/b");

  it("follows an ordinary redirect, absolute or relative", () => {
    expect(redirectTarget("https://elsewhere.example/x", base)?.toString()).toBe("https://elsewhere.example/x");
    expect(redirectTarget("/c", base)?.toString()).toBe("https://example.com/c");
    expect(redirectTarget("d", base)?.toString()).toBe("https://example.com/a/d");
  });

  it("refuses a redirect that points inside the network", () => {
    for (const location of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://[::1]/",
      "http://vault.internal/secrets",
      "http://localhost:3000/",
    ]) {
      expect(redirectTarget(location, base), location).toBeNull();
    }
  });

  it("refuses a redirect that changes to a scheme we do not fetch", () => {
    for (const location of ["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)"]) {
      expect(redirectTarget(location, base), location).toBeNull();
    }
  });

  it("refuses a Location that is not a URL at all", () => {
    expect(redirectTarget("", base)).toBeNull();
    expect(redirectTarget("   ", base)).toBeNull();
  });
});
