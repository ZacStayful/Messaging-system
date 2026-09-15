"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore, lastMessagePreview, liveConversations } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { Icon } from "@/components/ui/Icon";
import { listTime } from "@/lib/format";
import { presenceLook } from "@/lib/presence";
import { SidebarHeader, SidebarSearch, iconBtn } from "./SidebarBits";

/**
 * The simplified customer view: the groups they have been invited to and their direct
 * messages with people from those groups. Nothing else.
 */
export function CustomerSidebar() {
  const { conversations, org, me, otherMember, conversationName, isOnline, activeConversationId, openNewMessage } =
    useStore();
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const live = liveConversations(conversations);
  const groups = live.filter((c) => c.type !== "dm" && c.type !== "group_dm");
  const dms = live.filter((c) => c.type === "dm" || c.type === "group_dm");
  const sel = (id: string) =>
    activeConversationId === id ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined;

  return (
    <>
      <SidebarHeader title={org.name}>
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
      <SidebarSearch value={filter} onChange={setFilter} placeholder="Find a conversation..." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 py-1.5 text-[15px] font-medium text-sb-dim">Your groups</div>
        {groups.length === 0 && (
          <p className="px-3 py-2 text-[14px] text-sb-dim">
            You haven&apos;t been added to a group yet. Your Stayful contact will invite you.
          </p>
        )}
        {groups
          .filter((c) => !q || (c.name ?? "").includes(q))
          .map((c) => {
            const unread = c.unread_count > 0 && !c.muted;
            return (
              <Link
                key={c.id}
                href={`/home/${c.id}`}
                className="sb-row text-sb-text no-underline flex h-9 items-center gap-2 rounded-md pr-2 pl-3"
                style={{ ...sel(c.id), opacity: c.muted ? 0.6 : 1 }}
                aria-current={activeConversationId === c.id ? "page" : undefined}
              >
                <Icon name="lock" size={15} strokeWidth={2} />
                <span className="flex-1 truncate text-[16px]" style={{ fontWeight: unread ? 700 : 500 }}>
                  {c.name}
                </span>
                {!c.muted && <UnreadBadge count={c.unread_count} className="min-w-[22px]" />}
              </Link>
            );
          })}

        <div className="px-2 pt-3.5 pb-1.5 text-[15px] font-medium text-sb-dim">Direct messages</div>
        {dms.length === 0 && (
          <p className="px-3 py-2 text-[14px] text-sb-dim">
            Message anyone in your groups: open a group, tap the members, or use the pencil above.
          </p>
        )}
        {dms
          .filter((c) => !q || conversationName(c).toLowerCase().includes(q))
          .map((c) => {
            const other = otherMember(c);
            const look = presenceLook(other, !!other && isOnline(other.id));
            const preview = lastMessagePreview(c, me.id);
            return (
              <Link
                key={c.id}
                href={`/dms/${c.id}`}
                className="sb-row text-sb-text no-underline flex items-center gap-2.5 rounded-md px-2 py-2"
                style={sel(c.id)}
                aria-current={activeConversationId === c.id ? "page" : undefined}
              >
                <span className="relative h-9 w-9 shrink-0">
                  <Avatar profile={other} size={36} radius={8} />
                  <PresenceDot
                    look={look}
                    size={10}
                    border={activeConversationId === c.id ? "var(--sb-sel)" : "var(--sb)"}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[16px]" style={{ fontWeight: c.unread_count ? 700 : 500 }}>
                      {conversationName(c)}
                    </span>
                    <span className="ml-auto text-[13px] whitespace-nowrap opacity-90">
                      {listTime(c.last_message_at)}
                    </span>
                  </span>
                  <span className="block truncate text-[14px] opacity-90">{preview}</span>
                </span>
                <UnreadBadge count={c.unread_count} className="min-w-[22px]" />
              </Link>
            );
          })}
      </div>
    </>
  );
}
