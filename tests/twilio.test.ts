import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { formParams, publicUrlOf, twilioSignature, verifyTwilioSignature } from "@/lib/twilio/signature";
import { dialTwiML, esc, sayAndHangupTwiML, voicemailTwiML, RECORDING_NOTICE } from "@/lib/twilio/twiml";
import { buildCallSummary, formatDuration, voicemailBody } from "@/lib/twilio/summary";
import { accessTokenInputFromEnv, TwilioNotConfiguredError, voiceAccessToken } from "@/lib/twilio/accessToken";
import { callbackOrigin, readSignedWebhook } from "@/lib/twilio/webhook";

const TOKEN = "12345678901234567890123456789012";

describe("twilioSignature", () => {
  // Twilio's own published worked example, from docs/usage/security, with the expected
  // signature exactly as documented. Pinned against *their* value rather than a re-derivation
  // of our own: if this test only re-implemented the algorithm beside the implementation, both
  // could be wrong together and every webhook would be either wide open or permanently broken.
  it("matches Twilio's published test vector", () => {
    const docUrl = "https://example.com/myapp.php?foo=1&bar=2";
    const docParams = {
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    };
    expect(twilioSignature(docUrl, docParams, "12345")).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
  });

  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { Caller: "+14158675309", Digits: "1234", To: "+18005551212", From: "+14158675310" };

  it("concatenates sorted key+value onto the URL and HMAC-SHA1s it", () => {
    const expected = createHmac("sha1", TOKEN)
      .update(Buffer.from(`${url}Caller+14158675309Digits1234From+14158675310To+18005551212`, "utf8"))
      .digest("base64");
    expect(twilioSignature(url, params, TOKEN)).toBe(expected);
  });

  it("sorts by key, so parameter order on the wire does not matter", () => {
    const shuffled = { To: params.To, Caller: params.Caller, From: params.From, Digits: params.Digits };
    expect(twilioSignature(url, shuffled, TOKEN)).toBe(twilioSignature(url, params, TOKEN));
  });

  it("includes the query string: a signature is over the whole URL", () => {
    expect(twilioSignature("https://mycompany.com/myapp.php", params, TOKEN)).not.toBe(
      twilioSignature(url, params, TOKEN),
    );
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://chat.stayful.co.uk/api/twilio/voice/tok";
  const params = { CallSid: "CA123", From: "+447700900001" };
  const good = twilioSignature(url, params, TOKEN);

  it("accepts a genuine signature", () => {
    expect(verifyTwilioSignature(url, params, good, TOKEN)).toBe(true);
  });

  it("rejects a tampered parameter", () => {
    expect(verifyTwilioSignature(url, { ...params, From: "+447700900999" }, good, TOKEN)).toBe(false);
  });

  it("rejects an added parameter", () => {
    expect(verifyTwilioSignature(url, { ...params, Extra: "x" }, good, TOKEN)).toBe(false);
  });

  it("rejects a different URL", () => {
    expect(verifyTwilioSignature(`${url}x`, params, good, TOKEN)).toBe(false);
  });

  it("rejects the wrong auth token", () => {
    expect(verifyTwilioSignature(url, params, good, "9".repeat(32))).toBe(false);
  });

  // Fails closed on every shape of "we cannot check this", rather than treating an absent
  // header or an unset token as permission.
  it("rejects a missing header or a missing token", () => {
    expect(verifyTwilioSignature(url, params, null, TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, "", TOKEN)).toBe(false);
    expect(verifyTwilioSignature(url, params, good, undefined)).toBe(false);
    expect(verifyTwilioSignature(url, params, good, "")).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(() => verifyTwilioSignature(url, params, "short", TOKEN)).not.toThrow();
    expect(verifyTwilioSignature(url, params, "short", TOKEN)).toBe(false);
  });
});

describe("publicUrlOf", () => {
  // Vercel terminates TLS and proxies, so request.url is not what Twilio signed.
  it("rebuilds the public URL from forwarded headers", () => {
    const req = new Request("http://10.0.0.5/api/twilio/voice/tok", {
      headers: { "x-forwarded-host": "chat.stayful.co.uk", "x-forwarded-proto": "https" },
    });
    expect(publicUrlOf(req)).toBe("https://chat.stayful.co.uk/api/twilio/voice/tok");
  });

  it("keeps the query string, which is part of what was signed", () => {
    const req = new Request("http://10.0.0.5/api/twilio/status/tok?call=abc", {
      headers: { "x-forwarded-host": "chat.stayful.co.uk", "x-forwarded-proto": "https" },
    });
    expect(publicUrlOf(req)).toBe("https://chat.stayful.co.uk/api/twilio/status/tok?call=abc");
  });

  it("falls back to the request itself when nothing is forwarded", () => {
    expect(publicUrlOf(new Request("https://example.test/x"))).toBe("https://example.test/x");
  });
});

describe("formParams", () => {
  it("decodes what Twilio posts", () => {
    expect(formParams("CallSid=CA1&From=%2B447700900001&CallStatus=completed")).toEqual({
      CallSid: "CA1",
      From: "+447700900001",
      CallStatus: "completed",
    });
  });
});

describe("TwiML", () => {
  it("says the recording notice before dialling", () => {
    const xml = dialTwiML({ to: "+447700900001", callerId: "+447700900999", record: true });
    expect(xml.indexOf(RECORDING_NOTICE)).toBeLessThan(xml.indexOf("<Dial"));
    expect(xml).toContain('record="record-from-answer-dual"');
  });

  it("omits the record attribute when not recording", () => {
    expect(dialTwiML({ to: "+447700900001", callerId: "+447700900999" })).not.toContain("record=");
  });

  it("escapes anything that could end the document early", () => {
    expect(esc(`Bell & Sons <"'>`)).toBe("Bell &amp; Sons &lt;&quot;&apos;&gt;");
    const xml = dialTwiML({
      to: "+447700900001",
      callerId: "+447700900999",
      statusCallback: "https://x.test/cb?a=1&b=2",
    });
    expect(xml).toContain("a=1&amp;b=2");
    expect(xml).not.toContain("a=1&b=2");
  });

  it("carries the caller ID, which Ofcom requires be one of ours", () => {
    expect(dialTwiML({ to: "+447700900001", callerId: "+447700900999" })).toContain('callerId="+447700900999"');
  });

  it("builds a voicemail that greets, records and hangs up", () => {
    const xml = voicemailTwiML({ greeting: "You've reached Stayful.", recordingStatusCallback: "https://x.test/vm" });
    expect(xml).toContain("You&apos;ve reached Stayful.");
    expect(xml).toContain("<Record");
    expect(xml).toContain("<Hangup />");
  });

  it("produces well-formed XML with a single Response root", () => {
    for (const xml of [
      dialTwiML({ to: "+447700900001", callerId: "+447700900999", record: true }),
      voicemailTwiML({ greeting: "Hi", recordingStatusCallback: "https://x.test/vm" }),
      sayAndHangupTwiML("Sorry, something went wrong."),
    ]) {
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml.match(/<Response>/g)).toHaveLength(1);
      expect(xml.endsWith("</Response>")).toBe(true);
    }
  });
});

describe("formatDuration", () => {
  it("reads the way a person would say it", () => {
    expect(formatDuration(38)).toBe("38s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(252)).toBe("4m 12s");
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("buildCallSummary", () => {
  const base = { id: "c1", direction: "outbound" as const, contactName: "Marta" };

  it("records a call that happened", () => {
    const s = buildCallSummary({ ...base, status: "completed", durationSeconds: 252, recorded: true });
    expect(s.body).toBe("Called Marta · 4m 12s");
    expect(s.meta).toMatchObject({ call_id: "c1", status: "completed", duration_seconds: 252, recorded: true });
  });

  // The cases that matter most: without a line, the thread implies nobody reached out.
  it("distinguishes the ways a call does not happen", () => {
    expect(buildCallSummary({ ...base, status: "no-answer" }).body).toBe("Called Marta · no answer");
    expect(buildCallSummary({ ...base, status: "busy" }).body).toBe("Called Marta · line busy");
    expect(buildCallSummary({ ...base, status: "canceled" }).body).toBe("Call to Marta · cancelled");
    expect(buildCallSummary({ ...base, status: "failed" }).body).toBe(
      "Call to Marta failed · the number could not be reached",
    );
  });

  it("treats completed-with-no-duration as not answered", () => {
    expect(buildCallSummary({ ...base, status: "completed", durationSeconds: 0 }).body).toBe(
      "Called Marta · not answered",
    );
  });

  it("reads the other way round for an inbound call", () => {
    expect(buildCallSummary({ ...base, direction: "inbound", status: "completed", durationSeconds: 90 }).body).toBe(
      "Marta called · 1m 30s",
    );
  });

  it("does not invent wording for a status it has not seen", () => {
    expect(buildCallSummary({ ...base, status: "something-new" }).body).toBe("Call to Marta · something-new");
  });
});

describe("voicemailBody", () => {
  it("names the caller and the length", () => {
    expect(voicemailBody("Marta", 42)).toBe("Voicemail from Marta · 42s");
    expect(voicemailBody("Marta", null)).toBe("Voicemail from Marta");
  });
});

describe("voiceAccessToken", () => {
  const input = {
    accountSid: "AC00000000000000000000000000000000",
    apiKeySid: "SK11111111111111111111111111111111",
    apiKeySecret: "shhh-api-key-secret",
    twimlAppSid: "AP22222222222222222222222222222222",
    identity: "9f1c0a4e-0000-4000-8000-000000000001",
  };

  const decode = (segment: string) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  const parts = (token: string) => {
    const [h, p, s] = token.split(".");
    return { header: decode(h), payload: decode(p), signature: s, signingInput: `${h}.${p}` };
  };

  // The one the Voice SDK silently rejects a token for. An access token is a JWT with a content
  // type the ordinary JWT libraries do not set, and the failure mode is an unhelpful client-side
  // error rather than anything the server sees — so it is asserted here or nowhere.
  it("declares the twilio-fpa content type in the header", () => {
    expect(parts(voiceAccessToken(input)).header).toEqual({ typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
  });

  // iss and sub are the two most natural things to get backwards, and swapping them produces a
  // token that looks entirely reasonable and is refused at the edge.
  it("issues from the API key and subjects the account", () => {
    const { payload } = parts(voiceAccessToken(input));
    expect(payload.iss).toBe(input.apiKeySid);
    expect(payload.sub).toBe(input.accountSid);
  });

  it("carries the identity and the TwiML app in the voice grant", () => {
    const { payload } = parts(voiceAccessToken(input));
    expect(payload.grants.identity).toBe(input.identity);
    expect(payload.grants.voice.outgoing.application_sid).toBe(input.twimlAppSid);
  });

  // No incoming grant: a cleaner ringing the Stayful number back must reach the voicemail TwiML,
  // not whichever team member happens to have a browser tab open.
  it("grants outgoing only", () => {
    expect(parts(voiceAccessToken(input)).payload.grants.voice.incoming).toBeUndefined();
  });

  it("signs with the API key secret, not the auth token", () => {
    const { signingInput, signature } = parts(voiceAccessToken(input));
    const expected = createHmac("sha256", input.apiKeySecret).update(signingInput).digest("base64url");
    expect(signature).toBe(expected);
    expect(signature).not.toBe(createHmac("sha256", TOKEN).update(signingInput).digest("base64url"));
  });

  it("expires, and by default within the hour", () => {
    const now = Math.floor(Date.now() / 1000);
    const { payload } = parts(voiceAccessToken(input));
    expect(payload.exp - payload.nbf).toBe(3600);
    expect(payload.nbf).toBeGreaterThanOrEqual(now - 2);

    const short = parts(voiceAccessToken({ ...input, ttlSeconds: 60 })).payload;
    expect(short.exp - short.nbf).toBe(60);
  });

  it("produces base64url, with no padding to be mangled in transit", () => {
    expect(voiceAccessToken(input)).not.toMatch(/[+/=]/);
  });
});

describe("accessTokenInputFromEnv", () => {
  const KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_TWIML_APP_SID"] as const;

  const withEnv = <T>(values: Partial<Record<(typeof KEYS)[number], string>>, fn: () => T): T => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const k of KEYS) {
        if (values[k] === undefined) delete process.env[k];
        else process.env[k] = values[k];
      }
      return fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  };

  const full = {
    TWILIO_ACCOUNT_SID: "AC0",
    TWILIO_API_KEY_SID: "SK0",
    TWILIO_API_KEY_SECRET: "secret",
    TWILIO_TWIML_APP_SID: "AP0",
  };

  it("reads all four and attaches the identity", () => {
    expect(withEnv(full, () => accessTokenInputFromEnv("me"))).toEqual({
      accountSid: "AC0",
      apiKeySid: "SK0",
      apiKeySecret: "secret",
      twimlAppSid: "AP0",
      identity: "me",
    });
  });

  // An operator staring at a 503 needs the variable's name. Its value must never appear — this
  // error is logged, and one of these four is a secret.
  it("names the missing variables and nothing else", () => {
    const missing = withEnv({ ...full, TWILIO_API_KEY_SECRET: undefined }, () => {
      try {
        accessTokenInputFromEnv("me");
        return null;
      } catch (e) {
        return e as Error;
      }
    });
    expect(missing).toBeInstanceOf(TwilioNotConfiguredError);
    expect(missing!.message).toContain("TWILIO_API_KEY_SECRET");
    expect(missing!.message).not.toContain("AC0");
    expect(missing!.message).not.toContain("secret");
  });
});

describe("readSignedWebhook", () => {
  const PATH_TOKEN = "path-token-that-is-long-and-random";
  const URL_ = "https://chat.stayful.co.uk/api/twilio/status/" + PATH_TOKEN;
  const BODY = "CallSid=CA1&CallStatus=completed&CallDuration=42";

  const signedRequest = (over: { body?: string; signature?: string; url?: string } = {}) => {
    const url = over.url ?? URL_;
    const body = over.body ?? BODY;
    const signature = over.signature ?? twilioSignature(url, formParams(body), TOKEN);
    return new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
      body,
    });
  };

  const withTwilioEnv = async <T>(values: { token?: string; auth?: string }, fn: () => Promise<T>): Promise<T> => {
    const saved = [process.env.TWILIO_WEBHOOK_TOKEN, process.env.TWILIO_AUTH_TOKEN];
    try {
      if (values.token === undefined) delete process.env.TWILIO_WEBHOOK_TOKEN;
      else process.env.TWILIO_WEBHOOK_TOKEN = values.token;
      if (values.auth === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = values.auth;
      return await fn();
    } finally {
      for (const [i, name] of (["TWILIO_WEBHOOK_TOKEN", "TWILIO_AUTH_TOKEN"] as const).entries()) {
        if (saved[i] === undefined) delete process.env[name];
        else process.env[name] = saved[i]!;
      }
    }
  };

  const configured = { token: PATH_TOKEN, auth: TOKEN };

  it("accepts a request with the right path token and a valid signature", async () => {
    const read = await withTwilioEnv(configured, () => readSignedWebhook(signedRequest(), PATH_TOKEN));
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.params).toEqual({ CallSid: "CA1", CallStatus: "completed", CallDuration: "42" });
  });

  it("refuses a valid signature behind the wrong path token", async () => {
    // Both factors, always. A signature proves the request came from a Twilio account; the path
    // token proves it came from *ours*.
    const read = await withTwilioEnv(configured, () => readSignedWebhook(signedRequest(), "not-the-token"));
    expect(read).toEqual({ ok: false, status: 401, error: "unauthorised" });
  });

  it("refuses the right path token with no signature", async () => {
    const request = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: BODY,
    });
    const read = await withTwilioEnv(configured, () => readSignedWebhook(request, PATH_TOKEN));
    expect(read).toEqual({ ok: false, status: 401, error: "unauthorised" });
  });

  it("refuses a body that was altered after signing", async () => {
    // The whole point: a status callback whose CallStatus someone edited in flight would mark a
    // call completed that is still ringing, and write a summary for it.
    const signature = twilioSignature(URL_, formParams(BODY), TOKEN);
    const tampered = signedRequest({ body: "CallSid=CA1&CallStatus=failed&CallDuration=42", signature });
    const read = await withTwilioEnv(configured, () => readSignedWebhook(tampered, PATH_TOKEN));
    expect(read.ok).toBe(false);
  });

  it("refuses a signature made for a different URL", async () => {
    const signature = twilioSignature(
      "https://chat.stayful.co.uk/api/twilio/recording/" + PATH_TOKEN,
      formParams(BODY),
      TOKEN,
    );
    const read = await withTwilioEnv(configured, () => readSignedWebhook(signedRequest({ signature }), PATH_TOKEN));
    expect(read.ok).toBe(false);
  });

  // Not "set means required", the rule the WhatsApp webhook's optional header secret follows.
  // Twilio always signs, so a missing auth token is a deployment that cannot verify anything —
  // failing open here would leave every webhook in the feature unauthenticated.
  it("fails closed, and says which variable is missing, when it cannot verify", async () => {
    expect(await withTwilioEnv({ token: PATH_TOKEN }, () => readSignedWebhook(signedRequest(), PATH_TOKEN))).toEqual({
      ok: false,
      status: 503,
      error: "TWILIO_AUTH_TOKEN is not set",
    });
    expect(await withTwilioEnv({ auth: TOKEN }, () => readSignedWebhook(signedRequest(), PATH_TOKEN))).toEqual({
      ok: false,
      status: 503,
      error: "TWILIO_WEBHOOK_TOKEN is not set",
    });
  });

  it("verifies against the forwarded host, which is what Twilio signed", async () => {
    // Vercel terminates TLS and rewrites the host, so the request object says one thing and
    // Twilio signed another. Getting this wrong rejects every real webhook in production while
    // passing every test that uses a direct URL.
    const signature = twilioSignature(URL_, formParams(BODY), TOKEN);
    const proxied = new Request("http://10.0.0.7/api/twilio/status/" + PATH_TOKEN, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
        "x-forwarded-host": "chat.stayful.co.uk",
        "x-forwarded-proto": "https",
      },
      body: BODY,
    });
    const read = await withTwilioEnv(configured, () => readSignedWebhook(proxied, PATH_TOKEN));
    expect(read.ok).toBe(true);
  });

  it("hands back the callback origin from the URL it verified", () => {
    expect(callbackOrigin(URL_)).toBe("https://chat.stayful.co.uk");
  });
});
