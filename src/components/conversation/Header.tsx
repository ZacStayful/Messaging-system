"use client";

import Link from "next/link";
import type { ConversationSummary, Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { PresenceDot } from "@/components/ui/PresenceDot";
import { Icon } from "@/components/ui/Icon";
import { presenceLook, presenceText } from "@/lib/presence";
import type { DetailTab } from "./DetailsModal";

interface HeaderProps {
  conversation: ConversationSummary;
  title: string;
  other: Profile | undefined;
  otherOnline: boolean;
  backHref: string;
  onOpenDetails: (tab: DetailTab) => void;
  onToggleStar: () => void;
  onToggleMute: () => void;
}

const btn = "flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-hover";

export function Header({ conversation, title, other, otherOnline, backHref, onOpenDetails, onToggleStar, onToggleMute }: HeaderProps) {
  const isDm = conversation.type === "dm" || conversation.type === "group_dm";
  const look = presenceLook(other, otherOnline);
  const sub = isDm ? presenceText(other, otherOnline) : conversation.topic || `${conversation.member_count} members`;

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
          <button type="button" onClick={onToggleStar} className={`${btn} hidden md:flex`} aria-label={conversation.starred ? "Unstar" : "Star"} aria-pressed={conversation.starred}>
            <Icon name="star" filled={conversation.starred} strokeWidth={1.8} style={conversation.starred ? { color: "#E2A13A" } : undefined} />
          </button>
          <span className="relative ml-0.5 h-[26px] w-[26px] shrink-0 md:h-[26px] md:w-[26px]">
            <Avatar profile={other} size={26} radius={6} />
            <PresenceDot look={look} size={10} border="var(--panel)" />
          </span>
        </>
      ) : (
        <>
          <button type="button" className={`${btn} hidden md:flex`} aria-label="Filter" title="Filter">
            <Icon name="filter" />
          </button>
          <Icon name="lock" size={18} strokeWidth={2.2} className="md:hidden" />
        </>
      )}

      <button
        type="button"
        onClick={() => onOpenDetails(isDm ? "about" : "about")}
        className="flex min-w-0 flex-col items-start rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left text-ink hover:bg-hover md:flex-row md:items-center md:gap-1"
      >
        <span className="flex min-w-0 items-center gap-1 truncate text-[17px] leading-[1.2] font-bold md:text-[18px]">
          {!isDm && <Icon name="lock" size={18} strokeWidth={2.2} className="hidden md:block" />}
          <span className="truncate">{title}</span>
        </span>
        <span className="max-w-full truncate text-[12px] text-muted md:hidden">{sub}</span>
      </button>
      {!isDm && conversation.topic && <span className="hidden min-w-0 truncate text-[14px] text-muted md:ml-2 md:block">{conversation.topic}</span>}

      <div className="flex-1" />

      {!isDm && (
        <button type="button" onClick={() => onOpenDetails("members")} className="hidden h-[30px] items-center gap-1 rounded-md border-0 bg-transparent px-2 text-[14px] font-semibold text-ink hover:bg-hover md:flex" aria-label={`${conversation.member_count} members`}>
          <Icon name="users" />
          {conversation.member_count}
        </button>
      )}
      <button type="button" className="flex h-[30px] items-center gap-0.5 rounded-md border-0 bg-transparent px-1.5 text-ink hover:bg-hover" aria-label="Start a call" title="Calls are coming in a later release">
        <Icon name="huddle" size={22} />
        <Icon name="chevronDown" size={14} strokeWidth={2} className="hidden md:block" />
      </button>
      <button type="button" onClick={onToggleMute} className={`${btn} hidden md:flex`} aria-label={conversation.muted ? "Unmute conversation" : "Mute conversation"} aria-pressed={conversation.muted}>
        <Icon name={conversation.muted ? "bellOff" : "bell"} />
      </button>
      <button type="button" className={`${btn} hidden md:flex`} aria-label="Search in conversation" title="Search in conversation">
        <Icon name="search" />
      </button>
      <button type="button" onClick={() => onOpenDetails("settings")} className={btn} aria-label="More">
        <Icon name="more" strokeWidth={3} />
      </button>
      {isDm && (
        <Link href={backHref} className={`${btn} hidden md:flex`} aria-label="Close conversation">
          <Icon name="close" />
        </Link>
      )}
    </div>
  );
}
