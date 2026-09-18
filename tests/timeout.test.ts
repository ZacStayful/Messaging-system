import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, RequestTimeoutError } from "@/lib/net/withTimeout";

/**
 * The first timeout in this codebase. Every outbound call to Resend and TimelinesAI was a bare
 * fetch, and undici applies no overall response deadline — so a provider that accepts the
 * connection and then stalls held the await until the platform killed the function, leaving up
 * to two hundred claimed notifications stranded for ten minutes.
 */
describe("fetchWithTimeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the response when one arrives in time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    const res = await fetchWithTimeout("https://example.test/", {}, 1000);
    expect(res.status).toBe(200);
  });

  it("gives up on a server that accepts the connection and then says nothing", async () => {
    // The real failure mode: not a refused connection, which fails fast on its own, but one that
    // is accepted and then held open.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init: RequestInit = {}) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
          }),
      ),
    );
    await expect(fetchWithTimeout("https://example.test/", {}, 20)).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("bounds how long it waits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init: RequestInit = {}) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
          }),
      ),
    );
    const started = Date.now();
    await fetchWithTimeout("https://example.test/", {}, 30).catch(() => {});
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("passes a real network error through rather than calling it a timeout", async () => {
    // A DNS failure and a hung server are different problems and should read differently in a log.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(fetchWithTimeout("https://example.test/", {}, 1000)).rejects.toBeInstanceOf(TypeError);
  });
});
