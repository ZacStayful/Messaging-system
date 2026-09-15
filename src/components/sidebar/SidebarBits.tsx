"use client";

import { Icon } from "@/components/ui/Icon";

export function SidebarHeader({
  title,
  children,
  chevron = true,
}: {
  title: string;
  children?: React.ReactNode;
  chevron?: boolean;
}) {
  return (
    <div className="flex h-[50px] shrink-0 items-center gap-2 pr-3 pl-4 pt-[env(safe-area-inset-top,0px)] md:pt-0">
      <span className="font-display text-[18px] font-bold whitespace-nowrap">{title}</span>
      {chevron && <Icon name="chevronDown" size={16} strokeWidth={2} />}
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

export const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-sb-text hover:bg-sb-hover";
