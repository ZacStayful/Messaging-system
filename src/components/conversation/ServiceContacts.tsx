"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { useStore } from "@/components/shell/store";
import { addServiceContact, removeServiceContact } from "./serviceContactActions";

const input =
  "w-full rounded-lg border border-input-border bg-input px-3 py-2 text-[16px] text-ink outline-none focus:border-brand";
const primary = "h-10 rounded-lg bg-brand px-3.5 text-[15px] font-semibold text-white disabled:opacity-50";

export type ContactKind = "cleaning" | "maintenance";

export interface ContactRow {
  user_id: string;
  kind: string;
}

/**
 * The cleaners and contractors registered on a property group.
 *
 * Registering someone is what makes their WhatsApp land in the right place: `add_property_contact`
 * (0024) writes the routing row, the membership and the thread follow together, and the inbound
 * webhook reads the first of those on every message.
 */
export function ServiceContacts({ conversationId }: { conversationId: string }) {
  const { profiles, refresh } = useStore();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [kind, setKind] = useState<ContactKind>("cleaning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  // Bumped after any change, which is what re-runs the fetch below. A counter rather than
  // calling a loader by hand, so there is one place that reads and one way to ask it to.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("property_contacts")
        .select("user_id, kind")
        .eq("conversation_id", conversationId);
      if (!cancelled) setRows(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId, reload]);

  const submit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    setNote(null);
    setPassword(null);
    const result = await addServiceContact(formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That contact could not be added.");
      return;
    }
    if (result.error) setError(result.error);
    if (result.emailStatus === "not_configured" && result.password) {
      setPassword(result.password);
      setNote("Email is not configured, so pass these details on yourself.");
    } else if (result.emailStatus === "failed") {
      setNote("Registered, but the welcome email could not be sent.");
    } else if (result.emailStatus === "sent") {
      setNote("Registered, and their login details are on their way.");
    } else {
      setNote("Registered.");
    }
    setReload((n) => n + 1);
    refresh();
  };

  const remove = async (userId: string, contactKind: string, name: string) => {
    if (!window.confirm(`Stop routing ${name}'s WhatsApp into the ${contactKind} thread?`)) return;
    setBusy(true);
    const result = await removeServiceContact(conversationId, userId, contactKind);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That could not be removed.");
      return;
    }
    setReload((n) => n + 1);
  };

  const nameFor = (id: string) => profiles[id]?.display_name ?? "Someone";

  return (
    <div className="px-5 py-4 md:px-6">
      <p className="mb-4 text-[14px] text-muted">
        Messages from these numbers on WhatsApp are filed into this property&rsquo;s threads, and replies in a thread go
        back to them. Maintenance contacts are reached here but their replies land in the central Maintenance channel
        for now, because one contractor covers many properties.
      </p>

      {rows === null ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mb-4 text-[14px] text-muted">Nobody is registered on this property yet.</p>
      ) : (
        <ul className="mb-5 divide-y divide-line">
          {rows.map((r) => {
            const profile = profiles[r.user_id];
            return (
              <li key={`${r.user_id}:${r.kind}`} className="flex items-center gap-3 py-2.5">
                {profile && <Avatar profile={profile} size={32} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] text-ink">{nameFor(r.user_id)}</p>
                  <p className="truncate text-[13px] text-muted capitalize">{r.kind}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(r.user_id, r.kind, nameFor(r.user_id))}
                  className="text-[14px] text-muted hover:text-ink disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <form action={submit} className="rounded-xl border border-line bg-card p-3">
        <input type="hidden" name="conversation_id" value={conversationId} />
        <div className="mb-3 flex gap-2">
          {(["cleaning", "maintenance"] as ContactKind[]).map((k) => (
            <label
              key={k}
              className={`flex h-9 cursor-pointer items-center rounded-lg border px-3 text-[15px] capitalize ${
                kind === k ? "border-brand bg-brand/10 text-ink" : "border-input-border text-muted"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="sr-only"
              />
              {k}
            </label>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input name="full_name" placeholder="Name" aria-label="Name" className={input} />
          <input name="email" type="email" placeholder="Email" aria-label="Email" className={input} />
          <input name="phone" placeholder="Mobile (07…)" aria-label="Mobile number" className={input} />
        </div>
        <p className="mt-2 text-[13px] text-muted">
          A new contact gets an account and is emailed their login details. WhatsApp routing needs a UK mobile.
        </p>
        {error && <p className="mt-2 text-[14px] text-danger">{error}</p>}
        {note && !error && <p className="mt-2 text-[14px] text-muted">{note}</p>}
        {password && <code className="mt-2 block rounded-md border border-line px-2 py-1 text-[14px]">{password}</code>}
        <button type="submit" disabled={busy} className={`${primary} mt-3`}>
          {busy ? "Adding…" : "Add contact"}
        </button>
      </form>
    </div>
  );
}
