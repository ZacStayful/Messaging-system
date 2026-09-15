"use client";

import Image from "next/image";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { useStore, type Nav } from "./store";
import { useNow } from "@/lib/useNow";
import { manualAway, notificationsSilenced, presenceLook } from "@/lib/presence";

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

/**
 * Every badge in the app comes from here (the rail on desktop, the tab bar on mobile), which is
 * why silencing notifications is one change in one place.
 *
 * Away and do-not-disturb suppress *alerts*, never state: unread counts, the activity feed and
 * the sidebar's per-conversation badges all keep accruing, so nothing is lost while you are
 * away — you just are not nagged about it. `laterDue` stays live either way, because a reminder
 * you set for yourself is not someone else's notification.
 */
export function useUnreadTotals() {
  const { conversations, activity, activityRead, saved, me } = useStore();
  const now = useNow();
  const live = conversations.filter((c) => !c.archived_at);
  const laterDue = saved.filter(
    (r) => !r.completed_at && !r.archived_at && r.remind_at && new Date(r.remind_at).getTime() <= now,
  ).length;
  const dmUnread = live.filter((c) => c.type === "dm" || c.type === "group_dm").reduce((n, c) => n + c.unread_count, 0);
  const channelUnread = live.some((c) => c.type !== "dm" && c.type !== "group_dm" && c.unread_count > 0 && !c.muted);
  const activityUnread = activity.filter((a) => a.unread && !activityRead.has(a.message_id)).length;
  if (notificationsSilenced(me)) return { dmUnread: 0, channelUnread: false, activityUnread: 0, laterDue };
  return { dmUnread, channelUnread, activityUnread, laterDue };
}

export function Rail() {
  const { nav, me, presenceOf, isTeam, isCustomer } = useStore();
  const myLook = presenceLook(presenceOf(me.id));
  const { dmUnread, channelUnread, activityUnread, laterDue } = useUnreadTotals();
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
        const badge =
          item.id === "dms" ? dmUnread : item.id === "activity" ? activityUnread : item.id === "later" ? laterDue : 0;
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
        {notificationsSilenced(me) ? (
          <span
            className="absolute -right-[4px] -bottom-[4px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-frame bg-[#3E5A3A] text-white"
            title={manualAway(me) ? "Away — notifications off" : "Notifications paused"}
          >
            <Icon name={manualAway(me) ? "moon" : "bellOff"} size={9} strokeWidth={2.6} />
          </span>
        ) : (
          <span
            className="absolute -right-[3px] -bottom-[3px] h-3 w-3 rounded-full border-2 border-frame"
            style={{ background: myLook.bg === "transparent" ? "#B9D5C6" : myLook.bg }}
          />
        )}
      </Link>
    </nav>
  );
}
