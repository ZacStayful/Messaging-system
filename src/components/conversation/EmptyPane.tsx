"use client";

import Image from "next/image";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";

const TITLES: Record<string, string> = {
  dms: "Pick a direct message",
  home: "Pick a conversation",
  activity: "Your activity",
  files: "Files",
  later: "Later",
  agents: "Agents & tools",
  you: "You",
};

export function EmptyPane({ nav }: { nav: string }) {
  const { openNewMessage, me } = useStore();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted">
      <Image src="/brand/stayful-logo.png" alt="" width={56} height={56} className="h-14 w-14 rounded-2xl opacity-80" />
      <div className="text-[16px] font-semibold text-ink">{TITLES[nav] ?? "Stayful"}</div>
      <p className="max-w-sm text-[15px]">Choose something from the list on the left to start reading and replying.</p>
      {(nav === "dms" || nav === "home") && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => openNewMessage("people")}
            className="flex h-10 items-center gap-2 rounded-lg px-3.5 text-[15px] font-semibold text-white"
            style={{ background: "var(--brand)" }}
          >
            <Icon name="pencil" size={18} /> New message
          </button>
          {me.account_type === "team" && (
            <button
              type="button"
              onClick={() => openNewMessage("group")}
              className="flex h-10 items-center gap-2 rounded-lg border border-input-border px-3.5 text-[15px] font-semibold text-ink"
            >
              <Icon name="plus" size={18} strokeWidth={2} /> New group
            </button>
          )}
        </div>
      )}
    </div>
  );
}
