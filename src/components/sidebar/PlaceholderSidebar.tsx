"use client";

import type { Nav } from "@/components/shell/store";

const COPY: Partial<Record<Nav, { title: string; hint: string }>> = {
  files: { title: "Files", hint: "Files shared across your conversations will appear here." },
  later: { title: "Later", hint: "Save messages for later and they will show up here." },
  agents: { title: "Agents & tools", hint: "Automations and connected tools for the Stayful workspace." },
};

export function PlaceholderSidebar({ nav }: { nav: Nav }) {
  const copy = COPY[nav] ?? { title: "Stayful", hint: "" };
  return (
    <>
      <div className="flex h-[50px] shrink-0 items-center px-4 text-[18px] font-bold">{copy.title}</div>
      <p className="px-4 py-2 text-[14px] text-sb-dim">{copy.hint}</p>
    </>
  );
}
