"use client";

import { useState } from "react";
import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/components/shell/store";
import { formatUkMobile } from "@/lib/phone";
import { usePhoneVerification } from "@/components/onboarding/usePhoneVerification";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const quiet = "text-[14px] font-semibold text-link underline-offset-2 hover:underline disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

/**
 * Mobile number and per-channel notification switches.
 *
 * The number goes through the same verification as the first-login gate rather than a plain
 * update, because profiles_guard_update (0018) refuses a direct write to `phone` — the only
 * ways in are a confirmed code or a team member using set_customer_phone. That is what stops
 * someone typing a colleague's number and receiving their group's messages.
 */
export function ContactSection({ profile }: { profile: Profile }) {
  const { refresh } = useStore();
  const supabase = createClient();
  const v = usePhoneVerification();

  const [editing, setEditing] = useState(false);
  const [whatsappOn, setWhatsappOn] = useState(profile.whatsapp_notifications === "instant");
  const [emailOn, setEmailOn] = useState(profile.email_notifications === "instant");
  const [prefStatus, setPrefStatus] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function savePrefs(next: { whatsapp?: boolean; email?: boolean }) {
    const wa = next.whatsapp ?? whatsappOn;
    const em = next.email ?? emailOn;
    setWhatsappOn(wa);
    setEmailOn(em);
    setPrefStatus("busy");
    const { error } = await supabase
      .from("profiles")
      .update({
        whatsapp_notifications: wa ? "instant" : "off",
        email_notifications: em ? "instant" : "off",
      })
      .eq("id", profile.id);
    setPrefStatus(error ? "error" : "done");
    if (!error) refresh();
  }

  async function onConfirm() {
    if (!(await v.confirm(whatsappOn, emailOn))) return;
    setEditing(false);
    v.reset();
    refresh();
  }

  return (
    <section className={card}>
      <h2 className="mb-1 text-[16px] font-bold">How we reach you</h2>
      <p className="mb-4 text-[14px] text-muted">
        Messages always appear in the app. Choose anything else you&apos;d like a copy on.
      </p>

      <div className="mb-4 rounded-lg border border-line px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[15px] font-semibold">
              {profile.phone ? formatUkMobile(profile.phone) : "No mobile number yet"}
            </div>
            <div className="text-[14px] text-muted">
              {profile.phone
                ? profile.phone_verified_at
                  ? "Verified."
                  : "Added by the Stayful team — not yet confirmed by you."
                : "Add one to receive messages on WhatsApp."}
            </div>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                v.reset();
                v.setPhone("");
                setEditing(true);
              }}
              className={quiet}
            >
              {profile.phone ? "Change" : "Add a number"}
            </button>
          )}
        </div>

        {editing && (
          <div className="mt-4 border-t border-line pt-4">
            {v.step === "number" ? (
              <>
                <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
                  New mobile number
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
                  />
                </label>
                {v.error && (
                  <p role="alert" className="alert-error mt-3">
                    {v.error}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-4">
                  <button type="button" onClick={() => void v.sendCode()} disabled={v.busy} className={primary}>
                    {v.busy ? "Sending…" : "Send me a code"}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} disabled={v.busy} className={quiet}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[14px] text-muted">
                  Enter the six-digit code we sent on WhatsApp to{" "}
                  <span className="font-semibold text-ink">{v.phone}</span>.
                </p>
                <label className="mt-3 flex flex-col gap-1.5 text-[14px] font-semibold">
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
                  />
                </label>
                {v.error && (
                  <p role="alert" className="alert-error mt-3">
                    {v.error}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4">
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
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {[
          {
            id: "wa",
            on: whatsappOn,
            label: "WhatsApp",
            hint: profile.phone
              ? "Sent to your mobile. Reply on WhatsApp and it lands back in your group."
              : "Add a mobile number above first.",
            disabled: !profile.phone,
            set: (on: boolean) => savePrefs({ whatsapp: on }),
          },
          {
            id: "em",
            on: emailOn,
            label: "Email",
            hint: "Sent to your login email. Replies come back into your group.",
            disabled: !profile.email,
            set: (on: boolean) => savePrefs({ email: on }),
          },
        ].map((c) => (
          <label
            key={c.id}
            className={`flex items-start gap-3 rounded-lg border border-line px-3.5 py-3 ${
              c.disabled ? "opacity-60" : "cursor-pointer hover:bg-hover"
            }`}
          >
            <input
              type="checkbox"
              checked={c.on && !c.disabled}
              disabled={c.disabled}
              onChange={(e) => void c.set(e.target.checked)}
              className="mt-1 accent-[#5D8156]"
            />
            <span>
              <span className="block text-[15px] font-semibold">{c.label}</span>
              <span className="block text-[14px] text-muted">{c.hint}</span>
            </span>
          </label>
        ))}
        <div className="flex items-start gap-3 rounded-lg border border-line px-3.5 py-3">
          <input type="checkbox" checked disabled className="mt-1 accent-[#5D8156]" />
          <span>
            <span className="block text-[15px] font-semibold">In the app</span>
            <span className="block text-[14px] text-muted">Always on.</span>
          </span>
        </div>
        {prefStatus === "done" && <p className="text-[14px] text-link">Saved.</p>}
        {prefStatus === "error" && <p className="text-[14px] text-new">Couldn&apos;t save. Try again.</p>}
      </div>
    </section>
  );
}
