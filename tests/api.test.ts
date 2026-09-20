import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEY_PREFIX,
  SCOPES,
  bearerFrom,
  generateApiKey,
  hashApiKey,
  hashesMatch,
  isScope,
  publicPrefix,
} from "@/lib/api/keys";
import { NotConfiguredError, mintUserToken } from "@/lib/api/jwt";
import { verifyApiKey } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const req = (headers: Record<string, string>) => new Request("https://example.com/api/v1/me", { headers });

describe("generateApiKey", () => {
  it("is recognisable as a Stayful key and long enough to be unguessable", () => {
    const key = generateApiKey();
    expect(key.plaintext.startsWith(KEY_PREFIX)).toBe(true);
    // 32 random bytes in base64url is 43 characters, plus the prefix.
    expect(key.plaintext.length).toBeGreaterThanOrEqual(KEY_PREFIX.length + 43);
  });

  it("returns the hash of its own plaintext, and no plaintext beyond the prefix", () => {
    const key = generateApiKey();
    expect(key.hash).toBe(hashApiKey(key.plaintext));
    expect(key.prefix).toBe(publicPrefix(key.plaintext));
    expect(key.plaintext.startsWith(key.prefix)).toBe(true);
    expect(key.prefix.length).toBeLessThan(key.plaintext.length);
  });

  it("never repeats across a thousand draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateApiKey().plaintext);
    expect(seen.size).toBe(1000);
  });
});

describe("hashApiKey", () => {
  it("is a stable 64-character hex digest", () => {
    const hash = hashApiKey("sk_live_example");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey("sk_live_example")).toBe(hash);
  });

  it("changes completely for a one-character difference", () => {
    expect(hashApiKey("sk_live_examplf")).not.toBe(hashApiKey("sk_live_example"));
  });

  it("ignores surrounding whitespace, so a pasted key with a stray newline still matches", () => {
    expect(hashApiKey("  sk_live_example\n")).toBe(hashApiKey("sk_live_example"));
  });
});

describe("hashesMatch", () => {
  it("accepts identical digests and rejects different or empty ones", () => {
    const a = hashApiKey("one");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, hashApiKey("two"))).toBe(false);
    expect(hashesMatch("", "")).toBe(false);
    expect(hashesMatch(a, "abcd")).toBe(false);
  });
});

describe("publicPrefix", () => {
  it("never reveals more than the first few characters of the secret", () => {
    const key = generateApiKey();
    expect(publicPrefix(key.plaintext)).toHaveLength(KEY_PREFIX.length + 6);
    // The random part must not be recoverable from what the UI displays.
    expect(key.plaintext.slice(publicPrefix(key.plaintext).length)).not.toBe("");
  });
});

describe("bearerFrom", () => {
  it("reads a bearer token whatever the casing", () => {
    expect(bearerFrom(req({ authorization: "Bearer sk_live_x" }))).toBe("sk_live_x");
    expect(bearerFrom(req({ authorization: "bearer sk_live_x" }))).toBe("sk_live_x");
    expect(bearerFrom(req({ authorization: "  Bearer   sk_live_x  " }))).toBe("sk_live_x");
  });

  it("returns null for anything that is not a bearer token", () => {
    expect(bearerFrom(req({}))).toBeNull();
    expect(bearerFrom(req({ authorization: "Basic abc" }))).toBeNull();
    expect(bearerFrom(req({ authorization: "Bearer" }))).toBeNull();
    expect(bearerFrom(req({ authorization: "Bearer   " }))).toBeNull();
  });
});

describe("scopes", () => {
  it("recognises exactly the closed list, so an unknown scope grants nothing", () => {
    for (const s of SCOPES) expect(isScope(s)).toBe(true);
    for (const s of ["", "messages", "messages:delete", "admin", "*"]) expect(isScope(s)).toBe(false);
  });
});

