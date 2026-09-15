"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationSummary, Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";
import { presenceLook } from "@/lib/presence";
import { longDate } from "@/lib/format";

export type DetailTab = "about" | "members" | "agents" | "automations" | "tabs" | "settings";

interface DetailsModalProps {
  conversation: ConversationSummary;
  title: string;
  createdAt: string;
  description: string | null;
  initialTab: DetailTab;
  onClose: () => void;
}

const OTHER_TEXT: Record<string, string> = {
  agents: "No agents or apps added to this conversation yet.",
  automations: "No automations running here yet.",
  tabs: "Messages, Files and links, Pins.",
  settings: "Only workspace admins can change these settings.",
};

const chip = "flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-[15px] font-medium";

export function DetailsModal({ conversation, title, createdAt, description, initialTab, onClose }: DetailsModalProps) {
  const { me, org, profiles, isOnline, openDm } = useStore();
  const router = useRouter();
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const [q, setQ] = useState("");
  const isChannel = conversation.type !== "dm" && conversation.type !== "group_dm";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const members = conversation.member_ids.map((id) => profiles[id]).filter((p): p is Profile => !!p);
  const filtered = members.filter(
    (p) => !q || `${p.display_name} ${p.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: "about", label: "About" },
    { id: "members", label: "Members", count: members.length },
    { id: "agents", label: "Agents and apps" },
    { id: "automations", label: "Automations" },
    { id: "tabs", label: "Tabs" },
    { id: "settings", label: "Settings" },
  ];

  const canDm = (p: Profile) => p.id !== me.id && (me.account_type === "team" || p.account_type === "team");

  const goDm = async (p: Profile) => {
    if (!canDm(p)) return;
    const id = await openDm(p.id);
    if (id) {
      onClose();
      router.push(`/dms/${id}`);
    }
  };

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
          <span className={chip}>
            <Icon name="filter" size={18} />
            <Icon name="chevronDown" size={14} strokeWidth={2} />
          </span>
          <span className={chip}>
            <Icon name="bell" size={18} />
            {conversation.muted ? "Muted" : "Just mentions"}
            <Icon name="chevronDown" size={14} strokeWidth={2} />
          </span>
          <span className={chip} title="Calls are coming in a later release">
            <Icon name="huddle" size={18} />
            Huddle
          </span>
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

        {tab === "members" && (
          <>
            <div className="flex gap-3 px-5 py-4 md:px-6">
              <div className="flex h-11 flex-1 items-center gap-2.5 rounded-lg border border-input-border bg-input px-3 text-muted">
                <Icon name="search" size={18} />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find people or agents"
                  aria-label="Find people"
                  className="flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
                />
              </div>
              <span className="hidden h-11 w-[200px] max-w-[35%] items-center justify-between rounded-lg border border-input-border px-3 text-[16px] sm:flex">
                All <Icon name="chevronDown" size={14} strokeWidth={2} />
              </span>
            </div>
            <div className="scroll-thin min-h-0 max-h-[52vh] overflow-y-auto pb-2">
              {filtered.map((p) => {
                const look = presenceLook(p, isOnline(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => goDm(p)}
                    disabled={!canDm(p)}
                    className="flex w-full items-center gap-3.5 border-0 bg-transparent px-5 py-2.5 text-left text-ink hover:bg-hover disabled:cursor-default md:px-6"
                  >
                    <Avatar profile={p} size={40} radius={8} />
                    <span className="text-[16px] font-bold">{p.display_name}</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: look.bg, boxShadow: look.ring }} />
                    <span className="truncate text-[16px] text-muted">{p.full_name}</span>
                    {p.id === me.id && <span className="text-[14px] text-muted">(you)</span>}
                    {p.account_type === "team" && (
                      <span className="ml-auto rounded bg-soft px-1.5 py-0.5 text-[12px] font-semibold text-link">
                        Stayful
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === "about" && (
          <div className="flex flex-col gap-3 px-5 pt-4 pb-5 md:px-6 md:pb-6">
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
                    : "Direct messages between you and one other person.")}
              </div>
            </div>
            <div className="rounded-xl border border-line px-4 py-3.5">
              <div className="mb-1 text-[15px] font-semibold">Managed by</div>
              <div className="text-[16px] text-muted">
                {org.name} · created {longDate(createdAt)}
              </div>
            </div>
          </div>
        )}

        {tab !== "members" && tab !== "about" && (
          <div className="px-6 pt-8 pb-10 text-center text-[16px] text-muted">{OTHER_TEXT[tab]}</div>
        )}
      </div>
    </div>
  );
}
