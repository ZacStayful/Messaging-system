"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";
import { UnreadBadge } from "@/components/ui/UnreadBadge";

/** "Threads" entry at the top of the team sidebars, with the unread reply count. */
export function ThreadsRow({ compact = false }: { compact?: boolean }) {
  const { isTeam, threadsUnread } = useStore();
  const pathname = usePathname();
  if (!isTeam) return null;
  const active = pathname === "/threads";
  return (
    <Link
      href="/threads"
      className={`sb-row text-sb-text no-underline flex items-center gap-2.5 ${
        compact ? "h-[34px] rounded-md pr-2 pl-3" : "border-t border-sb-border px-3.5 py-3"
      }`}
      style={active ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined}
      aria-current={active ? "page" : undefined}
    >
      <Icon name="messages" size={compact ? 18 : 22} strokeWidth={2} />
      <span className="flex-1 truncate text-[16px]" style={{ fontWeight: threadsUnread ? 700 : 600 }}>
        Threads
      </span>
      <UnreadBadge count={threadsUnread} className="min-w-[22px]" />
    </Link>
  );
}
