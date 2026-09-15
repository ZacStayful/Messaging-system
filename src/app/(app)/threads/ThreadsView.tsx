"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { ThreadSummary } from "@/lib/database.types";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { UnreadBadge } from "@/components/ui/UnreadBadge";
import { MessageBody } from "@/components/conversation/MessageBody";
import { listTime } from "@/lib/format";

export function ThreadsView() {
  const { threads, threadsUnread, profiles, conversationById, conversationName, markThreadRead, refreshThreads } =
    useStore();

  // Pull a fresh list when the view opens; the store keeps it live from then on.
  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const whereFor = (t: ThreadSummary) => {
    const c = conversationById(t.conversation_id);
    if (!c) return { label: "Conversation", href: `/home/${t.conversation_id}?thread=${t.message_id}` };
    const dm = c.type === "dm" || c.type === "group_dm";
    return {
      label: dm ? conversationName(c) : `#${c.name}`,
      href: `/${dm ? "dms" : "home"}/${t.conversation_id}?thread=${t.message_id}`,
    };
  };

  const markAll = () => {
    for (const t of threads) if (t.unread_count) void markThreadRead(t.message_id);
  };

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-4 py-4 md:px-8 md:py-6">
        <div className="mb-4 flex items-center gap-2">
          <Link
            href="/home"
            className="flex h-10 w-10 items-center justify-center text-ink md:hidden"
            aria-label="Back"
          >
            <Icon name="back" size={24} strokeWidth={2} />
          </Link>
          <h1 className="font-display text-[22px] font-bold">Threads</h1>
          <div className="flex-1" />
          {threadsUnread > 0 && (
            <button
              type="button"
              onClick={markAll}
              className="h-9 rounded-lg border border-line bg-transparent px-3 text-[14px] font-semibold text-ink hover:bg-hover"
            >
              Mark all as read
            </button>
          )}
        </div>

        {threads.length === 0 && (
          <div className="rounded-[12px] border border-line bg-soft px-5 py-8 text-center text-[15px] text-muted">
            <p className="font-semibold text-ink">No threads yet</p>
            <p className="mt-1">
              Threads you start or reply to show up here, so you can follow the conversation without losing it in the
              channel.
            </p>
          </div>
        )}

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {threads.map((t) => {
            const where = whereFor(t);
            const sender = t.sender_id ? profiles[t.sender_id] : undefined;
            const people = (t.participant_ids ?? [])
              .map((id) => profiles[id])
              .filter(Boolean)
              .slice(0, 4);
            return (
              <li key={t.message_id}>
                <Link
                  href={where.href}
                  onClick={() => t.unread_count && void markThreadRead(t.message_id)}
                  className="block rounded-[12px] border border-line bg-panel px-4 py-3 text-ink no-underline hover:bg-hover"
                  style={t.unread_count ? { borderColor: "var(--tab)" } : undefined}
                >
                  <div className="mb-2 flex items-center gap-2 text-[14px] text-muted">
                    <span className="font-semibold text-ink">{where.label}</span>
                    <span>·</span>
                    <span>
                      {t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}
                    </span>
                    <div className="flex-1" />
                    <span className="whitespace-nowrap">{listTime(t.last_reply_at ?? t.created_at)}</span>
                    <UnreadBadge count={t.unread_count} />
                  </div>
                  <div className="flex gap-2.5">
                    <Avatar profile={sender} size={36} radius={8} />
                    <div className="min-w-0 flex-1">
                      <span className="text-[15px] font-bold">{sender?.display_name ?? "Former member"}</span>
                      <div className="clamp-2 text-[15px] leading-[1.45]">
                        <MessageBody body={t.body} />
                      </div>
                    </div>
                  </div>
                  {people.length > 0 && (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[13px] text-muted">
                      <span className="flex -space-x-1">
                        {people.map((p) => (
                          <Avatar key={p.id} profile={p} size={20} radius={5} className="ring-2 ring-panel" />
                        ))}
                      </span>
                      <span>{people.map((p) => p.display_name).join(", ")}</span>
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
