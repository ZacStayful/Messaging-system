"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

export function AccountSettings({ profile, hasPassword }: { profile: Profile; hasPassword: boolean }) {
  const { nav, refresh } = useStore();
  const supabase = createClient();

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [pwStatus, setPwStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [pwError, setPwError] = useState<string | null>(null);

  const [emailPref, setEmailPref] = useState(profile.email_notifications);
  const [prefStatus, setPrefStatus] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pw.length < 10) return setPwError("Use at least 10 characters.");
    if (pw !== pw2) return setPwError("The two passwords don't match.");
    setPwStatus("busy");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      setPwStatus("error");
      setPwError(error.message);
      return;
    }
    setPw("");
    setPw2("");
    setPwStatus("done");
  }

  async function savePref(value: string) {
    setEmailPref(value);
    setPrefStatus("busy");
    const { error } = await supabase.from("profiles").update({ email_notifications: value }).eq("id", profile.id);
    setPrefStatus(error ? "error" : "done");
    if (!error) refresh();
  }

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="flex h-[50px] items-center gap-2 border-b border-line px-3 md:px-5">
        <Link
          href={`/${nav}`}
          className="flex h-10 w-10 items-center justify-center text-ink md:hidden"
          aria-label="Back"
        >
          <Icon name="back" size={24} strokeWidth={2} />
        </Link>
        <h1 className="text-[18px] font-bold">Account</h1>
      </div>
      <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-4 md:p-6">
        <section className={`${card} flex items-center gap-4`}>
          <Avatar profile={profile} size={56} radius={14} />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-bold">{profile.full_name ?? profile.display_name}</div>
            <div className="truncate text-[14px] text-muted">{profile.email}</div>
            <div className="text-[14px] text-muted">Your login email is your username.</div>
          </div>
        </section>

        <section className={card}>
          <h2 className="mb-1 text-[16px] font-bold">{hasPassword ? "Change password" : "Set a password"}</h2>
          <p className="mb-4 text-[14px] text-muted">
            {hasPassword
              ? "Pick something only you know. Your browser can remember it for next time."
              : "You currently sign in with email links or Google. Set a password to sign in directly."}
          </p>
          <form onSubmit={changePassword} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              New password
              <span className="relative block">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  className={`${input} pr-12`}
                  minLength={10}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-hover"
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={18} />
                </button>
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              Confirm new password
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                className={input}
                minLength={10}
                required
              />
            </label>
            {pwError && (
              <p role="alert" className="alert-error">
                {pwError}
              </p>
            )}
            {pwStatus === "done" && (
              <p className="rounded-lg bg-soft px-3 py-2 text-[14px] text-link">Password updated.</p>
            )}
            <div>
              <button type="submit" disabled={pwStatus === "busy"} className={primary}>
                {pwStatus === "busy" ? "Saving…" : "Save password"}
              </button>
            </div>
          </form>
        </section>

        {profile.account_type === "customer" && (
          <section className={card}>
            <h2 className="mb-1 text-[16px] font-bold">Email notifications</h2>
            <p className="mb-4 text-[14px] text-muted">
              We email you when the Stayful team sends you a message, so you never miss an update.
            </p>
            <div className="flex flex-col gap-2">
              {[
                {
                  value: "instant",
                  label: "Email me every message",
                  hint: "Recommended. Replies to the email are not read yet; use the link in the email.",
                },
                { value: "off", label: "Don't email me", hint: "You'll only see messages when you open the app." },
              ].map((o) => (
                <label
                  key={o.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3.5 py-3 hover:bg-hover"
                  style={emailPref === o.value ? { borderColor: "var(--brand)" } : undefined}
                >
                  <input
                    type="radio"
                    name="email_notifications"
                    value={o.value}
                    checked={emailPref === o.value}
                    onChange={() => savePref(o.value)}
                    className="mt-1 accent-[#5D8156]"
                  />
                  <span>
                    <span className="block text-[15px] font-semibold">{o.label}</span>
                    <span className="block text-[14px] text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
              {prefStatus === "done" && <p className="text-[14px] text-link">Saved.</p>}
              {prefStatus === "error" && <p className="text-[14px] text-new">Couldn&apos;t save. Try again.</p>}
            </div>
          </section>
        )}

        <section className={`${card} flex items-center justify-between gap-3`}>
          <div>
            <h2 className="text-[16px] font-bold">Sign out</h2>
            <p className="text-[14px] text-muted">You stay signed in on this device until you sign out.</p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="h-11 rounded-lg border border-input-border px-4 text-[15px] font-semibold text-ink hover:bg-hover"
            >
              Sign out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
