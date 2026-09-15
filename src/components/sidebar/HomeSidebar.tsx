"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore, liveConversations } from "@/components/shell/store";
import type { ConversationSummary } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { Icon } from "@/components/ui/Icon";
import { presenceLook } from "@/lib/presence";
import { useBoolPref } from "@/lib/prefs";
import { SearchLink, SectionHeader, SidebarHeader, SidebarSearch, iconBtn } from "./SidebarBits";
import { ThreadsRow } from "./ThreadsRow";
import { PeopleRow } from "./PeopleRow";
import { ConversationMenu, RowMenuButton, useConversationMenu } from "./ConversationMenu";

function byUnreadThenName(a: ConversationSummary, b: ConversationSummary) {
  const au = a.unread_count > 0 && !a.muted ? 0 : 1;
  const bu = b.unread_count > 0 && !b.muted ? 0 : 1;
  return au - bu || (a.name ?? "").localeCompare(b.name ?? "");
}

export function HomeSidebar() {
  const { conversations, org, me, otherMember, conversationName, presenceOf, activeConversationId, openNewMessage } =
    useStore();
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useBoolPref("home.showArchived", false);
  const [customersCollapsed, setCustomersCollapsed] = useBoolPref("home.customers.collapsed", false);
  const [channelsCollapsed, setChannelsCollapsed] = useBoolPref("home.channels.collapsed", false);
  const [dmsCollapsed, setDmsCollapsed] = useBoolPref("home.dms.collapsed", false);
  const [starredCollapsed, setStarredCollapsed] = useBoolPref("home.starred.collapsed", false);
  const rowMenu = useConversationMenu();
  const q = filter.trim().toLowerCase();

  const live = useMemo(() => liveConversations(conversations, showArchived), [conversations, showArchived]);
  const archivedCount = conversations.filter((c) => c.archived_at).length;
  const starred = useMemo(() => live.filter((c) => c.starred), [live]);
  const customers = useMemo(
    () => live.filter((c) => (c.type === "owner" || c.type === "job") && !c.starred).sort(byUnreadThenName),
    [live],
  );
  const channels = useMemo(
    () => live.filter((c) => c.type === "internal" && !c.starred).sort(byUnreadThenName),
    [live],
  );
  const dms = useMemo(
    () => live.filter((c) => (c.type === "dm" || c.type === "group_dm") && !c.starred).slice(0, 8),
    [live],
  );

  const sel = (id: string) =>
    activeConversationId === id ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined;
  const matches = (c: ConversationSummary) => !q || conversationName(c).toLowerCase().includes(q);

  const channelRow = (c: ConversationSummary) => {
    const unread = c.unread_count > 0 && !c.muted;
    const active = activeConversationId === c.id;
    return (
      <Link
        key={c.id}
        href={`/home/${c.id}`}
        className="sb-row group text-sb-text no-underline flex h-8 items-center gap-2 rounded-md pr-1 pl-3 md:h-8"
        style={{ ...sel(c.id), opacity: c.muted || c.archived_at ? 0.6 : unread || active ? 1 : 0.88 }}
        aria-current={active ? "page" : undefined}
        onContextMenu={rowMenu.openAt(c.id)}
      >
        <Icon name={c.archived_at ? "files" : "lock"} size={15} strokeWidth={2} />
        <span className="flex-1 truncate text-[16px]" style={{ fontWeight: unread ? 700 : 500 }}>
          {c.name}
        </span>
        {c.mention_count > 0 && !c.muted ? <span className="text-[12px] font-bold">@</span> : null}
        {!c.muted && <UnreadBadge count={c.unread_count} className="min-w-[22px]" />}
        <RowMenuButton onOpen={rowMenu.openFrom(c.id)} name={c.name ?? "group"} />
      </Link>
    );
  };

  const dmRow = (c: ConversationSummary) => {
    const other = otherMember(c);
    const active = activeConversationId === c.id;
    const look = presenceLook(other ? presenceOf(other.id) : "offline");
    return (
      <Link
        key={c.id}
        href={`/home/${c.id}`}
        className="sb-row group text-sb-text no-underline flex h-[34px] items-center gap-2.5 rounded-md pr-1 pl-3"
        style={sel(c.id)}
        aria-current={active ? "page" : undefined}
        onContextMenu={rowMenu.openAt(c.id)}
      >
        <span className="relative h-5 w-5 shrink-0">
          <Avatar profile={other} size={20} radius={5} />
          <PresenceDot look={look} size={9} border={active ? "var(--sb-sel)" : "var(--sb)"} />
        </span>
        <span className="flex-1 truncate text-[16px]" style={{ fontWeight: c.unread_count ? 700 : 500 }}>
          {conversationName(c)}
        </span>
        <UnreadBadge count={c.unread_count} className="min-w-[22px]" />
        <RowMenuButton onOpen={rowMenu.openFrom(c.id)} name={conversationName(c)} />
      </Link>
    );
  };

  const row = (c: ConversationSummary) => (c.type === "dm" || c.type === "group_dm" ? dmRow(c) : channelRow(c));

  return (
    <>
      <SidebarHeader title={org.name}>
        <SearchLink />
        {me.account_type === "team" && (
          <>
            <button
              type="button"
              onClick={() => openNewMessage("group")}
              className={iconBtn}
              aria-label="New group"
              title="New group"
            >
              <Icon name="plus" strokeWidth={2} />
            </button>
            <Link
              href="/customers/new"
              className={`${iconBtn} no-underline`}
              aria-label="Invite a customer"
              title="Invite a customer"
            >
              <Icon name="userPlus" />
            </Link>
          </>
        )}
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
        {!q && (
          <div className="pt-1 pb-2">
            <ThreadsRow compact />
            <PeopleRow />
          </div>
        )}
        {starred.length > 0 && (
          <>
            <SectionHeader
              label="Starred"
              collapsed={starredCollapsed}
              onToggle={() => setStarredCollapsed(!starredCollapsed)}
              count={starred.length}
            />
            {!starredCollapsed && starred.filter(matches).map(row)}
          </>
        )}

        <SectionHeader
          label="Customers"
          collapsed={customersCollapsed}
          onToggle={() => setCustomersCollapsed(!customersCollapsed)}
          count={customers.length}
        >
          <button
            type="button"
            onClick={() => openNewMessage("group")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-sb-dim hover:bg-sb-hover"
            aria-label="New customer group"
            title="New customer group"
          >
            <Icon name="plus" size={14} strokeWidth={2} />
          </button>
        </SectionHeader>
        {!customersCollapsed && customers.length === 0 && (
          <p className="px-3 py-2 text-[14px] text-sb-dim">
            No customer groups yet. Use + to create one, or invite a customer.
          </p>
        )}
        {!customersCollapsed && customers.filter(matches).map(channelRow)}

        <SectionHeader
          label="Channels"
          collapsed={channelsCollapsed}
          onToggle={() => setChannelsCollapsed(!channelsCollapsed)}
          count={channels.length}
        />
        {!channelsCollapsed && channels.length === 0 && (
          <p className="px-3 py-2 text-[14px] text-sb-dim">Internal channels for the Stayful team appear here.</p>
        )}
        {!channelsCollapsed && channels.filter(matches).map(channelRow)}

        <SectionHeader
          label="Direct messages"
          collapsed={dmsCollapsed}
          onToggle={() => setDmsCollapsed(!dmsCollapsed)}
          count={dms.length}
        >
          <button
            type="button"
            onClick={() => openNewMessage("people")}
            className="flex h-6 w-6 items-center justify-center rounded-md text-sb-dim hover:bg-sb-hover"
            aria-label="New direct message"
            title="New direct message"
          >
            <Icon name="plus" size={14} strokeWidth={2} />
          </button>
        </SectionHeader>
        {!dmsCollapsed && dms.filter(matches).map(dmRow)}

        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="mt-3 flex items-center gap-2 rounded-md px-3 py-1.5 text-[14px] text-sb-dim hover:bg-sb-hover"
          >
            <Icon name="files" size={15} />
            {showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
          </button>
        )}
      </div>
      <ConversationMenu menu={rowMenu.menu} onClose={rowMenu.close} />
    </>
  );
}
