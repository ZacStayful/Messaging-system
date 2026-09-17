"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";
import { MessageBody } from "@/components/conversation/MessageBody";
import { KNOWN_PLACEHOLDERS, placeholdersIn, renderTemplate } from "@/lib/templates/render";
import { restoreTemplate, saveTemplate } from "./actions";

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primary =
  "h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const card = "rounded-xl border border-line bg-card p-5";

export interface TemplateRow {
  key: string;
  title: string;
  description: string | null;
  body: string;
  active: boolean;
  updated_at: string;
}

/** Stand-ins so the preview reads like a real message rather than a row of braces. */
const SAMPLE = {
  customer_name: "Rohana Bakhshi",
  first_name: "Rohana",
  property_address: "Apartment 1203, Michighan Point Tower D, Salford M50 2HN",
  account_manager: "Martyn",
};

export function Templates({ templates }: { templates: TemplateRow[] }) {
  const { nav } = useStore();
  const router = useRouter();
  const [selected, setSelected] = useState(templates[0]?.key ?? "");
  const template = templates.find((t) => t.key === selected);
  const [body, setBody] = useState(template?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const choose = (key: string) => {
    setSelected(key);
    setBody(templates.find((t) => t.key === key)?.body ?? "");
    setSaved(false);
    setError(null);
  };

  const submit = async (formData: FormData) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await saveTemplate(formData);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That could not be saved.");
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const restore = async () => {
    if (!template) return;
    if (!window.confirm(`Put "${template.title}" back to the version Stayful ships with?`)) return;
    setBusy(true);
    const result = await restoreTemplate(template.key);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That could not be restored.");
      return;
    }
    router.refresh();
  };

  // Anything in the body that will not be substituted — almost always a typo, and far better
  // caught here than by a customer reading "{{proprty_address}}".
  const unknown = placeholdersIn(body).filter((p) => !(KNOWN_PLACEHOLDERS as readonly string[]).includes(p));

  if (!template) {
    return (
      <div className="mx-auto w-full max-w-[760px] px-4 py-8">
        <h1 className="font-display mb-2 text-[26px] font-bold text-ink">Message templates</h1>
        <p className="text-[14px] text-ink-dim">There are no templates in this workspace yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-8">
      <Link href={`/${nav}`} className="mb-4 inline-flex items-center gap-1.5 text-[14px] text-ink-dim hover:text-ink">
        <Icon name="back" size={16} /> Back
      </Link>
      <h1 className="font-display mb-1 text-[26px] font-bold text-ink">Message templates</h1>
      <p className="mb-6 text-[14px] text-ink-dim">
        The standard messages Stayful posts automatically. Editing one changes what the next group opens with; it never
        rewrites a message a customer has already read.
      </p>

      {templates.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => choose(t.key)}
              className={`h-9 rounded-lg border px-3 text-[14px] ${
                t.key === selected ? "border-brand bg-brand/10 text-ink" : "border-line text-ink-dim hover:text-ink"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      <form action={submit} className={`${card} mb-5`}>
        <input type="hidden" name="key" value={template.key} />
        <label htmlFor="title" className="mb-1.5 block text-[14px] font-semibold text-ink">
          Name
        </label>
        <input id="title" name="title" defaultValue={template.title} className={input} />

        <label htmlFor="body" className="mt-5 mb-1.5 block text-[14px] font-semibold text-ink">
          Message
        </label>
        <textarea
          id="body"
          name="body"
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          rows={18}
          className="w-full rounded-lg border border-input-border bg-input px-3.5 py-3 font-mono text-[14px] leading-[1.6] text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]"
        />
        <p className="mt-1.5 text-[13px] text-ink-dim">
          Written the same way as a message in the app: <code>**bold**</code>, <code>- bullets</code>,{" "}
          <code>[text](link)</code>. A line that is entirely bold becomes a heading.
        </p>

        <div className="mt-4">
          <p className="mb-1.5 text-[14px] font-semibold text-ink">Placeholders</p>
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_PLACEHOLDERS.map((p) => (
              <code key={p} className="rounded-md border border-line px-2 py-1 text-[13px] text-ink-dim">
                {`{{${p}}}`}
              </code>
            ))}
          </div>
          {unknown.length > 0 && (
            <p className="mt-2 text-[13px] text-danger">
              {unknown.map((u) => `{{${u}}}`).join(", ")} {unknown.length === 1 ? "is" : "are"} not substituted and will
              be sent as written.
            </p>
          )}
        </div>

        <label className="mt-5 flex items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" name="active" defaultChecked={template.active} className="size-4 accent-brand" />
          Post this automatically
        </label>

        {error && <p className="mt-4 text-[14px] text-danger">{error}</p>}
        {saved && !error && <p className="mt-4 text-[14px] text-ink-dim">Saved.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy} className={primary}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={restore}
            disabled={busy}
            className="h-11 rounded-lg border border-line px-4 text-[15px] text-ink-dim hover:text-ink disabled:opacity-60"
          >
            Restore the default
          </button>
        </div>
      </form>

      <div className={card}>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Preview</h2>
        <p className="mb-3 text-[13px] text-ink-dim">Rendered exactly as a message in a group, with example details.</p>
        <div className="rounded-lg border border-line bg-input p-4 text-ink">
          <MessageBody body={renderTemplate(body, SAMPLE)} />
        </div>
      </div>
    </div>
  );
}
