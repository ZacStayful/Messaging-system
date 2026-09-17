import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { formParams, publicUrlOf, twilioSignature, verifyTwilioSignature } from "@/lib/twilio/signature";
import { dialTwiML, esc, sayAndHangupTwiML, voicemailTwiML, RECORDING_NOTICE } from "@/lib/twilio/twiml";
import { buildCallSummary, formatDuration, voicemailBody } from "@/lib/twilio/summary";

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
