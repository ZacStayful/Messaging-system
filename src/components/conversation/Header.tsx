"use client";

import Link from "next/link";
import { useState } from "react";
import type { ConversationSummary, Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { Icon } from "@/components/ui/Icon";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { presenceLook, presenceText } from "@/lib/presence";
import type { NotifyLevel } from "@/components/shell/store";
import type { DetailTab } from "./DetailsModal";
import type { PresenceStatus } from "@/lib/presence";

interface HeaderProps {
  conversation: ConversationSummary;
  title: string;
  other: Profile | undefined;
  otherStatus: PresenceStatus;
  onOpenProfile?: (e: React.MouseEvent<HTMLElement>) => void;
  backHref: string;
  canManage: boolean;
  onOpenDetails: (tab: DetailTab) => void;
  onToggleStar: () => void;
  onToggleMute: () => void;
  onSetNotifyLevel: (level: NotifyLevel) => void;
  onToggleSearch: () => void;
  searchOpen: boolean;
  onLeave: () => void;
  onArchive: () => void;
}

const btn =
  "flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-hover";

export const NOTIFY_LABELS: Record<NotifyLevel, string> = {
  all: "All new messages",
  mentions: "Mentions only",
  none: "Nothing",
};

export function Header({
  conversation,
  title,
  other,
  otherStatus,
  onOpenProfile,
  backHref,
  canManage,
  onOpenDetails,
  onToggleStar,
  onToggleMute,
  onSetNotifyLevel,
  onToggleSearch,
  searchOpen,
  onLeave,
  onArchive,
}: HeaderProps) {
  const isDm = conversation.type === "dm" || conversation.type === "group_dm";
  const look = presenceLook(otherStatus);
  const sub = isDm ? presenceText(otherStatus) : conversation.topic || `${conversation.member_count} members`;
  const [menu, setMenu] = useState<"none" | "more" | "notify">("none");
  const level = (conversation.notify_level as NotifyLevel) || "all";

  const copyLink = () => {
    void navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}`);
  };

  const moreItems: (MenuItem | "divider")[] = [
    { id: "details", label: "Conversation details", icon: "users", onSelect: () => onOpenDetails("about") },
    {
      id: "notify",
      label: "Notification preferences",
      icon: "bell",
      hint: NOTIFY_LABELS[level],
      keepOpen: true,
      onSelect: () => setMenu("notify"),
    },
    {
      id: "star",
      label: conversation.starred ? "Remove from starred" : "Star conversation",
      icon: "star",
      onSelect: onToggleStar,
    },
    {
      id: "mute",
      label: conversation.muted ? "Unmute conversation" : "Mute conversation",
      icon: conversation.muted ? "bell" : "bellOff",
      onSelect: onToggleMute,
    },
    { id: "copy", label: "Copy link", icon: "link", onSelect: copyLink },
  ];
  if (canManage && !isDm) {
    moreItems.push("divider");
    moreItems.push({
      id: "settings",
      label: "Group settings",
      icon: "settings",
      onSelect: () => onOpenDetails("settings"),
    });
    moreItems.push({ id: "members", label: "Add people", icon: "userPlus", onSelect: () => onOpenDetails("members") });
    moreItems.push({ id: "leave", label: "Leave group", icon: "logout", onSelect: onLeave });
    moreItems.push({
      id: "archive",
      label: conversation.archived_at ? "Un-archive group" : "Archive group",
      icon: "files",
      danger: !conversation.archived_at,
      onSelect: onArchive,
    });
  } else if (canManage && conversation.type === "group_dm") {
    moreItems.push("divider");
    moreItems.push({ id: "leave", label: "Leave group message", icon: "logout", onSelect: onLeave });
  }

  const notifyItems: MenuItem[] = (["all", "mentions", "none"] as NotifyLevel[]).map((l) => ({
    id: l,
    label: NOTIFY_LABELS[l],
    checked: level === l,
    onSelect: () => onSetNotifyLevel(l),
  }));

  return (
    <div
      className="flex h-[50px] shrink-0 items-center gap-1 border-b border-line pr-2 pl-1 md:gap-1.5 md:pr-3 md:pl-4"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
    >
      <Link href={backHref} className="flex h-10 w-10 items-center justify-center text-ink md:hidden" aria-label="Back">
        <Icon name="back" size={24} strokeWidth={2} />
      </Link>

      {isDm ? (
        <>
          <button
            type="button"
            onClick={onToggleStar}
            className={`${btn} hidden md:flex`}
            aria-label={conversation.starred ? "Unstar" : "Star"}
            aria-pressed={conversation.starred}
          >
            <Icon
              name="star"
              filled={conversation.starred}
              strokeWidth={1.8}
              style={conversation.starred ? { color: "#E2A13A" } : undefined}
            />
          </button>
          <button
            type="button"
            onClick={onOpenProfile}
            disabled={!onOpenProfile}
            className="relative ml-0.5 h-[26px] w-[26px] shrink-0 border-0 bg-transparent p-0 disabled:cursor-default"
            aria-label={other ? `Profile: ${other.display_name}` : undefined}
          >
            <Avatar profile={other} size={26} radius={6} />
            {conversation.type === "dm" && <PresenceDot look={look} size={10} border="var(--panel)" />}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onToggleStar}
            className={`${btn} hidden md:flex`}
            aria-label={conversation.starred ? "Unstar" : "Star"}
            aria-pressed={conversation.starred}
          >
            <Icon
              name="star"
              filled={conversation.starred}
              strokeWidth={1.8}
              style={conversation.starred ? { color: "#E2A13A" } : undefined}
            />
          </button>
          <Icon name="lock" size={18} strokeWidth={2.2} className="md:hidden" />
        </>
      )}

      <button
        type="button"
        onClick={() => onOpenDetails("about")}
        className="flex min-w-0 flex-col items-start rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left text-ink hover:bg-hover md:flex-row md:items-center md:gap-1"
      >
        <span className="flex min-w-0 items-center gap-1 truncate text-[17px] leading-[1.2] font-bold md:text-[18px]">
          {!isDm && <Icon name="lock" size={18} strokeWidth={2.2} className="hidden md:block" />}
          <span className="truncate">{title}</span>
          {conversation.archived_at && (
            <span className="ml-1 rounded bg-soft px-1.5 py-0.5 text-[11px] font-semibold text-muted">Archived</span>
          )}
        </span>
        <span className="max-w-full truncate text-[13px] text-muted md:hidden">{sub}</span>
      </button>
      {!isDm && conversation.topic && (
        <span className="hidden min-w-0 truncate text-[15px] text-muted md:ml-2 md:block">{conversation.topic}</span>
      )}

      <div className="flex-1" />

      {!isDm && (
        <button
          type="button"
          onClick={() => onOpenDetails("members")}
          className="hidden h-[30px] items-center gap-1 rounded-md border-0 bg-transparent px-2 text-[15px] font-semibold text-ink hover:bg-hover md:flex"
          aria-label={`${conversation.member_count} members`}
        >
          <Icon name="users" />
          {conversation.member_count}
        </button>
      )}
      <div className="relative hidden md:block">
        <button
          type="button"
          onClick={() => setMenu(menu === "notify" ? "none" : "notify")}
          className={btn}
          aria-label="Notification preferences"
          title={`Notifications: ${NOTIFY_LABELS[level]}`}
          aria-expanded={menu === "notify"}
        >
          <Icon name={conversation.muted || level === "none" ? "bellOff" : "bell"} />
        </button>
        {menu === "notify" && (
          <Menu
            label="Notification preferences"
            header="Notify me about"
            items={[
              ...notifyItems,
              "divider",
              {
                id: "mute",
                label: conversation.muted ? "Unmute" : "Mute conversation",
                icon: conversation.muted ? "bell" : "bellOff",
                onSelect: onToggleMute,
              },
            ]}
            onClose={() => setMenu("none")}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onToggleSearch}
        className={btn}
        aria-label="Search in conversation"
        title="Search in conversation"
        aria-pressed={searchOpen}
        style={searchOpen ? { background: "var(--soft)" } : undefined}
      >
        <Icon name="search" />
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu(menu === "more" ? "none" : "more")}
          className={btn}
          aria-label="More"
          aria-expanded={menu === "more"}
        >
          <Icon name="more" strokeWidth={3} />
        </button>
        {menu === "more" && <Menu label="More actions" items={moreItems} onClose={() => setMenu("none")} />}
      </div>
      {isDm && (
        <Link href={backHref} className={`${btn} hidden md:flex`} aria-label="Close conversation">
          <Icon name="close" />
        </Link>
      )}
    </div>
  );
}
