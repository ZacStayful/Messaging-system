"use client";

import { useCallback, useEffect, useState } from "react";
import { normaliseUkMobile } from "@/lib/phone";
import { confirmPhoneCode, requestPhoneCode } from "@/app/(app)/onboarding/actions";

/**
 * The send-code / confirm-code state machine, shared by the first-login gate and the account
 * settings field. Both need the same steps, cooldown and error handling; only the wording and
 * the chrome around them differ, so the logic lives here and each renders its own UI.
 */
export interface PhoneVerification {
  step: "number" | "code";
  phone: string;
  setPhone: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  /** True once we know a code cannot be delivered, so the caller can offer a way out. */
  undeliverable: boolean;
  /** Seconds until another code may be requested; start_phone_verification refuses inside 60s. */
  cooldown: number;
  sendCode: () => Promise<void>;
  confirm: (whatsappOn: boolean, emailOn: boolean) => Promise<boolean>;
  backToNumber: () => void;
  reset: () => void;
}

export function usePhoneVerification(initialPhone = ""): PhoneVerification {
  const [step, setStep] = useState<"number" | "code">("number");
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undeliverable, setUndeliverable] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    setError(null);
    // Check locally first so an obvious typo does not cost a round trip or a rate-limit slot.
    const parsed = normaliseUkMobile(phone);
    if (!parsed.ok) {
      setError(parsed.error!);
      return;
    }
    setBusy(true);
    const res = await requestPhoneCode(phone);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      if (res.undeliverable) setUndeliverable(true);
      return;
    }
    setStep("code");
    setCooldown(60);
  }, [phone]);

  const confirm = useCallback(
    async (whatsappOn: boolean, emailOn: boolean) => {
      setError(null);
      setBusy(true);
      const res = await confirmPhoneCode(phone, code, whatsappOn, emailOn);
      setBusy(false);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return false;
      }
      return true;
    },
    [phone, code],
  );

  const backToNumber = useCallback(() => {
    setStep("number");
    setCode("");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setStep("number");
    setCode("");
    setError(null);
    setUndeliverable(false);
    setCooldown(0);
  }, []);

  return {
    step,
    phone,
    setPhone,
    code,
    setCode: (v: string) => setCode(v.replace(/\D/g, "")),
    busy,
    error,
    undeliverable,
    cooldown,
    sendCode,
    confirm,
    backToNumber,
    reset,
  };
}
