"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import type { InviteResult } from "@/app/(app)/customers/new/actions";
import { inviteTeamMember } from "./actions";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";

export function InviteTeamForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await inviteTeamMember(new FormData(e.currentTarget));
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Something went wrong.");
    else setResult(r);
  };

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-4 py-5 md:px-8 md:py-8">
        <div className="mb-4 flex items-center gap-2">
          <Link
            href="/home"
            className="flex h-10 w-10 items-center justify-center text-ink md:hidden"
            aria-label="Back"
          >
            <Icon name="back" size={24} strokeWidth={2} />
          </Link>
          <h1 className="font-display text-[24px] font-bold">Add a team member</h1>
        </div>
        <p className="mb-5 text-[15px] text-muted">
          Creates a Stayful team account. They receive their login details by email and can change the password from You
          → Account. Team accounts see every group they are added to, internal notes and all the tools.
        </p>
        {result ? (
          <div className="rounded-xl border border-line bg-card p-5">
            <div className="text-[17px] font-bold">Account created</div>
            <p className="mt-1 text-[15px] text-muted">
              {result.emailStatus === "sent" && `Login details were emailed to ${result.email}.`}
              {result.emailStatus === "failed" &&
                `The email could not be sent (${result.emailError}). Share the details below.`}
              {result.emailStatus === "not_configured" &&
                "Email sending isn't configured yet. Share the details below."}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-soft px-4 py-3 text-[15px]">
              <dt className="text-muted">Login email</dt>
              <dd className="font-semibold break-all">{result.email}</dd>
              <dt className="text-muted">Password</dt>
              <dd className="font-mono text-[16px] font-semibold tracking-wide">{result.password}</dd>
            </dl>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white"
              >
                Add another
              </button>
              <Link
                href="/home"
                className="flex h-11 items-center rounded-lg border border-input-border px-4 text-[15px] font-semibold text-ink no-underline"
              >
                Done
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              Full name
              <input name="full_name" required placeholder="Martyn Smith" className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              Email address
              <input name="email" type="email" required placeholder="name@stayful.co.uk" className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
              Display name (optional)
              <input name="display_name" placeholder="Martyn" className={input} />
            </label>
            <fieldset className="flex flex-col gap-2 text-[14px] font-semibold">
              <legend className="mb-1">Role</legend>
              <label className="flex items-center gap-2 font-medium">
                <input type="radio" name="role" value="staff" defaultChecked className="accent-[#5D8156]" /> Staff:
                everything except adding team members
              </label>
              <label className="flex items-center gap-2 font-medium">
                <input type="radio" name="role" value="admin" className="accent-[#5D8156]" /> Admin: can also add team
                members and read the audit log
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="alert-error">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="h-11 rounded-lg bg-brand px-5 text-[15px] font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Creating…" : "Create account and email login details"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