describe("mintUserToken", () => {
  const SECRET = "test-jwt-secret-not-a-real-one";
  const USER = "b0000000-0000-4000-8000-000000000001";

  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });

  const decode = (segment: string) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

  it("is a three-part HS256 JWS", () => {
    const parts = mintUserToken(USER).split(".");
    expect(parts).toHaveLength(3);
    expect(decode(parts[0])).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("carries the claims PostgREST needs", () => {
    const payload = decode(mintUserToken(USER).split(".")[1]);
    expect(payload.sub).toBe(USER);
    // Without role=authenticated PostgREST treats the request as anonymous and every policy
    // denies, which is the failure mode this assertion exists to catch.
    expect(payload.role).toBe("authenticated");
    expect(payload.aud).toBe("authenticated");
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it("expires soon, so a token caught in a log is worthless by the time it is read", () => {
    const payload = decode(mintUserToken(USER).split(".")[1]);
    expect(payload.exp - payload.iat).toBe(120);
    const custom = decode(mintUserToken(USER, 30).split(".")[1]);
    expect(custom.exp - custom.iat).toBe(30);
  });

  it("verifies against the secret, and not against a different one", () => {
    const token = mintUserToken(USER);
    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
    expect(signature).toBe(expected);
    const wrong = createHmac("sha256", "another-secret").update(`${header}.${payload}`).digest("base64url");
    expect(signature).not.toBe(wrong);
  });

  it("throws NotConfiguredError rather than signing with nothing", () => {
    const saved = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;
    expect(() => mintUserToken(USER)).toThrow(NotConfiguredError);
    process.env.SUPABASE_JWT_SECRET = saved;
  });
});

describe("verifyApiKey — the key and the person it acts as must still agree", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
  const USER = "33333333-3333-4333-8333-333333333333";

  let key: ReturnType<typeof generateApiKey>;
  let keyRow: Record<string, unknown>;
  let profileRow: Record<string, unknown> | null;

  beforeEach(() => {
    key = generateApiKey();
    keyRow = {
      id: "key-1",
      name: "automation",
      org_id: ORG,
      user_id: USER,
      key_hash: key.hash,
      scopes: ["messages:read"],
      expires_at: null,
      revoked_at: null,
    };
    profileRow = { id: USER, org_id: ORG, account_type: "team", deactivated_at: null };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdmin() as never);
  });

  // Just enough of the client for verifyApiKey: two selects, each ending in maybeSingle().
  // The rows are read at call time, so a test can change them after this is built.
  const fakeAdmin = () => ({
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === "api_keys" ? keyRow : profileRow }),
      };
      return chain;
    },
  });

  const call = () =>
    verifyApiKey(
      new Request("https://example.com/api/v1/me", { headers: { authorization: `Bearer ${key.plaintext}` } }),
    );

  it("accepts a key whose person is an active team member of the same organisation", async () => {
    const ctx = await call();
    expect(ctx?.orgId).toBe(ORG);
    expect(ctx?.userId).toBe(USER);
  });

  it("rejects a key whose person has since moved to another organisation", async () => {
    // The insert policy (0016) checks this once, at creation. A key outlives that: without the
    // re-check, the context would pair the key's old org_id with a profile that has left it.
    profileRow = { ...profileRow!, org_id: OTHER_ORG };
    expect(await call()).toBeNull();
  });

  it("rejects a key whose person is no longer a team member", async () => {
    // Minting a key that acts as a customer is blocked at creation for a reason: it would read
    // that customer's direct messages. Being downgraded later must not reopen it.
    profileRow = { ...profileRow!, account_type: "customer" };
    expect(await call()).toBeNull();
  });

  it("still rejects a deactivated person", async () => {
    profileRow = { ...profileRow!, deactivated_at: "2026-01-01T00:00:00.000Z" };
    expect(await call()).toBeNull();
  });

  it("rejects a key whose person has no profile at all", async () => {
    profileRow = null;
    expect(await call()).toBeNull();
  });
});
