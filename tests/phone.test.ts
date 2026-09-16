import { describe, expect, it } from "vitest";
import { ACCEPT_RE, formatUkMobile, normaliseUkMobile, shouldAskForPhone } from "@/lib/phone";

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

describe("shouldAskForPhone", () => {
  const customer = {
    account_type: "customer",
    phone: null,
    phone_prompt_skipped_at: null,
    deactivated_at: null,
  };

  it("asks a customer who has no number", () => {
    expect(shouldAskForPhone(customer, true)).toBe(true);
  });

  it("never asks when we cannot send a code", () => {
    // There is nothing to ask for if no code can be delivered, and a missing TimelinesAI token
    // must not stand between every customer and their messages.
    expect(shouldAskForPhone(customer, false)).toBe(false);
  });

  it("never asks the team, who would otherwise be locked out of their own workspace", () => {
    expect(shouldAskForPhone({ ...customer, account_type: "team" }, true)).toBe(false);
  });

  it("stops asking once there is a number", () => {
    expect(shouldAskForPhone({ ...customer, phone: "+447957516879" }, true)).toBe(false);
  });

  it("respects someone who already skipped", () => {
    expect(shouldAskForPhone({ ...customer, phone_prompt_skipped_at: "2026-09-16T09:00:00Z" }, true)).toBe(false);
  });

  it("does not gate a deactivated account", () => {
    expect(shouldAskForPhone({ ...customer, deactivated_at: "2026-09-16T09:00:00Z" }, true)).toBe(false);
  });
});

describe("the gate always leaves a way through", () => {
  // The regression this guards: "Skip for now" used to appear only when the SERVER reported a
  // code undeliverable. A number we reject locally never reaches the server, so a customer with
  // a non-UK mobile saw an error and had no route into the app but signing out.
  it("rejects the inputs that would strand someone, so the UI must offer a skip", () => {
    for (const input of ["+33612345678", "01614960000", "", "not a number"]) {
      const r = normaliseUkMobile(input);
      expect(r.ok, input).toBe(false);
      // usePhoneVerification sets canSkip on exactly this branch; PhoneGate renders the button
      // from canSkip rather than from the server's undeliverable flag.
      expect(r.error, input).toBeTruthy();
    }
  });
});
