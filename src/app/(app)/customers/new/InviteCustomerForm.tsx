"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";
import { inviteCustomer, type InviteResult } from "./actions";

interface Group {
  id: string;
  name: string | null;
  topic: string | null;
  type: string;
}

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[15px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const label = "flex flex-col gap-1.5 text-[13px] font-semibold";
const card = "rounded-xl border border-line bg-card p-5";

export function InviteCustomerForm({ groups }: { groups: Group[] }) {
  const { nav, refresh } = useStore();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<InviteResult | null>(null);
  const [filter, setFilter] = useState("");
  const [createGroup, setCreateGroup] = useState(true);

  const visible = groups.filter((g) => !filter || (g.name ?? "").includes(filter.toLowerCase()));

  function submit(formData: FormData) {
    start(async () => {
      const r = await inviteCustomer(formData);
      setResult(r);
      if (r.ok) refresh();
    });
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
        <Icon name="userPlus" />
        <h1 className="text-[18px] font-bold">Invite a customer</h1>
      </div>

      <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-4 md:p-6">
        {result?.ok ? (
          <section className={card}>
            <h2 className="text-[17px] font-bold">Account created</h2>
            <p className="mt-1 text-[14px] text-muted">
              {result.emailStatus === "sent" && `We emailed the login details to ${result.email}.`}
              {result.emailStatus === "failed" &&
                `The account exists but the email failed to send (${result.emailError ?? "unknown error"}). Share the details below by another route.`}
              {result.emailStatus === "not_configured" &&
                "Email sending isn't configured yet (RESEND_API_KEY). Share the details below by another route."}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg bg-soft px-4 py-3 text-[14px]">
              <dt className="text-muted">Login email</dt>
              <dd className="font-semibold break-all">{result.email}</dd>
              <dt className="text-muted">Password</dt>
              <dd className="font-mono text-[15px] font-semibold tracking-wide">{result.password}</dd>
            </dl>
            <p className="mt-3 text-[12px] text-muted">
              This is the only time the password is shown here. The customer can change it from You → Account.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setResult(null)}
                className="h-11 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white"
              >
                Invite another
              </button>
              <Link
                href="/home"
                className="flex h-11 items-center rounded-lg border border-input-border px-4 text-[14px] font-semibold text-ink no-underline hover:bg-hover"
              >
                Go to Home
              </Link>
            </div>
          </section>
        ) : (
          <form action={submit} className="flex flex-col gap-4">
            <section className={`${card} flex flex-col gap-3`}>
              <h2 className="text-[15px] font-bold">Who</h2>
              <label className={label}>
                Full name
                <input name="full_name" required autoComplete="off" placeholder="Jason Beckhurst" className={input} />
              </label>
              <label className={label}>
                Email address (their login)
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="name@example.com"
                  className={input}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  Short name shown in chat <span className="font-normal text-muted">(optional)</span>
                  <input name="display_name" placeholder="Jason" className={input} />
                </label>
                <label className={label}>
                  Account type
                  <select name="role" defaultValue="owner" className={input}>
                    <option value="owner">Owner (can post)</option>
                    <option value="delegate">Delegate (read only, later)</option>
                  </select>
                </label>
              </div>
            </section>

            <section className={`${card} flex flex-col gap-3`}>
              <h2 className="text-[15px] font-bold">Groups</h2>
              <label className="flex items-start gap-3 rounded-lg border border-line px-3.5 py-3">
                <input
                  type="checkbox"
                  name="create_group"
                  checked={createGroup}
                  onChange={(e) => setCreateGroup(e.target.checked)}
                  className="mt-1 accent-[#5D8156]"
                />
                <span>
                  <span className="block text-[14px] font-semibold">Create a new group for this customer</span>
                  <span className="block text-[13px] text-muted">
                    Named from their full name, e.g. <code>jason-beckhurst</code>. You are added automatically.
                  </span>
                </span>
              </label>
              <div className="text-[13px] font-semibold">Also add to existing groups</div>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter groups…"
                className={input}
                aria-label="Filter groups"
              />
              <div className="scroll-thin max-h-56 overflow-y-auto rounded-lg border border-line">
                {visible.length === 0 && <p className="px-3.5 py-3 text-[13px] text-muted">No groups match.</p>}
                {visible.map((g) => (
                  <label
                    key={g.id}
                    className="flex items-center gap-3 border-t border-line px-3.5 py-2.5 first:border-t-0 hover:bg-hover"
                  >
                    <input type="checkbox" name="group_ids" value={g.id} className="accent-[#5D8156]" />
                    <Icon name="lock" size={14} strokeWidth={2} />
                    <span className="text-[14px] font-medium">{g.name}</span>
                    {g.topic && <span className="truncate text-[12px] text-muted">{g.topic}</span>}
                  </label>
                ))}
              </div>
            </section>

            <section className={`${card} text-[13px] text-muted`}>
              We&apos;ll create the account with a generated password and email the login details (their email address
              is the username). Customers only ever see the groups they&apos;re added to.
            </section>

            {result && !result.ok && (
              <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13px] text-[#8A2E22]">
                {result.error}
              </p>
            )}

            <div>
              <button
                type="submit"
                disabled={pending}
                className="h-11 rounded-lg bg-brand px-5 text-[14px] font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Creating account…" : "Create account and send login details"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
