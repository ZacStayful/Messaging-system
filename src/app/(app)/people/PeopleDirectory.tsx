"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { ROLE_LABEL, activeStatus, dndActive, presenceLook, presenceText } from "@/lib/presence";
import { grantPortalAccess } from "./actions";

type Chip = "All" | "Stayful team" | "Owners";
const chipCls = "flex h-[34px] items-center gap-1.5 rounded-lg px-3.5 text-[15px]";

export function PeopleDirectory() {
  const { profiles, me, presenceOf, openProfile, openDm, isAdmin } = useStore();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<Chip>("All");
  // Per-person, because granting access is one deliberate act at a time and its result — a
  // password to pass on when email is not configured — belongs beside the person it is for.
  const [granting, setGranting] = useState<string | null>(null);
  const [granted, setGranted] = useState<Record<string, string>>({});
  const needle = q.trim().toLowerCase();

  const people = Object.values(profiles)
    .filter((p) => !p.deactivated_at)
    .filter((p) => chip === "All" || (chip === "Stayful team" ? p.account_type === "team" : p.account_type !== "team"))
    .filter((p) => !needle || `${p.display_name} ${p.full_name ?? ""} ${p.email}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const ao = presenceOf(a.id) === "offline" ? 1 : 0;
      const bo = presenceOf(b.id) === "offline" ? 1 : 0;
      return ao - bo || a.display_name.localeCompare(b.display_name);
    });

  const message = async (id: string) => {
    const cid = await openDm(id);
    if (cid) router.push(`/dms/${cid}`);
  };

  const grant = async (id: string, name: string) => {
    setGranting(id);
    const result = await grantPortalAccess(id);
    setGranting(null);
    setGranted((g) => ({
      ...g,
      [id]: !result.ok
        ? (result.error ?? "That did not work.")
        : result.emailed
          ? `Login details emailed to ${name}.`
          : `Access granted. Password for ${name}: ${result.password}`,
    }));
    if (result.ok) router.refresh();
  };

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-4 py-4 md:px-8 md:py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link
            href="/home"
            className="flex h-10 w-10 items-center justify-center text-ink md:hidden"
            aria-label="Back"
          >
            <Icon name="back" size={24} strokeWidth={2} />
          </Link>
          <h1 className="font-display text-[22px] font-bold">People</h1>
          <div className="flex-1" />
          <Link
            href="/customers/new"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[14px] font-semibold text-ink no-underline hover:bg-hover"
          >
            <Icon name="userPlus" size={16} /> Invite a customer
          </Link>
          {isAdmin && (
            <Link
              href="/team/new"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[14px] font-semibold text-ink no-underline hover:bg-hover"
            >
              <Icon name="people" size={16} /> Add a team member
            </Link>
          )}
        </div>
        <div className="mb-3 flex h-11 items-center gap-2 rounded-lg border border-input-border bg-input px-3">
          <Icon name="search" size={18} className="text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search people"
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
          />
        </div>
        <div className="mb-4 flex gap-1.5" role="tablist">
          {(["All", "Stayful team", "Owners"] as Chip[]).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={chip === c}
              onClick={() => setChip(c)}
              className={chipCls}
              style={{
                background: chip === c ? "var(--soft)" : "transparent",
                border: "1px solid var(--line)",
                fontWeight: chip === c ? 700 : 500,
              }}
            >
              {c}
            </button>
          ))}
          <span className="ml-auto self-center text-[14px] text-muted">{people.length} people</span>
        </div>

        <ul className="m-0 flex list-none flex-col p-0">
          {people.map((p) => {
            const status = presenceOf(p.id);
            const custom = activeStatus(p);
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5">
                <button
                  type="button"
                  onClick={openProfile(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent text-left text-ink"
                  aria-label={`Profile: ${p.display_name}`}
                >
                  <span className="relative shrink-0">
                    <Avatar profile={p} size={44} radius={10} />
                    <PresenceDot look={presenceLook(status)} size={12} border="var(--panel)" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[16px] font-bold">{p.display_name}</span>
                      {p.id === me.id && <span className="text-[13px] text-muted">(you)</span>}
                      {custom?.emoji && <span title={custom.text}>{custom.emoji}</span>}
                      {dndActive(p) && <Icon name="bellOff" size={14} className="text-muted" />}
                    </span>
                    <span className="block truncate text-[14px] text-muted">
                      {p.full_name && p.full_name !== p.display_name ? `${p.full_name} · ` : ""}
                      {ROLE_LABEL[p.role] ?? p.role} · {presenceText(status, p)}
                      {custom?.text ? ` · ${custom.text}` : ""}
                    </span>
                  </span>
                </button>
                {!p.portal_access && (
                  <span
                    className="hidden rounded px-1.5 py-0.5 text-[12px] font-semibold text-muted md:block"
                    title="On file from an import: their history is here, but they cannot sign in yet."
                  >
                    Dormant
                  </span>
                )}
                <span
                  className={`hidden rounded px-1.5 py-0.5 text-[12px] font-semibold md:block ${p.account_type === "team" ? "bg-soft text-link" : "text-muted"}`}
                >
                  {p.account_type === "team" ? "Stayful" : "Owner"}
                </span>
                {isAdmin && !p.portal_access && (
                  <button
                    type="button"
                    onClick={() => void grant(p.id, p.display_name)}
                    disabled={granting === p.id}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[14px] font-semibold hover:bg-hover disabled:opacity-60"
                    aria-label={`Grant access to ${p.display_name}`}
                  >
                    <Icon name="userPlus" size={16} />
                    <span className="hidden md:inline">{granting === p.id ? "Granting…" : "Grant access"}</span>
                  </button>
                )}
                {p.id !== me.id && (
                  <button
                    type="button"
                    onClick={() => void message(p.id)}
                    className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[14px] font-semibold hover:bg-hover"
                    aria-label={`Message ${p.display_name}`}
                  >
                    <Icon name="dms" size={16} /> <span className="hidden md:inline">Message</span>
                  </button>
                )}
                {granted[p.id] && (
                  <span className="basis-full text-[13px] text-muted md:basis-auto">{granted[p.id]}</span>
                )}
              </li>
            );
          })}
          {people.length === 0 && <li className="py-8 text-center text-[15px] text-muted">Nobody matches.</li>}
        </ul>
      </div>
    </div>
  );
}
