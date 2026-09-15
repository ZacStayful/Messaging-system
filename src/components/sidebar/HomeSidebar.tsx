"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { Icon } from "@/components/ui/Icon";
import { presenceLook } from "@/lib/presence";
import { SidebarHeader, SidebarSearch, iconBtn } from "./SidebarBits";

export function HomeSidebar() {
  const { conversations, org, otherMember, conversationName, isOnline, activeConversationId } = useStore();
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  const channels = useMemo(
    () =>
      conversations
        .filter((c) => c.type !== "dm" && c.type !== "group_dm")
        .sort((a, b) => {
          const au = a.unread_count > 0 && !a.muted ? 0 : 1;
          const bu = b.unread_count > 0 && !b.muted ? 0 : 1;
          return au - bu || (a.name ?? "").localeCompare(b.name ?? "");
        }),
    [conversations],
  );
  const dms = useMemo(() => conversations.filter((c) => c.type === "dm").slice(0, 5), [conversations]);

  const sel = (id: string) => (activeConversationId === id ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined);

  return (
    <>
      <SidebarHeader title={org.name}>
        <button type="button" className={iconBtn} aria-label="Workspace settings" title="Workspace settings">
          <Icon name="settings" />
        </button>
        <button type="button" className={iconBtn} aria-label="New message" title="New message">
          <Icon name="pencil" />
        </button>
      </SidebarHeader>
      <SidebarSearch value={filter} onChange={setFilter} placeholder="Find a conversation..." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex items-center gap-2 px-2 py-1.5 text-[14px] font-medium text-sb-dim">
          <Icon name="filter" size={16} />
          <span>Customers</span>
          <Icon name="chevronDown" size={14} strokeWidth={2} />
        </div>
        {channels
          .filter((c) => !q || (c.name ?? "").includes(q))
          .map((c) => {
            const unread = c.unread_count > 0 && !c.muted;
            const active = activeConversationId === c.id;
            return (
              <Link
                key={c.id}
                href={`/home/${c.id}`}
                className="sb-row text-sb-text no-underline flex h-8 items-center gap-2 rounded-md pr-2 pl-3 md:h-8"
                style={{ ...sel(c.id), opacity: c.muted ? 0.6 : unread || active ? 1 : 0.88 }}
                aria-current={active ? "page" : undefined}
              >
                <Icon name="lock" size={15} strokeWidth={2} />
                <span className="flex-1 truncate text-[15px]" style={{ fontWeight: unread ? 700 : 500 }}>
                  {c.name}
                </span>
                {!c.muted && <UnreadBadge count={c.unread_count} className="min-w-[22px]" />}
              </Link>
            );
          })}
        <div className="flex items-center gap-2 px-2 pt-3.5 pb-1.5 text-[14px] font-medium text-sb-dim">
          <span>Direct messages</span>
          <Icon name="chevronDown" size={14} strokeWidth={2} />
        </div>
        {dms
          .filter((c) => !q || conversationName(c).toLowerCase().includes(q))
          .map((c) => {
            const other = otherMember(c);
            const active = activeConversationId === c.id;
            const look = presenceLook(other, !!other && isOnline(other.id));
            return (
              <Link
                key={c.id}
                href={`/home/${c.id}`}
                className="sb-row text-sb-text no-underline flex h-[34px] items-center gap-2.5 rounded-md pr-2 pl-3"
                style={sel(c.id)}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative h-5 w-5 shrink-0">
                  <Avatar profile={other} size={20} radius={5} />
                  <PresenceDot look={look} size={9} border={active ? "var(--sb-sel)" : "var(--sb)"} />
                </span>
                <span className="flex-1 truncate text-[15px]" style={{ fontWeight: c.unread_count ? 700 : 500 }}>
                  {conversationName(c)}
                </span>
                <UnreadBadge count={c.unread_count} className="min-w-[22px]" />
              </Link>
            );
          })}
      </div>
    </>
  );
}
