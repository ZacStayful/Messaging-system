"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import type { ConversationSummary, Profile } from "@/lib/database.types";
import { useStore, liveConversations } from "./store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { presenceLook } from "@/lib/presence";

type Hit = { kind: "conversation"; c: ConversationSummary } | { kind: "person"; p: Profile };

/** Ctrl/Cmd+K: jump to any conversation or person. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { conversations, profiles, me, conversationName, otherMember, presenceOf, openDm, isTeam } = useStore();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const needle = q.trim().toLowerCase();

  const convHits: Hit[] = liveConversations(conversations)
    .filter((c) => !needle || conversationName(c).toLowerCase().includes(needle))
    .sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))
    .slice(0, needle ? 6 : 8)
    .map((c) => ({ kind: "conversation", c }));
  const people: Hit[] = needle
    ? Object.values(profiles)
        .filter((p) => p.id !== me.id && !p.deactivated_at && (isTeam || p.account_type === "team" || true))
        .filter((p) => `${p.display_name} ${p.full_name ?? ""}`.toLowerCase().includes(needle))
        .slice(0, 5)
        .map((p) => ({ kind: "person", p }))
    : [];
  const hits = [...convHits, ...people];
  const current = Math.min(index, Math.max(0, hits.length - 1));

  const go = async (h: Hit) => {
    onClose();
    if (h.kind === "conversation") {
      const dm = h.c.type === "dm" || h.c.type === "group_dm";
      router.push(`/${dm ? "dms" : "home"}/${h.c.id}`);
    } else {
      const id = await openDm(h.p.id);
      if (id) router.push(`/dms/${id}`);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      setIndex((current + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[current]) void go(hits[current]);
    } else if (e.key === "Escape") onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Jump to"
        className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-panel text-ink shadow-[0_12px_40px_rgba(0,0,0,.35)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={20} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKey}
            placeholder="Jump to a conversation or person…"
            aria-label="Jump to"
            className="min-w-0 flex-1 border-0 bg-transparent text-[17px] text-ink outline-none"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[12px] text-muted">Esc</kbd>
        </div>
        <ul className="m-0 max-h-[50vh] list-none overflow-y-auto p-1" role="listbox">
          {hits.length === 0 && <li className="px-4 py-6 text-center text-[15px] text-muted">No matches.</li>}
          {hits.map((h, i) => {
            const on = i === current;
            const key = h.kind === "conversation" ? `c:${h.c.id}` : `p:${h.p.id}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => void go(h)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
                  style={on ? { background: "var(--hover)" } : undefined}
                >
                  {h.kind === "conversation" ? (
                    h.c.type === "dm" || h.c.type === "group_dm" ? (
                      <Avatar profile={otherMember(h.c)} size={28} radius={7} />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-soft">
                        <Icon name="lock" size={15} strokeWidth={2} />
                      </span>
                    )
                  ) : (
                    <span className="relative">
                      <Avatar profile={h.p} size={28} radius={7} />
                      <PresenceDot look={presenceLook(presenceOf(h.p.id))} size={10} border="var(--panel)" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
                    {h.kind === "conversation" ? conversationName(h.c) : h.p.display_name}
                  </span>
                  <span className="text-[13px] text-muted">
                    {h.kind === "conversation"
                      ? h.c.type === "dm"
                        ? "Direct message"
                        : h.c.type === "group_dm"
                          ? "Group message"
                          : h.c.archived_at
                            ? "Archived group"
                            : "Group"
                      : h.p.account_type === "team"
                        ? "Stayful · Message"
                        : "Owner · Message"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
