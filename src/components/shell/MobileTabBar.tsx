"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useStore, type Nav } from "./store";
import { useUnreadTotals } from "./Rail";

const TEAM_ITEMS: { id: Nav; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "dms", label: "DMs", icon: "dms" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "you", label: "You", icon: "you" },
];
const CUSTOMER_ITEMS: { id: Nav; label: string; icon: IconName }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "dms", label: "DMs", icon: "dms" },
  { id: "you", label: "You", icon: "you" },
];

export function MobileTabBar() {
  const { nav, isCustomer } = useStore();
  const { dmUnread, activityUnread } = useUnreadTotals();
  const items = isCustomer ? CUSTOMER_ITEMS : TEAM_ITEMS;
  return (
    <nav
      className="flex h-[84px] shrink-0 items-start border-t border-sb-border bg-frame px-2 pt-2.5 text-white md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Primary"
    >
      {items.map((item) => {
        const active = nav === item.id;
        const badge = item.id === "dms" ? dmUnread : item.id === "activity" ? activityUnread : 0;
        return (
          <Link
            key={item.id}
            href={`/${item.id}`}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-0.5 p-0 text-white"
            style={{ opacity: active ? 1 : 0.75 }}
          >
            <span
              className="relative flex h-[30px] w-12 items-center justify-center rounded-[15px]"
              style={{ background: active ? "rgba(255,255,255,.22)" : "transparent" }}
            >
              <Icon name={item.icon} size={22} />
              {badge > 0 && (
                <span className="absolute -top-1.5 right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-2 border-frame bg-white px-[5px] text-[12px] font-bold text-[#3E5A3A]">
                  {badge}
                </span>
              )}
            </span>
            <span className="font-display text-[12px] font-semibold">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
