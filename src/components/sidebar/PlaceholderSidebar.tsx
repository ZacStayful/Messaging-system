"use client";

import type { Nav } from "@/components/shell/store";

const COPY: Partial<Record<Nav, { title: string; hint: string }>> = {
  files: {
    title: "Files",
    hint: "Every file shared in your conversations, in one place. Arriving in the next update.",
  },
  later: {
    title: "Later",
    hint: "Messages you save for later and reminders will show up here. Arriving in the next update.",
  },
};

export function PlaceholderSidebar({ nav }: { nav: Nav }) {
  const copy = COPY[nav] ?? { title: "Stayful", hint: "" };
  return (
    <>
      <div className="font-display flex h-[50px] shrink-0 items-center px-4 text-[18px] font-bold">{copy.title}</div>
      <p className="px-4 py-2 text-[15px] text-sb-dim">{copy.hint}</p>
    </>
  );
}
