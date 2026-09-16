import { describe, expect, it } from "vitest";
import { ACCEPT_RE, formatUkMobile, normaliseUkMobile } from "@/lib/phone";

describe("normaliseUkMobile", () => {
  it("accepts every way a person writes their own mobile", () => {
    const same = [
      "07957516879",
      "07957 516879",
      "07957-516879",
      "(07957) 516879",
      "+447957516879",
      "+44 7957 516879",
      "+44 (0)7957 516879",
      "447957516879",
      "00447957516879",
      "0044 7957 516879",
      "7957516879",
      "  07957 516879  ",
      "07957 516879",
    ];
    for (const input of same) {
      expect(normaliseUkMobile(input), input).toEqual({ ok: true, e164: "+447957516879" });
    }
  });

  it("accepts an Isle of Man mobile, which 076 otherwise excludes", () => {
    expect(normaliseUkMobile("07624123456").e164).toBe("+447624123456");
  });

  it("rejects landlines by name, so the person knows what to do", () => {
    for (const input of ["01614960000", "+441614960000", "02079460000", "03001234567"]) {
      const r = normaliseUkMobile(input);
      expect(r.ok, input).toBe(false);
      expect(r.error, input).toMatch(/landline/i);
    }
  });

  it("rejects ranges that look like mobiles but are not", () => {
    // 070 is personal numbering, 076 is paging.
    expect(normaliseUkMobile("07012345678").ok).toBe(false);
    expect(normaliseUkMobile("07612345678").ok).toBe(false);
  });

  it("rejects other countries with a reason of their own", () => {
    const r = normaliseUkMobile("+33612345678");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/UK mobile numbers/i);
  });

  it("rejects wrong lengths", () => {
    expect(normaliseUkMobile("0795751687").error).toMatch(/too short/i);
    expect(normaliseUkMobile("079575168791").error).toMatch(/too long/i);
  });

  it("rejects empty and non-numeric input", () => {
    for (const input of ["", "   ", "not a number", "07957 51687x", "+44 7957 5168 79 ext 2"]) {
      expect(normaliseUkMobile(input).ok, input).toBe(false);
    }
  });

  it("never returns a value the database would refuse", () => {
    // The whole point of ACCEPT_RE being shared with profiles_phone_uk_mobile_ck.
    const inputs = ["07957516879", "+44 7957 516879", "447957516879", "07624123456", "01614960000", "nonsense"];
    for (const input of inputs) {
      const r = normaliseUkMobile(input);
      if (r.ok) expect(ACCEPT_RE.test(r.e164!), input).toBe(true);
      else expect(r.e164, input).toBeUndefined();
    }
  });

  it("always explains itself when it says no", () => {
    for (const input of ["", "01614960000", "+33612345678", "0795751687", "07012345678"]) {
      const r = normaliseUkMobile(input);
      expect(r.ok).toBe(false);
      expect(r.error, input).toBeTruthy();
      expect(r.error!.endsWith("."), input).toBe(true);
    }
  });
});

describe("formatUkMobile", () => {
  it("spaces a stored number for display", () => {
    expect(formatUkMobile("+447957516879")).toBe("+44 7957 516879");
  });

  it("round-trips back through the parser", () => {
    const stored = "+447957516879";
    expect(normaliseUkMobile(formatUkMobile(stored)).e164).toBe(stored);
  });

  it("leaves anything it does not recognise alone rather than mangling it", () => {
    expect(formatUkMobile("+33612345678")).toBe("+33612345678");
    expect(formatUkMobile("")).toBe("");
  });
});
