"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { presenceLook } from "@/lib/presence";
import { useStore, type NewMessageMode } from "./store";

/**
 * Slack's "New message" flow. Pick one person for a DM, several for a group DM, or
 * (team only) switch to "New group" to create a named customer group or internal channel.
 */
export function NewMessageModal({ mode, onClose }: { mode: NewMessageMode; onClose: () => void }) {
  const { me, profiles, conversations, isOnline, openDm, refresh } = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isTeam = me.account_type === "team";
  const [tab, setTab] = useState<NewMessageMode>(isTeam ? mode : "people");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [type, setType] = useState<"owner" | "internal">("owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Customers can only message team members they share a group with (D14); the list they
  // receive from the server is already limited by RLS, so exclude other customers here.
  const people = useMemo(
    () =>
      Object.values(profiles)
        .filter((p) => p.id !== me.id && !p.deactivated_at && (isTeam || p.account_type === "team"))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [profiles, me.id, isTeam],
  );
  const query = q.trim().toLowerCase();
  const results = people.filter(
    (p) =>
      !picked.some((x) => x.id === p.id) &&
      (!query || `${p.display_name} ${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(query)),
  );

  const existingDm =
    picked.length === 1 ? conversations.find((c) => c.type === "dm" && c.member_ids.includes(picked[0].id)) : null;
  const existingGroupDm =
    picked.length > 1
      ? conversations.find(
          (c) =>
            c.type === "group_dm" &&
            c.member_ids.length === picked.length + 1 &&
            picked.every((p) => c.member_ids.includes(p.id)),
        )
      : null;

  const go = (id: string, nav: "dms" | "home") => {
    onClose();
    router.push(`/${nav}/${id}`);
  };

  const startConversation = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    if (picked.length === 1) {
      const id = existingDm?.id ?? (await openDm(picked[0].id));
      if (id) go(id, "dms");
      else setError("That conversation couldn't be opened.");
    } else if (existingGroupDm) {
      go(existingGroupDm.id, "dms");
    } else {
      const { data, error: err } = await supabase.rpc("create_group_dm", { p_member_ids: picked.map((p) => p.id) });
      if (err || !data) setError(err?.message ?? "The group message couldn't be created.");
      else {
        refresh();
        go(data, "dms");
      }
    }
    setBusy(false);
  };

  const createGroup = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_channel", {
      p_name: name.trim(),
      p_type: type,
      p_member_ids: picked.map((p) => p.id),
      p_topic: topic.trim() || null,
    });
    if (err || !data) setError(err?.message ?? "The group couldn't be created.");
    else {
      refresh();
      go(data, "home");
    }
    setBusy(false);
  };

  const canSubmit = tab === "people" ? picked.length > 0 : name.trim().length > 0;
  const submitLabel =
    tab === "group"
      ? "Create group"
      : picked.length > 1
        ? existingGroupDm
          ? "Open group message"
          : "Start group message"
        : existingDm
          ? "Open conversation"
          : "Start conversation";

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-overlay p-3 pt-[8vh] md:p-6 md:pt-[10vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New message"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[620px] flex-col overflow-hidden rounded-[14px] bg-panel text-ink shadow-[0_20px_60px_rgba(0,0,0,.35)]"
      >
        <div className="flex items-center gap-2 px-5 pt-5 md:px-6">
          <span className="font-display flex-1 text-[22px] font-bold">
            {tab === "group" ? "New group" : "New message"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-hover"
            aria-label="Close"
          >
            <Icon name="close" strokeWidth={2} />
          </button>
        </div>

        {isTeam && (
          <div className="flex gap-1 border-b border-line px-5 pt-3 md:px-6">
            {(
              [
                { id: "people", label: "Message people" },
                { id: "group", label: "Create a group" },
              ] as { id: NewMessageMode; label: string }[]
            ).map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(t.id)}
                  className="border-0 border-b-[3px] bg-transparent px-2.5 pt-1 pb-2.5 text-[16px]"
                  style={{
                    borderBottomColor: on ? "var(--tab)" : "transparent",
                    color: on ? "var(--text)" : "var(--muted)",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-3 px-5 pt-4 md:px-6">
          {tab === "group" && (
            <>
              <div className="flex gap-2">
                {(
                  [
                    { id: "owner", label: "Customer group", hint: "Owner + Stayful team" },
                    { id: "internal", label: "Internal channel", hint: "Stayful team only" },
                  ] as { id: "owner" | "internal"; label: string; hint: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    aria-pressed={type === t.id}
                    className="flex-1 rounded-lg border px-3 py-2 text-left"
                    style={{
                      borderColor: type === t.id ? "var(--brand)" : "var(--input-border)",
                      background: type === t.id ? "rgba(93,129,86,.10)" : "transparent",
                    }}
                  >
                    <span className="block text-[15px] font-semibold">{t.label}</span>
                    <span className="block text-[13px] text-muted">{t.hint}</span>
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="mb-1 block text-[14px] font-semibold">Name</span>
                <div className="flex h-11 items-center gap-2 rounded-lg border border-input-border bg-input px-3 text-muted">
                  <Icon name="lock" size={16} />
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. nigel-hyde"
                    aria-label="Group name"
                    maxLength={80}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
                  />
                </div>
                <span className="mt-1 block text-[12px] text-muted">
                  Lower-case with dashes, like the Slack channels: {name.trim() ? slugify(name) : "first-last"}
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-[14px] font-semibold">Topic (optional)</span>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What this group is for"
                  aria-label="Topic"
                  maxLength={200}
                  className="h-11 w-full rounded-lg border border-input-border bg-input px-3 text-[16px] text-ink outline-none"
                />
              </label>
              <span className="text-[14px] font-semibold">Add people</span>
            </>
          )}

          <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-input-border bg-input px-2 py-1.5 text-muted focus-within:border-muted">
            <span className="pl-1 text-[15px] font-semibold text-muted">To:</span>
            {picked.map((p) => (
              <span
                key={p.id}
                className="flex h-8 items-center gap-1.5 rounded-full bg-soft pr-1 pl-1 text-[14px] font-semibold text-ink"
              >
                <Avatar profile={p} size={22} radius={11} />
                {p.display_name}
                <button
                  type="button"
                  onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-hover"
                  aria-label={`Remove ${p.display_name}`}
                >
                  <Icon name="close" size={12} strokeWidth={2.4} />
                </button>
              </span>
            ))}
            <input
              autoFocus={tab === "people"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length && query) {
                  e.preventDefault();
                  setPicked((prev) => [...prev, results[0]]);
                  setQ("");
                } else if (e.key === "Backspace" && !q && picked.length) {
                  setPicked((prev) => prev.slice(0, -1));
                }
              }}
              placeholder={picked.length ? "Add someone else" : "Type a name"}
              aria-label="Find people"
              className="h-8 min-w-[140px] flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
            />
          </div>
        </div>

        <div className="scroll-thin mt-2 min-h-0 max-h-[40vh] flex-1 overflow-y-auto pb-2">
          {results.length === 0 && (
            <p className="px-5 py-4 text-[15px] text-muted md:px-6">
              {people.length === 0
                ? "There is nobody else to message yet."
                : query
                  ? "Nobody matches that name."
                  : "Everyone is already added."}
            </p>
          )}
          {results.map((p) => {
            const look = presenceLook(p, isOnline(p.id));
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPicked((prev) => [...prev, p]);
                  setQ("");
                }}
                className="flex w-full items-center gap-3 border-0 bg-transparent px-5 py-2 text-left text-ink hover:bg-hover md:px-6"
              >
                <span className="relative">
                  <Avatar profile={p} size={36} radius={8} />
                  <span
                    className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-panel"
                    style={{ background: look.bg === "transparent" ? "var(--panel)" : look.bg, boxShadow: look.ring }}
                  />
                </span>
                <span className="text-[16px] font-bold">{p.display_name}</span>
                <span className="truncate text-[15px] text-muted">{p.full_name}</span>
                {p.account_type === "team" ? (
                  <span className="ml-auto rounded bg-soft px-1.5 py-0.5 text-[12px] font-semibold text-link">
                    Stayful
                  </span>
                ) : (
                  <span className="ml-auto text-[12px] font-semibold text-muted">Owner</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-5 py-4 md:px-6">
          {error && (
            <p role="alert" className="min-w-0 flex-1 text-[14px] font-medium text-new">
              {error}
            </p>
          )}
          {!error && tab === "people" && picked.length > 1 && !isTeam && (
            <p className="min-w-0 flex-1 text-[14px] text-muted">Only the Stayful team can start group messages.</p>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => (tab === "group" ? void createGroup() : void startConversation())}
            disabled={!canSubmit || busy || (tab === "people" && picked.length > 1 && !isTeam)}
            className="h-11 rounded-lg px-4 text-[15px] font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--brand)" }}
          >
            {busy ? "One moment…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
