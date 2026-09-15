"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { listTime, previewOf } from "@/lib/format";
import { SidebarHeader, UnreadToggle, iconBtn } from "./SidebarBits";

const CHIPS = ["All", "Mentions", "Threads", "Reactions"] as const;
type Chip = (typeof CHIPS)[number];

export function ActivityList() {
  const {
    activity,
    activityRead,
    profiles,
    conversationById,
    conversationName,
    markActivityRead,
    markAllActivityRead,
    activeConversationId,
  } = useStore();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [chip, setChip] = useState<Chip>("All");

  const rows = activity.filter((a) => {
    const unread = a.unread && !activityRead.has(a.message_id);
    if (unreadOnly && !unread) return false;
    if (chip === "Mentions") return a.kind === "Mention";
    if (chip === "Threads") return a.kind === "Reply";
    if (chip === "Reactions") return a.kind === "Reaction";
    return true;
  });
  const anyUnread = activity.some((a) => a.unread && !activityRead.has(a.message_id));

  return (
    <>
      <SidebarHeader title="Activity" chevron={false}>
        <UnreadToggle on={unreadOnly} onToggle={() => setUnreadOnly((v) => !v)} />
        <button
          type="button"
          onClick={() => void markAllActivityRead()}
          disabled={!anyUnread}
          className={`${iconBtn} disabled:opacity-40`}
          aria-label="Mark all as read"
          title="Mark all as read"
        >
          <Icon name="check" strokeWidth={2.2} />
        </button>
      </SidebarHeader>
      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-1 pb-2.5">
        {CHIPS.map((c) => {
          const on = chip === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setChip(c)}
              className="flex h-7 items-center rounded-[14px] px-3 text-[14px]"
              style={
                on
                  ? { background: "#FFFFFF", color: "#3E5A3A", fontWeight: 600 }
                  : { border: "1px solid var(--sb-border)", color: "var(--sb-dim)", fontWeight: 500 }
              }
              aria-pressed={on}
            >
              {c}
            </button>
          );
        })}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-4 py-6 text-[15px] text-sb-dim">
            {chip === "Threads"
              ? "Replies to threads you follow will show up here."
              : chip === "Reactions"
                ? "When someone reacts to your messages, you'll see it here."
                : chip === "Mentions"
                  ? "Nobody has mentioned you yet."
                  : "Nothing here yet."}
          </p>
        )}
        {rows.map((a) => {
          const convo = conversationById(a.conversation_id);
          const unread = a.unread && !activityRead.has(a.message_id);
          const joinedName =
            a.kind === "New member" ? a.body.split(" has been added")[0].split(" has accepted")[0] : null;
          const person = a.sender_id
            ? profiles[a.sender_id]
            : Object.values(profiles).find((p) => p.full_name === joinedName || p.display_name === joinedName);
          const isDm = convo ? convo.type === "dm" || convo.type === "group_dm" : false;
          const where = convo ? (isDm ? "Direct message" : `#${convo.name}`) : "";
          const text =
            a.kind === "New member"
              ? `${joinedName ?? "Someone"} joined`
              : a.kind === "Reaction"
                ? `reacted ${a.emoji ?? ""} to: ${previewOf(a.body, 70)}`
                : previewOf(a.body, 90);
          const selected = activeConversationId === a.conversation_id;
          const target = a.parent_id
            ? `/activity/${a.conversation_id}?m=${a.message_id}&thread=${a.parent_id}`
            : `/activity/${a.conversation_id}?m=${a.message_id}`;
          return (
            <Link
              key={`${a.kind}:${a.message_id}:${a.sender_id ?? ""}:${a.emoji ?? ""}`}
              href={target}
              onClick={() => markActivityRead(a.message_id)}
              className="sb-row text-sb-text no-underline flex gap-2.5 border-t border-sb-border px-3.5 py-3"
              style={selected ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined}
            >
              <Avatar profile={person ?? null} size={36} radius={9} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 text-[14px] opacity-90">
                  <span className="font-semibold">{a.kind === "Reply" ? "Thread reply" : a.kind}</span>
                  <span className="truncate">{where}</span>
                  <div className="flex-1" />
                  <span className="whitespace-nowrap">{listTime(a.created_at)}</span>
                </div>
                <div className="mt-0.5 text-[15px]">
                  <span className="font-bold">
                    {a.kind === "New member"
                      ? joinedName
                      : (person?.display_name ?? (convo ? conversationName(convo) : "Stayful"))}
                  </span>{" "}
                  <span className="opacity-95">{text}</span>
                </div>
              </div>
              {unread && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-white" aria-label="Unread" />}
            </Link>
          );
        })}
      </div>
    </>
  );
}
