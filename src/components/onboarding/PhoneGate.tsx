"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/database.types";
import { skipPhonePrompt } from "@/app/(app)/onboarding/actions";
import { usePhoneVerification } from "./usePhoneVerification";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const quiet = "text-[14px] font-semibold text-link underline-offset-2 hover:underline disabled:opacity-60";
/** Matches the "Your account isn't set up yet" panel in (app)/layout.tsx. */
const panel = "max-w-md rounded-[14px] border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(0,0,0,0.35)]";

/**
 * The first-login mobile number gate, shown in place of the app shell.
 *
 * Every branch keeps a way out, because a gate nobody can pass is an outage rather than a
 * feature. Sign out is always on screen, and "Skip for now" appears as soon as any attempt
 * fails — including one we reject locally, such as a number that is not a UK mobile. An earlier
 * version showed it only when the server reported the code undeliverable, which left a customer
 * with a non-UK number no route into the app at all.
 */
export function PhoneGate({ profile }: { profile: Profile }) {
  const router = useRouter();
  const v = usePhoneVerification();
  const [whatsappOn, setWhatsappOn] = useState(true);
  const [emailOn, setEmailOn] = useState(profile.email_notifications !== "off");
  const [skipping, setSkipping] = useState(false);

  async function onConfirm() {
    if (await v.confirm(whatsappOn, emailOn)) router.refresh();
  }

  async function onSkip() {
    setSkipping(true);
    await skipPhonePrompt();
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-frame p-6 text-ink">
      <div className={panel}>
        {v.step === "number" ? (
          <>
            <h1 className="text-[20px] font-bold">What&apos;s your mobile number?</h1>
            <p className="mt-2 text-[15px] text-muted">
              So the Stayful team can reach you on WhatsApp as well as in here. We&apos;ll send a code to check
              it&apos;s yours.
            </p>

            <label className="mt-5 flex flex-col gap-1.5 text-[14px] font-semibold">
              Mobile number
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="07957 516879"
                value={v.phone}
                onChange={(e) => v.setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !v.busy && void v.sendCode()}
                className={input}
                aria-describedby={v.error ? "phone-error" : undefined}
              />
            </label>

            <fieldset className="mt-5">
              <legend className="text-[14px] font-semibold">How should we reach you?</legend>
              <p className="mt-1 mb-2 text-[13px] text-muted">
                You&apos;ll always see everything in the app. Change this any time in your account settings.
              </p>
              {[
                { on: whatsappOn, set: setWhatsappOn, label: "WhatsApp", id: "ch-wa" },
                { on: emailOn, set: setEmailOn, label: "Email", id: "ch-em" },
              ].map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={c.on}
                    onChange={(e) => c.set(e.target.checked)}
                    className="accent-[#5D8156]"
                  />
                  <span className="text-[15px]">{c.label}</span>
                </label>
              ))}
            </fieldset>

            {v.error && (
              <p id="phone-error" role="alert" className="alert-error mt-4">
                {v.error}
              </p>
            )}

            <div className="mt-5 flex items-center gap-4">
              <button type="button" onClick={() => void v.sendCode()} disabled={v.busy} className={primary}>
                {v.busy ? "Sending…" : "Send me a code"}
              </button>
              {/* Offered after any failed attempt, not only an undeliverable one: a customer
                  whose number we refuse must never be left with an error and no way forward. */}
              {v.canSkip && (
                <button type="button" onClick={() => void onSkip()} disabled={skipping} className={quiet}>
                  {skipping ? "…" : "Skip for now"}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[20px] font-bold">Enter the code</h1>
            <p className="mt-2 text-[15px] text-muted">
              We sent a six-digit code on WhatsApp to <span className="font-semibold text-ink">{v.phone}</span>.
            </p>

            <label className="mt-5 flex flex-col gap-1.5 text-[14px] font-semibold">
              Verification code
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={v.code}
                onChange={(e) => v.setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !v.busy && void onConfirm()}
                className={`${input} tracking-[0.4em]`}
                aria-describedby={v.error ? "code-error" : undefined}
              />
            </label>

            {v.error && (
              <p id="code-error" role="alert" className="alert-error mt-4">
                {v.error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={v.busy || v.code.length < 6}
                className={primary}
              >
                {v.busy ? "Checking…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => void v.sendCode()}
                disabled={v.busy || v.cooldown > 0}
                className={quiet}
              >
                {v.cooldown > 0 ? `Resend in ${v.cooldown}s` : "Resend code"}
              </button>
              <button type="button" onClick={v.backToNumber} disabled={v.busy} className={quiet}>
                Change number
              </button>
            </div>
          </>
        )}

        {/* Always reachable: nobody is ever stuck on this screen. */}
        <form action="/auth/signout" method="post" className="mt-6 border-t border-line pt-4">
          <button type="submit" className={quiet}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
