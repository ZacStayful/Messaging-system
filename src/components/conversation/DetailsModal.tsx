"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationSummary, Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { useStore, type NotifyLevel } from "@/components/shell/store";
import { presenceLook } from "@/lib/presence";
import { longDate } from "@/lib/format";
import { NOTIFY_LABELS } from "./Header";

export type DetailTab = "about" | "members" | "settings";

interface DetailsModalProps {
  conversation: ConversationSummary;
  title: string;
  createdAt: string;
  description: string | null;
  initialTab: DetailTab;
  onClose: () => void;
}

const chip = "flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-[15px] font-medium";
const input =
  "w-full rounded-lg border border-input-border bg-input px-3 py-2 text-[16px] text-ink outline-none focus:border-brand";
const primary = "h-10 rounded-lg px-3.5 text-[15px] font-semibold text-white disabled:opacity-50";
const secondary =
  "h-10 rounded-lg border border-input-border px-3.5 text-[15px] font-semibold text-ink hover:bg-hover disabled:opacity-50";

export function DetailsModal({ conversation, title, createdAt, description, initialTab, onClose }: DetailsModalProps) {
  const {
    me,
    org,
    profiles,
    presenceOf,
    openProfile,
    isTeam,
    isAdmin,
    openDm,
    refresh,
    setNotifyLevel,
    toggleMute,
    toggleStar,
  } = useStore();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const isChannel = conversation.type !== "dm" && conversation.type !== "group_dm";
  const canManage = isTeam && conversation.type !== "dm";
  const [tab, setTab] = useState<DetailTab>(initialTab === "settings" && !canManage ? "about" : initialTab);
  const [q, setQ] = useState("");
  const [memberFilter, setMemberFilter] = useState<"all" | "team" | "owners">("all");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // editable fields
  const [topic, setTopic] = useState(conversation.topic ?? "");
  const [desc, setDesc] = useState(description ?? "");
  const [name, setName] = useState(conversation.name ?? "");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [addQuery, setAddQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const members = conversation.member_ids.map((id) => profiles[id]).filter((p): p is Profile => !!p);
  const filtered = members.filter(
    (p) =>
      (!q || `${p.display_name} ${p.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) &&
      (memberFilter === "all" || (memberFilter === "team" ? p.account_type === "team" : p.account_type === "customer")),
  );
  const candidates = Object.values(profiles)
    .filter((p) => !conversation.member_ids.includes(p.id) && !p.deactivated_at)
    .filter((p) => conversation.type !== "internal" || p.account_type === "team")
    .filter(
      (p) =>
        !addQuery ||
        `${p.display_name} ${p.full_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(addQuery.toLowerCase()),
    )
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "about", label: "About" },
    { id: "members", label: "Members", count: members.length },
    ...(canManage && isChannel ? [{ id: "settings" as DetailTab, label: "Settings" }] : []),
  ];

  const canDm = (p: Profile) => p.id !== me.id;
  const goDm = async (p: Profile) => {
    if (!canDm(p)) return;
    const id = await openDm(p.id);
    if (id) {
      onClose();
      router.push(`/dms/${id}`);
    }
  };

  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>, okMessage?: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const { error } = await fn();
    setBusy(null);
    if (error) setError(error.message);
    else {
      if (okMessage) setDone(okMessage);
      refresh();
    }
    return !error;
  };

  const saveDetails = () =>
    run(
      "details",
      () =>
        supabase.rpc("set_channel_details", {
          p_conversation_id: conversation.id,
          p_topic: topic,
          p_description: desc,
        }),
      "Saved",
    );
  const rename = () =>
    run(
      "rename",
      () => supabase.rpc("rename_channel", { p_conversation_id: conversation.id, p_name: name }),
      "Renamed",
    );
  const archive = async () => {
    const ok = await run("archive", () =>
      supabase.rpc("archive_channel", { p_conversation_id: conversation.id, p_archived: !conversation.archived_at }),
    );
    if (ok) onClose();
  };
  const addPeople = async () => {
    if (!picked.length) return;
    const ok = await run(
      "add",
      () => supabase.rpc("add_members", { p_conversation_id: conversation.id, p_user_ids: picked }),
      "Added",
    );
    if (ok) {
      setPicked([]);
      setAdding(false);
    }
  };
  const removePerson = (uid: string) =>
    run(`remove:${uid}`, () => supabase.rpc("remove_member", { p_conversation_id: conversation.id, p_user_id: uid }));
  const leave = async () => {
    const ok = await run("leave", () =>
      supabase.rpc("remove_member", { p_conversation_id: conversation.id, p_user_id: me.id }),
    );
    if (ok) {
      onClose();
      router.push("/home");
    }
  };

  const level = (conversation.notify_level as NotifyLevel) || "all";

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-overlay p-3 md:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-[860px] flex-col overflow-hidden rounded-[14px] bg-panel text-ink shadow-[0_20px_60px_rgba(0,0,0,.35)]"
      >
        <div className="flex items-center gap-2 px-5 pt-5 md:px-6 md:pt-[22px]">
          {isChannel && <Icon name="lock" size={22} strokeWidth={2.4} />}
          <span className="flex-1 truncate text-[22px] font-bold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-hover"
            aria-label="Close"
          >
            <Icon name="close" strokeWidth={2} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 px-5 pt-3.5 md:px-6">
          <button
            type="button"
            onClick={() => void toggleStar(conversation.id)}
            className={chip}
            aria-pressed={conversation.starred}
          >
            <Icon
              name="star"
              size={18}
              filled={conversation.starred}
              style={conversation.starred ? { color: "#E2A13A" } : undefined}
            />
            {conversation.starred ? "Starred" : "Star"}
          </button>
          <div className="relative">
            <button type="button" onClick={() => setNotifyOpen((v) => !v)} className={chip} aria-expanded={notifyOpen}>
              <Icon name={conversation.muted || level === "none" ? "bellOff" : "bell"} size={18} />
              {conversation.muted ? "Muted" : NOTIFY_LABELS[level]}
              <Icon name="chevronDown" size={14} strokeWidth={2} />
            </button>
            {notifyOpen && (
              <Menu
                label="Notification preferences"
                header="Notify me about"
                align="left"
                items={[
                  ...(["all", "mentions", "none"] as NotifyLevel[]).map((l) => ({
                    id: l,
                    label: NOTIFY_LABELS[l],
                    checked: level === l,
                    onSelect: () => void setNotifyLevel(conversation.id, l),
                  })),
                  "divider",
                  {
                    id: "mute",
                    label: conversation.muted ? "Unmute" : "Mute conversation",
                    icon: "bellOff",
                    onSelect: () => void toggleMute(conversation.id),
                  },
                ]}
                onClose={() => setNotifyOpen(false)}
              />
            )}
          </div>
          {canManage && isChannel && (
            <button
              type="button"
              onClick={() => {
                setTab("members");
                setAdding(true);
              }}
              className={chip}
            >
              <Icon name="userPlus" size={18} /> Add people
            </button>
          )}
        </div>
        <div className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-5 pt-3 md:px-6">
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 border-0 border-b-[3px] bg-transparent px-2.5 pt-2 pb-2.5 text-[16px] whitespace-nowrap"
                style={{
                  borderBottomColor: on ? "var(--tab)" : "transparent",
                  color: on ? "var(--text)" : "var(--muted)",
                  fontWeight: on ? 700 : 500,
                }}
                aria-selected={on}
                role="tab"
              >
                {t.label}
                {t.count ? <span className="font-medium text-muted">{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        {(error || done) && (
          <p role="status" className={`mx-5 mt-3 text-[14px] md:mx-6 ${error ? "alert-error" : "text-link"}`}>
            {error ?? done}
          </p>
        )}

        {tab === "members" && (
          <>
            <div className="flex gap-3 px-5 py-4 md:px-6">
              <div className="flex h-11 flex-1 items-center gap-2.5 rounded-lg border border-input-border bg-input px-3 text-muted">
                <Icon name="search" size={18} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find people"
                  aria-label="Find people"
                  className="flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
                />
              </div>
              <select
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value as typeof memberFilter)}
                aria-label="Filter members"
                className="hidden h-11 rounded-lg border border-input-border bg-input px-3 text-[15px] text-ink sm:block"
              >
                <option value="all">Everyone</option>
                <option value="team">Stayful team</option>
                <option value="owners">Owners</option>
              </select>
              {canManage && isChannel && (
                <button type="button" onClick={() => setAdding((v) => !v)} className={secondary}>
                  {adding ? "Done" : "Add people"}
                </button>
              )}
            </div>
            {adding && (
              <div className="mx-5 mb-3 rounded-xl border border-line bg-card p-3 md:mx-6">
                <input
                  autoFocus
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search everyone in Stayful"
                  aria-label="Search people to add"
                  className={input}
                />
                <div className="scroll-thin mt-2 max-h-[180px] overflow-y-auto">
                  {candidates.length === 0 && (
                    <p className="px-1 py-2 text-[14px] text-muted">Everyone is already here.</p>
                  )}
                  {candidates.map((p) => {
                    const on = picked.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 hover:bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setPicked((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                          className="accent-[#5D8156]"
                        />
                        <Avatar profile={p} size={28} radius={7} />
                        <span className="text-[15px] font-semibold">{p.display_name}</span>
                        <span className="truncate text-[14px] text-muted">{p.full_name}</span>
                        <span className="ml-auto text-[12px] font-semibold text-muted">
                          {p.account_type === "team" ? "Stayful" : "Owner"}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void addPeople()}
                    disabled={!picked.length || busy === "add"}
                    className={primary}
                    style={{ background: "var(--brand)" }}
                  >
                    {busy === "add" ? "Adding…" : `Add ${picked.length || ""}`.trim()}
                  </button>
                </div>
              </div>
            )}
            <div className="scroll-thin min-h-0 max-h-[52vh] overflow-y-auto pb-2">
              {filtered.map((p) => {
                const look = presenceLook(presenceOf(p.id));
                return (
                  <div key={p.id} className="flex items-center gap-3.5 px-5 py-2 hover:bg-hover md:px-6">
                    <button
                      type="button"
                      onClick={openProfile(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-3.5 border-0 bg-transparent text-left text-ink"
                      aria-label={`Profile: ${p.display_name}`}
                    >
                      <Avatar profile={p} size={40} radius={8} />
                      <span className="text-[16px] font-bold">{p.display_name}</span>
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: look.bg, boxShadow: look.ring }}
                      />
                      <span className="truncate text-[16px] text-muted">{p.full_name}</span>
                      {p.id === me.id && <span className="text-[14px] text-muted">(you)</span>}
                    </button>
                    {canDm(p) && (
                      <button
                        type="button"
                        onClick={() => void goDm(p)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-hover hover:text-ink"
                        aria-label={`Message ${p.display_name}`}
                        title="Message"
                      >
                        <Icon name="dms" size={18} />
                      </button>
                    )}
                    {p.account_type === "team" ? (
                      <span className="rounded bg-soft px-1.5 py-0.5 text-[12px] font-semibold text-link">Stayful</span>
                    ) : (
                      <span className="text-[12px] font-semibold text-muted">Owner</span>
                    )}
                    {canManage && isChannel && p.id !== me.id && (
                      <button
                        type="button"
                        onClick={() => void removePerson(p.id)}
                        disabled={busy === `remove:${p.id}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-new"
                        aria-label={`Remove ${p.display_name}`}
                        title="Remove from group"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {canManage && conversation.type !== "dm" && (
              <div className="border-t border-line px-5 py-3 md:px-6">
                <button
                  type="button"
                  onClick={() => void leave()}
                  disabled={busy === "leave"}
                  className="text-[15px] font-semibold text-new hover:underline"
                >
                  Leave {isChannel ? "group" : "group message"}
                </button>
              </div>
            )}
          </>
        )}

        {tab === "about" && (
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5 md:px-6 md:pb-6">
            {canManage && isChannel ? (
              <>
                <label className="rounded-xl border border-line px-4 py-3.5">
                  <span className="mb-1 block text-[15px] font-semibold">Topic</span>
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    maxLength={200}
                    placeholder="What this group is about right now"
                    className={input}
                  />
                </label>
                <label className="rounded-xl border border-line px-4 py-3.5">
                  <span className="mb-1 block text-[15px] font-semibold">Description</span>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Longer description for members"
                    className={`${input} resize-y`}
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveDetails()}
                    disabled={busy === "details"}
                    className={primary}
                    style={{ background: "var(--brand)" }}
                  >
                    {busy === "details" ? "Saving…" : "Save"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-line px-4 py-3.5">
                  <div className="mb-1 text-[15px] font-semibold">Topic</div>
                  <div className="text-[16px] text-muted">{conversation.topic || "No topic set"}</div>
                </div>
                <div className="rounded-xl border border-line px-4 py-3.5">
                  <div className="mb-1 text-[15px] font-semibold">Description</div>
                  <div className="text-[16px] text-muted">
                    {description ||
                      (isChannel
                        ? "Private conversation between the Stayful team and the property owner. Onboarding, bookings and maintenance updates live here."
                        : "Direct messages between you and the people listed under Members.")}
                  </div>
                </div>
              </>
            )}
            <div className="rounded-xl border border-line px-4 py-3.5">
              <div className="mb-1 text-[15px] font-semibold">Managed by</div>
              <div className="text-[16px] text-muted">
                {org.name} · created {longDate(createdAt)}
                {conversation.archived_at ? ` · archived ${longDate(conversation.archived_at)}` : ""}
              </div>
            </div>
          </div>
        )}

        {tab === "settings" && canManage && isChannel && (
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5 md:px-6 md:pb-6">
            <div className="rounded-xl border border-line px-4 py-3.5">
              <div className="mb-1 text-[15px] font-semibold">Group name</div>
              <div className="flex gap-2">
                <div className="flex h-11 flex-1 items-center gap-2 rounded-lg border border-input-border bg-input px-3">
                  <Icon name="lock" size={16} className="text-muted" />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="Group name"
                    maxLength={80}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void rename()}
                  disabled={busy === "rename" || !name.trim() || name.trim() === conversation.name}
                  className={secondary}
                >
                  Rename
                </button>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                Lower-case with dashes; everyone sees a system message when it changes.
              </p>
            </div>
            <div className="rounded-xl border border-line px-4 py-3.5">
              <div className="mb-1 text-[15px] font-semibold">
                {conversation.archived_at ? "Un-archive" : "Archive"} this group
              </div>
              <p className="mb-2 text-[14px] text-muted">
                {conversation.archived_at
                  ? "Bring the group back into the sidebar so people can post again."
                  : "Archived groups are hidden from the sidebar and become read-only. Nothing is deleted and you can un-archive later."}
              </p>
              <button
                type="button"
                onClick={() => void archive()}
                disabled={busy === "archive"}
                className={conversation.archived_at ? secondary : `${primary} bg-new`}
              >
                {busy === "archive" ? "One moment…" : conversation.archived_at ? "Un-archive group" : "Archive group"}
              </button>
            </div>
            {isAdmin && <p className="text-[13px] text-muted">Admins can also remove members from the Members tab.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
