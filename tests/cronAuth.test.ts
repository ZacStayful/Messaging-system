import { afterEach, describe, expect, it } from "vitest";
import { authorised } from "@/lib/cron/auth";

/**
 * The bearer check used to be `===`, which gives up at the first wrong character and so leaks
 * how much of the secret a caller has right through timing. It now goes through the same
 * constant-time compare as the webhook tokens; these pin the answers, above all the fail-closed
 * one, so the swap cannot quietly have changed them.
 */

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

const request = (authorization?: string) =>
  new Request("https://chat.stayful.co.uk/api/cron/slack", {
    headers: authorization === undefined ? {} : { authorization },
  });

describe("authorised", () => {
  it("fails closed when no CRON_SECRET is configured", () => {
    delete process.env.CRON_SECRET;
    expect(authorised(request("Bearer anything"))).toBe(false);
    expect(authorised(request("Bearer "))).toBe(false);
    expect(authorised(request())).toBe(false);
    process.env.CRON_SECRET = "";
    expect(authorised(request("Bearer "))).toBe(false);
  });

  it("refuses the wrong secret, whatever its length", () => {
    process.env.CRON_SECRET = "correct-horse";
    expect(authorised(request("Bearer wrong-horse!!"))).toBe(false); // the same length
    expect(authorised(request("Bearer correct-hors"))).toBe(false); // a prefix
    expect(authorised(request("Bearer correct-horse-battery"))).toBe(false);
    expect(authorised(request("Bearer "))).toBe(false);
  });

  it("accepts the right secret as a bearer token", () => {
    process.env.CRON_SECRET = "correct-horse";
    expect(authorised(request("Bearer correct-horse"))).toBe(true);
  });

  it("refuses a request with no Authorization header, or the secret without the scheme", () => {
    process.env.CRON_SECRET = "correct-horse";
    expect(authorised(request())).toBe(false);
    expect(authorised(request("correct-horse"))).toBe(false);
  });
});
