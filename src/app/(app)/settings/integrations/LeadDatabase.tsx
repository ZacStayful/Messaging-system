"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_CATEGORIES, LEAD_CATEGORY_KEYS } from "@/lib/leadCategories";
import { LEAD_OUTCOMES, type LeadImportResult } from "@/lib/monday/importLeads";
import { importLeadDatabase } from "./actions";

const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

export interface LeadEventRow {
  id: number;
  event_id: string | null;
  item_id: string | null;
  outcome: string;
  error: string | null;
  created_at: string;
  name: string | null;
}

interface Props {
  boardId: string;
  events: LeadEventRow[];
  apiTokenSet: boolean;
}

const when = (value: string) =>
  new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const label = (outcome: string) => (LEAD_OUTCOMES as Record<string, string>)[outcome] ?? outcome;

/** Outcomes worth a second look are shown in the warning colour; the rest read as plain text. */
const attention = new Set(["bad_phone", "phone_conflict", "email_conflict", "error", "skipped_no_email"]);

/**
 * The lead database card: what the import does, the button that does it, and what it did.
 *
 * Deliberately not a switch. The Clients integration provisions on a webhook because a new
 * client is a new client; the lead database is a list that is read on request, because the
 * point of this pass is to put a known set of people on file and watch what arrives.
 */
export function LeadDatabase(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LeadImportResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    const result = await importLeadDatabase();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "The import could not run.");
      return;
    }
    setResults(result.results ?? []);
    router.refresh();
  };

  const counts = results
    ? results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {})
    : null;

  return (
    <div className={`${card} mb-5`}>
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Lead database</h2>
      <p className="mb-3 text-[14px] text-ink-dim">
        Reads board {props.boardId} and puts everyone in its customer groups on file here, under &ldquo;Lead database
        customers&rdquo; in the sidebar: one group each, an account that cannot sign in, and nothing sent to them. Their
        WhatsApp messages and forwarded emails then land in their group, and a reply typed here reaches them as a plain
        WhatsApp from the number they already know.
      </p>
      <ul className="mb-4 space-y-1 text-[14px] text-ink-dim">
        {LEAD_CATEGORY_KEYS.map((key) => (
          <li key={key}>
            <span className="font-medium text-ink">{LEAD_CATEGORIES[key].label}</span>
            <span className="text-ink-dim"> ← Monday group </span>
            <code className="text-[13px]">{LEAD_CATEGORIES[key].mondayGroupId}</code>
          </li>
        ))}
      </ul>
      <p className="mb-4 text-[13px] text-ink-dim">
        Safe to run again: someone already on file has their name, email and number refreshed rather than duplicated.
      </p>

      {!props.apiTokenSet && (
        <p className="mb-3 text-[14px] text-danger">MONDAY_API_TOKEN is not set, so the board cannot be read.</p>
      )}
      {error && <p className="mb-3 text-[14px] text-danger">{error}</p>}

      <button type="button" onClick={run} disabled={busy || !props.apiTokenSet} className={primary}>
        {busy ? "Importing…" : "Import now"}
      </button>

      {results && (
        <div className="mt-5">
          <p className="mb-2 text-[14px] font-semibold text-ink">
            {results.length === 0
              ? "Nothing in either group."
              : Object.entries(counts ?? {})
                  .map(([outcome, n]) => `${n} ${label(outcome).toLowerCase()}`)
                  .join(" · ")}
          </p>
          {results.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {results.map((r) => (
                <li key={r.itemId} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] text-ink">{r.name || `item ${r.itemId}`}</p>
                    <p className="truncate text-[13px] text-ink-dim">
                      {r.category ? LEAD_CATEGORIES[r.category].label : "no category"}
                      {r.error ? ` · ${r.error}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[13px] ${attention.has(r.outcome) ? "text-danger" : "text-ink-dim"}`}>
                    {label(r.outcome)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3 className="mt-5 mb-2 text-[14px] font-semibold text-ink">Recent imports</h3>
      {props.events.length === 0 ? (
        <p className="text-[14px] text-ink-dim">Nothing yet. Each person the import touches shows up here.</p>
      ) : (
        <ul className="divide-y divide-line">
          {props.events.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[14px] text-ink">
                  {e.name ?? (e.item_id ? `item ${e.item_id}` : "unknown item")}
                  <span className="text-ink-dim"> · {label(e.outcome)}</span>
                </p>
                {e.error && <p className="truncate text-[13px] text-ink-dim">{e.error}</p>}
              </div>
              <span className="shrink-0 text-[13px] text-ink-dim">{when(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
