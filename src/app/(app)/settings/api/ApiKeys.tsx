"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";
import { useNow } from "@/lib/useNow";
import { SCOPES, SCOPE_LABELS, type Scope } from "@/lib/api/keys";
import { createApiKey, revokeApiKey } from "./actions";

/** Same three class constants as the account page, so the two screens match. */
const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

export interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  user_id: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface ApiKeysProps {
  keys: KeyRow[];
  team: { id: string; display_name: string }[];
  meId: string;
  /** False when SUPABASE_JWT_SECRET is missing, in which case every request 503s. */
  jwtReady: boolean;
}

const when = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export function ApiKeys({ keys, team, meId, jwtReady }: ApiKeysProps) {
  const { nav } = useStore();
  const router = useRouter();
  // Via the shared hook, so expiry is re-evaluated on a timer rather than impurely in render.
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ plaintext: string; warning?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const nameFor = (id: string) => team.find((t) => t.id === id)?.display_name ?? "a former member";

  const submit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    const result = await createApiKey(formData);
    setBusy(false);
    if (!result.ok || !result.plaintext) {
      setError(result.error ?? "The key could not be created.");
      return;
    }
    setCreated({ plaintext: result.plaintext, warning: result.warning });
    setOpen(false);
    router.refresh();
  };

  const revoke = async (id: string, name: string) => {
    if (!window.confirm(`Revoke "${name}"? Anything using it stops working immediately.`)) return;
    setBusy(true);
    const result = await revokeApiKey(id);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "The key could not be revoked.");
    router.refresh();
  };

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
        <h1 className="text-[18px] font-bold">API and integrations</h1>
      </div>

      <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-4 md:p-6">
        <section className={card}>
          <div className="mb-1 flex items-center gap-2 text-[16px] font-bold">
            <Icon name="key" size={18} /> API keys
          </div>
          <p className="text-[15px] text-muted">
            A key lets other software — an automation, or an AI assistant over MCP — read and post in Stayful{" "}
            <strong>as one of your team</strong>. Messages it sends appear from that person with a &ldquo;via API&rdquo;
            label, so a conversation always shows who said what.
          </p>
          {!jwtReady && (
            <p className="mt-3 rounded-lg bg-soft px-3 py-2 text-[14px] text-[#B4661F]">
              <strong>Not configured.</strong> <code>SUPABASE_JWT_SECRET</code> is not set on this deployment, so the
              API and MCP server will answer 503 until it is. Find it in the Supabase dashboard under Project Settings →
              JWT Keys → Legacy JWT Secret. Don&rsquo;t migrate or rotate those keys: requests are signed with the
              legacy secret, so switching to asymmetric keys stops both at once.
            </p>
          )}
        </section>

        {created && (
          <section className={`${card} border-brand`}>
            <div className="mb-1 text-[16px] font-bold">Your new key</div>
            <p className="mb-3 text-[14px] text-muted">
              Copy it now — this is the only time it is shown. Stayful stores only a hash, so it cannot be shown again,
              and a lost key has to be revoked and replaced.
            </p>
            <code className="block overflow-x-auto rounded-lg bg-input px-3 py-2.5 text-[14px] break-all">
              {created.plaintext}
            </code>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className={primary}
                onClick={() => {
                  void navigator.clipboard.writeText(created.plaintext);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreated(null);
                  setCopied(false);
                }}
                className="h-11 rounded-lg border border-input-border px-4 text-[15px] font-semibold hover:bg-hover"
              >
                Done
              </button>
            </div>
            {created.warning && <p className="mt-3 text-[14px] text-[#B4661F]">{created.warning}</p>}
          </section>
        )}

        {error && <p className="text-[15px] text-[#D4674A]">{error}</p>}

        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <div className="text-[16px] font-bold">Keys</div>
            <div className="flex-1" />
            <button type="button" onClick={() => setOpen((v) => !v)} className={primary} disabled={busy}>
              {open ? "Cancel" : "New key"}
            </button>
          </div>

          {open && (
            <form action={submit} className="mb-5 flex flex-col gap-3 border-b border-line pb-5">
              <label className="text-[14px] font-semibold">
                Name
                <input name="name" placeholder="n8n automation" className={`${input} mt-1`} required />
              </label>
              <label className="text-[14px] font-semibold">
                Acts as
                <select name="user_id" defaultValue={meId} className={`${input} mt-1`}>
                  {team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[13px] font-normal text-muted">
                  Everything this key does is done as this person, and is limited to what they can already see.
                </span>
              </label>
              <label className="text-[14px] font-semibold">
                Expires after
                <select name="expires_days" defaultValue="0" className={`${input} mt-1`}>
                  <option value="0">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">A year</option>
                </select>
              </label>
              <fieldset>
                <legend className="mb-1 text-[14px] font-semibold">What it may do</legend>
                <div className="flex flex-col gap-1.5">
                  {SCOPES.map((s: Scope) => (
                    <label key={s} className="flex items-center gap-2.5 text-[15px]">
                      <input type="checkbox" name="scopes" value={s} className="h-4 w-4 accent-[var(--brand)]" />
                      {SCOPE_LABELS[s]}
                      <code className="text-[12px] text-muted">{s}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className={primary} disabled={busy}>
                {busy ? "Creating…" : "Create key"}
              </button>
            </form>
          )}

          {keys.length === 0 && <p className="text-[15px] text-muted">No keys yet.</p>}

          <div className="flex flex-col gap-3">
            {keys.map((k) => {
              const expired = !!k.expires_at && new Date(k.expires_at).getTime() <= now;
              const dead = !!k.revoked_at || expired;
              return (
                <div key={k.id} className={`rounded-lg border border-line p-3.5 ${dead ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[15px] font-bold">{k.name}</span>
                    <code className="text-[13px] text-muted">{k.key_prefix}…</code>
                    {k.revoked_at && <span className="text-[13px] font-semibold text-[#D4674A]">Revoked</span>}
                    {!k.revoked_at && expired && (
                      <span className="text-[13px] font-semibold text-[#B4661F]">Expired</span>
                    )}
                    <div className="flex-1" />
                    {!dead && (
                      <button
                        type="button"
                        onClick={() => void revoke(k.id, k.name)}
                        disabled={busy}
                        className="h-8 rounded-md border border-input-border px-2.5 text-[13px] font-semibold hover:bg-hover"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[13px] text-muted">
                    Acts as {nameFor(k.user_id)} · created {when(k.created_at)} · last used{" "}
                    {k.last_used_at ? when(k.last_used_at) : "never"}
                    {k.expires_at ? ` · expires ${when(k.expires_at)}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <code key={s} className="rounded bg-soft px-1.5 py-0.5 text-[12px] text-muted">
                        {s}
                      </code>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
