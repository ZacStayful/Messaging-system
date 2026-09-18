"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";
import { saveMondaySettings } from "./actions";
import { LeadDatabase, type LeadEventRow } from "./LeadDatabase";

/** The same three class constants as the API and account screens, so the pages match. */
const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

export interface EventRow {
  id: number;
  event_id: string | null;
  item_id: string | null;
  event_type: string | null;
  outcome: string;
  error: string | null;
  created_at: string;
}

interface Props {
  enabled: boolean;
  actorUserId: string;
  standardMemberIds: string[];
  skipGroupIds: string[];
  team: { id: string; display_name: string }[];
  events: EventRow[];
  leadEvents: LeadEventRow[];
  leadBoardId: string;
  boardId: string;
  webhookBase: string;
  tokenSet: boolean;
  apiTokenSet: boolean;
}

/** Plain English for each outcome, so the log reads as a story rather than a set of enum values. */
const OUTCOMES: Record<string, string> = {
  created: "Created both groups",
  duplicate: "Already done — ignored",
  skipped_disabled: "Received while switched off",
  skipped_board: "Another board — ignored",
  skipped_group: "A skipped board group — ignored",
  skipped_event: "Not an item being created — ignored",
  no_address: "Customer group only (no property address)",
  not_configured: "Not configured",
  error: "Failed",
};

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MondayIntegration(props: Props) {
  const { nav } = useStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [enabled, setEnabled] = useState(props.enabled);

  const submit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveMondaySettings(formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That could not be saved.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const ready = props.tokenSet && props.apiTokenSet;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8">
      <Link href={`/${nav}`} className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <Icon name="back" size={16} /> Back
      </Link>
      <h1 className="font-display mb-1 text-[26px] font-bold text-ink">Integrations</h1>
      <p className="mb-6 text-[14px] text-ink-dim">
        Monday.com — new Contacts on the Clients board become a customer group and a property group here.
      </p>

      {!ready && (
        <div className={`${card} mb-5 border-amber-500/40 bg-amber-500/10`}>
          <p className="text-[14px] font-semibold text-ink">Not finished setting up</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-ink-dim">
            {!props.tokenSet && <li>MONDAY_WEBHOOK_TOKEN is not set, so the webhook answers 503.</li>}
            {!props.apiTokenSet && (
              <li>MONDAY_API_TOKEN is not set, so the property address cannot be read off the item.</li>
            )}
          </ul>
        </div>
      )}

      <form action={submit} className={`${card} mb-5`}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={props.enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
            className="mt-1 size-4 accent-brand"
          />
          <span>
            <span className="block text-[15px] font-semibold text-ink">Create groups from Monday</span>
            <span className="block text-[14px] text-ink-dim">
              While this is off, deliveries are still received and logged below — they just do not create anything. Turn
              it on when you are ready for real customers to be added.
            </span>
          </span>
        </label>

        <div className="mt-5">
          <label htmlFor="actor" className="mb-1.5 block text-[14px] font-semibold text-ink">
            Acts as
          </label>
          <select id="actor" name="actor_user_id" defaultValue={props.actorUserId} className={input}>
            <option value="">Choose a team member…</option>
            {props.team.map((t) => (
              <option key={t.id} value={t.id}>
                {t.display_name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Groups are created by this person and the welcome message is posted from them, exactly as if they had done
            it by hand. Nothing the integration does escapes their own access.
          </p>
        </div>

        <fieldset className="mt-5">
          <legend className="mb-1.5 text-[14px] font-semibold text-ink">Always add to new groups</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {props.team.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[14px] text-ink">
                <input
                  type="checkbox"
                  name="standard_member_ids"
                  value={t.id}
                  defaultChecked={props.standardMemberIds.includes(t.id)}
                  className="size-4 accent-brand"
                />
                {t.display_name}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-ink-dim">
            The welcome message introduces the team by name, so whoever it introduces should be in the group when it is
            posted.
          </p>
        </fieldset>

        <div className="mt-5">
          <label htmlFor="skip" className="mb-1.5 block text-[14px] font-semibold text-ink">
            Board groups to ignore
          </label>
          <input
            id="skip"
            name="skip_group_ids"
            defaultValue={props.skipGroupIds.join(", ")}
            placeholder="new_group"
            className={input}
          />
          <p className="mt-1.5 text-[13px] text-ink-dim">
            Monday group ids, comma separated. A Contact created in one of these is ignored — the Dropped group being
            the obvious one.
          </p>
        </div>

        {error && <p className="mt-4 text-[14px] text-danger">{error}</p>}
        {saved && !error && <p className="mt-4 text-[14px] text-ink-dim">Saved.</p>}
        <button type="submit" disabled={busy} className={`${primary} mt-5`}>
          {busy ? "Saving…" : enabled ? "Save and keep it on" : "Save"}
        </button>
      </form>

      <div className={`${card} mb-5`}>
        <h2 className="mb-1 text-[15px] font-semibold text-ink">Point Monday at this</h2>
        <p className="mb-3 text-[14px] text-ink-dim">
          On board {props.boardId}: Integrate → Webhooks → &ldquo;When an item is created&rdquo; → send a web request to
          the URL below, with your MONDAY_WEBHOOK_TOKEN on the end.
        </p>
        <code className="block overflow-x-auto rounded-lg border border-line bg-input px-3 py-2 text-[13px] text-ink">
          {props.webhookBase}
          <span className="text-ink-dim">&lt;MONDAY_WEBHOOK_TOKEN&gt;</span>
        </code>
      </div>

      <LeadDatabase boardId={props.leadBoardId} events={props.leadEvents} apiTokenSet={props.apiTokenSet} />

      <div className={card}>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Recent deliveries</h2>
        {props.events.length === 0 ? (
          <p className="text-[14px] text-ink-dim">
            Nothing yet. Once the webhook is saved in Monday, creating a Contact should show up here within seconds —
            even with the switch off.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {props.events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-ink">{OUTCOMES[e.outcome] ?? e.outcome}</p>
                  <p className="truncate text-[13px] text-ink-dim">
                    {e.event_type ?? "unknown event"}
                    {e.item_id ? ` · item ${e.item_id}` : ""}
                    {e.error ? ` · ${e.error}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[13px] text-ink-dim">{when(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
