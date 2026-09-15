"use client";

import Image from "next/image";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useStore, type Nav } from "./store";

const TEAM_ITEMS: { id: Nav; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "dms", label: "DMs", icon: "dms" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "files", label: "Files", icon: "files" },
  { id: "later", label: "Later", icon: "later" },
];
const CUSTOMER_ITEMS: { id: Nav; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "dms", label: "DMs", icon: "dms" },
];

export function useUnreadTotals() {
  const { conversations, activity, activityRead } = useStore();
  const live = conversations.filter((c) => !c.archived_at);
  const dmUnread = live.filter((c) => c.type === "dm" || c.type === "group_dm").reduce((n, c) => n + c.unread_count, 0);
  const channelUnread = live.some((c) => c.type !== "dm" && c.type !== "group_dm" && c.unread_count > 0 && !c.muted);
  const activityUnread = activity.filter((a) => a.unread && !activityRead.has(a.message_id)).length;
  return { dmUnread, channelUnread, activityUnread };
}

export function Rail() {
  const { nav, me, isOnline, isTeam, isCustomer } = useStore();
  const { dmUnread, channelUnread, activityUnread } = useUnreadTotals();
  const items = isCustomer ? CUSTOMER_ITEMS : TEAM_ITEMS;

  return (
    <nav
      className="hidden w-[72px] shrink-0 flex-col items-center gap-1 pt-1.5 pb-2.5 text-sb-text md:flex"
      aria-label="Primary"
    >
      <Image
        src="/brand/stayful-logo.png"
        alt="Stayful"
        width={38}
        height={38}
        className="mb-2.5 h-[38px] w-[38px] rounded-[9px]"
      />
      {items.map((item) => {
        const active = nav === item.id;
        const badge = item.id === "dms" ? dmUnread : item.id === "activity" ? activityUnread : 0;
        const dot = item.id === "home" && channelUnread;
        return (
          <Link
            key={item.id}
            href={`/${item.id}`}
            aria-current={active ? "page" : undefined}
            className="flex w-16 flex-col items-center gap-[3px] border-0 bg-transparent px-0 pt-0.5 pb-1.5 text-sb-text"
          >
            <span
              className="relative flex h-[38px] w-[38px] items-center justify-center rounded-[9px]"
              style={{ background: active ? "rgba(255,255,255,.22)" : "transparent" }}
            >
              <Icon name={item.icon} size={22} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-2 flex h-5 min-w-5 items-center justify-center rounded-[10px] border-2 border-frame bg-white px-1.5 text-[12px] font-bold text-[#3E5A3A]">
                  {badge}
                </span>
              )}
              {dot && <span className="absolute top-0.5 right-1 h-2 w-2 rounded-full border-2 border-frame bg-white" />}
            </span>
            <span className="font-display text-center text-[12px] leading-[1.2] font-semibold whitespace-pre-line">
              {item.label}
            </span>
          </Link>
        );
      })}
      {isTeam && (
        <Link
          href="/customers/new"
          className="mt-1.5 flex h-[38px] w-[38px] items-center justify-center rounded-full border-0 bg-white/[.18] text-sb-text hover:bg-white/30"
          aria-label="Invite a customer"
          title="Invite a customer"
        >
          <Icon name="plus" strokeWidth={2} />
        </Link>
      )}
      <div className="flex-1" />
      <Link
        href="/settings/account"
        className="relative mt-2.5 block h-[38px] w-[38px] rounded-[9px]"
        title="Account"
        aria-label="Account"
      >
        <Avatar profile={me} size={38} radius={9} />
        <span
          className="absolute -right-[3px] -bottom-[3px] h-3 w-3 rounded-full border-2 border-frame"
          style={{ background: isOnline(me.id) ? "#2BAC76" : "#B9D5C6" }}
        />
      </Link>
    </nav>
  );
}
