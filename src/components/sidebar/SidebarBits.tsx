"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { useStore } from "@/components/shell/store";

/** Mobile entry point to the search page (desktop has the top-bar search). */
export function SearchLink() {
  return (
    <Link href="/search" className={`${iconBtn} no-underline md:hidden`} aria-label="Search" title="Search">
      <Icon name="search" />
    </Link>
  );
}

/** Sidebar title that opens the workspace menu, like Slack's workspace switcher. */
export function SidebarHeader({
  title,
  children,
  chevron = true,
}: {
  title: string;
  children?: React.ReactNode;
  chevron?: boolean;
}) {
  const { isTeam, isAdmin } = useStore();
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[15px] font-medium text-ink no-underline hover:bg-hover";
  return (
    <div className="flex h-[50px] shrink-0 items-center gap-2 pr-3 pl-4 pt-[env(safe-area-inset-top,0px)] md:pt-0">
      <div className="relative min-w-0">
        {chevron ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="menu"
            className="flex max-w-full items-center gap-1 rounded-md border-0 bg-transparent px-1 py-0.5 text-sb-text hover:bg-sb-hover"
          >
            <span className="font-display truncate text-[18px] font-bold whitespace-nowrap">{title}</span>
            <Icon name="chevronDown" size={16} strokeWidth={2} />
          </button>
        ) : (
          <span className="font-display px-1 text-[18px] font-bold whitespace-nowrap">{title}</span>
        )}
        {open && (
          <Popover onClose={() => setOpen(false)} label="Workspace menu" below align="left" className="w-[260px] py-1">
            <Link href="/settings/account" onClick={() => setOpen(false)} className={item}>
              <Icon name="settings" size={18} /> Account and preferences
            </Link>
            {isTeam && (
              <Link href="/customers/new" onClick={() => setOpen(false)} className={item}>
                <Icon name="userPlus" size={18} /> Invite a customer
              </Link>
            )}
            {isAdmin && (
              <Link href="/team/new" onClick={() => setOpen(false)} className={item}>
                <Icon name="people" size={18} /> Add a team member
              </Link>
            )}
            <Link href="/search" onClick={() => setOpen(false)} className={`${item} md:hidden`}>
              <Icon name="search" size={18} /> Search
            </Link>
            <div className="my-1 h-px bg-line" />
            <form action="/auth/signout" method="post">
              <button type="submit" className={item}>
                <Icon name="logout" size={18} /> Sign out
              </button>
            </form>
          </Popover>
        )}
      </div>
      <div className="flex-1" />
      {children}
    </div>
  );
}

export function UnreadToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <>
      <span className="hidden min-w-0 truncate text-[14px] font-semibold text-sb-dim sm:inline">Unread messages</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Show unread only"
        onClick={onToggle}
        className="relative h-5 w-9 rounded-[10px] border-2 border-white/70 p-0"
        style={{ background: on ? "#FFFFFF" : "transparent" }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left] duration-150"
          style={{ left: on ? 18 : 2, background: on ? "#3E5A3A" : "#fff" }}
        />
      </button>
    </>
  );
}

export function SidebarSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="mx-3 mt-0.5 mb-2 flex h-9 shrink-0 items-center gap-2 rounded-lg border border-sb-border bg-sb-input px-2.5 text-sb-dim">
      <Icon name="filter" size={18} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-sb-text outline-none"
      />
    </div>
  );
}

/** Collapsible section heading (state persisted per browser). */
export function SectionHeader({
  label,
  collapsed,
  onToggle,
  count,
  children,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  count?: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-1 pt-3 pb-1 text-[15px] font-medium text-sb-dim first:pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-1 py-0.5 text-sb-dim hover:bg-sb-hover"
      >
        <Icon
          name="chevronDown"
          size={14}
          strokeWidth={2}
          style={{ transform: collapsed ? "rotate(-90deg)" : undefined, transition: "transform .12s" }}
        />
        <span className="truncate">{label}</span>
        {collapsed && count ? <span className="text-[13px] opacity-80">{count}</span> : null}
      </button>
      <div className="flex-1" />
      {children}
    </div>
  );
}

export const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-sb-text hover:bg-sb-hover";
