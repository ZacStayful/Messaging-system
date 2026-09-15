"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore, lastMessagePreview } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { Icon } from "@/components/ui/Icon";
import { listTime } from "@/lib/format";
import { presenceLook } from "@/lib/presence";
import { useDraftIds } from "@/lib/drafts";
import { SearchLink, SidebarHeader, SidebarSearch, UnreadToggle, iconBtn } from "./SidebarBits";
import { ThreadsRow } from "./ThreadsRow";

export function DmList() {
  const { conversations, me, otherMember, conversationName, isOnline, activeConversationId, nav, openNewMessage } =
    useStore();
  const [filter, setFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const dms = useMemo(() => conversations.filter((c) => c.type === "dm" || c.type === "group_dm"), [conversations]);
  const ids = useMemo(() => dms.map((d) => d.id), [dms]);
  const drafts = useDraftIds(ids);

  const q = filter.trim().toLowerCase();
  const rows = dms.filter((c) => {
    if (unreadOnly && !c.unread_count) return false;
    if (!q) return true;
    const other = otherMember(c);
    return `${conversationName(c)} ${other?.full_name ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <>
      <SidebarHeader title="Direct messages">
        <UnreadToggle on={unreadOnly} onToggle={() => setUnreadOnly((v) => !v)} />
        <SearchLink />
        <button
          type="button"
          onClick={() => openNewMessage("people")}
          className={iconBtn}
          aria-label="New message"
          title="New message"
        >
          <Icon name="pencil" />
        </button>
      </SidebarHeader>
      <SidebarSearch value={filter} onChange={setFilter} placeholder="Find a DM..." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!q && !unreadOnly && <ThreadsRow />}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-[15px] text-sb-dim">
            <p>
              {unreadOnly
                ? "You're all caught up."
                : dms.length === 0
                  ? "No direct messages yet."
                  : "No direct messages match."}
            </p>
            {dms.length === 0 && !unreadOnly && (
              <button
                type="button"
                onClick={() => openNewMessage("people")}
                className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-sb-border bg-sb-input px-3 text-[15px] font-semibold text-sb-text"
              >
                <Icon name="pencil" size={18} /> New message
              </button>
            )}
          </div>
        )}
        {rows.map((c) => {
          const other = otherMember(c);
          const selected = activeConversationId === c.id && nav === "dms";
          const isSelf = other?.id === me.id;
          const look = presenceLook(other, !!other && isOnline(other.id));
          const preview = lastMessagePreview(c, me.id);
          return (
            <Link
              key={c.id}
              href={`/dms/${c.id}`}
              className="sb-row text-sb-text no-underline flex gap-2.5 border-t border-sb-border px-3.5 py-3"
              style={selected ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined}
              aria-current={selected ? "page" : undefined}
            >
              <div className="relative h-11 w-11 shrink-0">
                <Avatar profile={other} size={44} radius={10} />
                <PresenceDot look={look} border={selected ? "var(--sb-sel)" : "var(--sb)"} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[16px] font-bold">
                    {other ? other.display_name : conversationName(c)}
                  </span>
                  {isSelf && <span className="text-[15px] opacity-85">(you)</span>}
                  <div className="flex-1" />
                  <span className="text-[14px] whitespace-nowrap opacity-90">{listTime(c.last_message_at)}</span>
                  {drafts.has(c.id) && <Icon name="pencil" size={14} strokeWidth={2} aria-label="Draft" />}
                  <UnreadBadge count={c.unread_count} />
                </div>
                <div className={`clamp-2 text-[15px] leading-[1.45] opacity-95 ${isSelf ? "italic" : ""}`}>
                  {preview}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
