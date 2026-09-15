"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";

/** "People" entry under Threads in the team Home sidebar. */
export function PeopleRow() {
  const { isTeam } = useStore();
  const pathname = usePathname();
  if (!isTeam) return null;
  const active = pathname === "/people";
  return (
    <Link
      href="/people"
      className="sb-row text-sb-text no-underline flex h-[34px] items-center gap-2.5 rounded-md pr-2 pl-3"
      style={active ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined}
      aria-current={active ? "page" : undefined}
    >
      <Icon name="people" size={18} strokeWidth={2} />
      <span className="flex-1 truncate text-[16px] font-semibold">People</span>
    </Link>
  );
}
