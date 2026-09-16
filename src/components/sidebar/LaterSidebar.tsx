"use client";

import Link from "next/link";
import { useState } from "react";
import { useStore, type SavedRow } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { futureTime, listTime, previewOf } from "@/lib/format";
import { untilFor } from "@/lib/presence";
import { SidebarHeader } from "./SidebarBits";
import { useNow } from "@/lib/useNow";

const TABS = ["In progress", "Archived", "Completed"] as const;
type Tab = (typeof TABS)[number];

const REMINDERS: { id: string; label: string; ms?: number; preset?: "tomorrow" | "week" }[] = [
  { id: "20m", label: "In 20 minutes", ms: 20 * 60_000 },
  { id: "1h", label: "In 1 hour", ms: 60 * 60_000 },
  { id: "3h", label: "In 3 hours", ms: 3 * 60 * 60_000 },
  { id: "tomorrow", label: "Tomorrow, 9:00", preset: "tomorrow" },
  { id: "week", label: "Next week, 9:00", preset: "week" },
];

function remindLabel(r: SavedRow, now: number): { text: string; due: boolean } | null {
  if (!r.remind_at) return null;
  const t = new Date(r.remind_at).getTime();
  if (t <= now) return { text: "Reminder due", due: true };
  return { text: `Remind ${futureTime(r.remind_at)}`, due: false };
}

/** Slack's Later: saved messages with reminders, In progress / Archived / Completed. */
export function LaterSidebar() {
  const { saved, profiles, conversationById, conversationName, updateSaved, unsaveMessage, activeConversationId } =
    useStore();
  const [tab, setTab] = useState<Tab>("In progress");
  const [menu, setMenu] = useState<{ id: string; view: "main" | "remind"; x: number; y: number } | null>(null);
  const now = useNow();

  const rows = saved.filter((r) => {
    if (!r.message) return false;
    if (tab === "Completed") return !!r.completed_at;
    if (tab === "Archived") return !!r.archived_at && !r.completed_at;
    return !r.completed_at && !r.archived_at;
  });
  const dueFirst = [...rows].sort((a, b) => {
    const ad = a.remind_at && new Date(a.remind_at).getTime() <= now ? 0 : 1;
    const bd = b.remind_at && new Date(b.remind_at).getTime() <= now ? 0 : 1;
    return ad - bd || b.saved_at.localeCompare(a.saved_at);
  });
  const menuRow = menu ? saved.find((r) => r.id === menu.id) : undefined;
  const count = (t: Tab) =>
    saved.filter((r) =>
      t === "Completed"
        ? !!r.completed_at
        : t === "Archived"
          ? !!r.archived_at && !r.completed_at
          : !r.completed_at && !r.archived_at,
    ).length;

  const itemsFor = (r: SavedRow): (MenuItem | "divider")[] => {
    if (menu?.view === "remind") {
      return [
        ...REMINDERS.map((o) => ({
          id: o.id,
          label: o.label,
          onSelect: () =>
            void updateSaved(r.id, {
              remind_at: o.preset ? untilFor(o.preset) : new Date(Date.now() + (o.ms ?? 0)).toISOString(),
              reminded_at: null,
            }),
        })),
        ...(r.remind_at
          ? [
              {
                id: "clear",
                label: "Clear reminder",
                danger: true,
                onSelect: () => void updateSaved(r.id, { remind_at: null }),
              } as MenuItem,
            ]
          : []),
        "divider",
        {
          id: "back",
          label: "Back",
          icon: "back",
          keepOpen: true,
          onSelect: () => setMenu((m) => (m ? { ...m, view: "main" } : m)),
        },
      ];
    }
    const items: (MenuItem | "divider")[] = [];
    items.push(
      r.completed_at
        ? {
            id: "reopen",
            label: "Move back to In progress",
            icon: "retry",
            onSelect: () => void updateSaved(r.id, { completed_at: null, archived_at: null }),
          }
        : {
            id: "done",
            label: "Mark as complete",
            icon: "check",
            onSelect: () => void updateSaved(r.id, { completed_at: new Date().toISOString() }),
          },
    );
    if (!r.completed_at)
      items.push(
        r.archived_at
          ? {
              id: "unarchive",
              label: "Move back to In progress",
              icon: "retry",
              onSelect: () => void updateSaved(r.id, { archived_at: null }),
            }
          : {
              id: "archive",
              label: "Archive",
              icon: "files",
              onSelect: () => void updateSaved(r.id, { archived_at: new Date().toISOString() }),
            },
      );
    items.push({
      id: "remind",
      label: r.remind_at ? "Change reminder" : "Remind me",
      icon: "clock",
      keepOpen: true,
      onSelect: () => setMenu((m) => (m ? { ...m, view: "remind" } : m)),
    });
    items.push("divider");
    items.push({
      id: "remove",
      label: "Remove from Later",
      icon: "trash",
      danger: true,
      onSelect: () => void unsaveMessage(r.message_id),
    });
    return items;
  };

  return (
    <>
      <SidebarHeader title="Later" chevron={false} />
      <div className="flex shrink-0 gap-1.5 px-3 pt-1 pb-2.5" role="tablist">
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t)}
              className="flex h-7 items-center gap-1 rounded-[14px] px-3 text-[14px] whitespace-nowrap"
              style={
                on
                  ? { background: "#FFFFFF", color: "#3E5A3A", fontWeight: 600 }
                  : { border: "1px solid var(--sb-border)", color: "var(--sb-dim)", fontWeight: 500 }
              }
            >
              {t}
              {count(t) > 0 && <span className="text-[12px] opacity-80">{count(t)}</span>}
            </button>
          );
        })}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {dueFirst.length === 0 && (
          <div className="px-4 py-6 text-[15px] text-sb-dim">
            {tab === "In progress" ? (
              <>
                <p className="font-semibold text-sb-text">Nothing saved yet</p>
                <p className="mt-1">Hover a message and use the bookmark to save it for later, or set a reminder.</p>
              </>
            ) : (
              <p>Nothing {tab.toLowerCase()} yet.</p>
            )}
          </div>
        )}
        {dueFirst.map((r) => {
          const m = r.message!;
          const c = conversationById(m.conversation_id);
          const isDm = c ? c.type === "dm" || c.type === "group_dm" : false;
          const where = c ? (isDm ? conversationName(c) : `#${c.name}`) : "Conversation";
          const sender = m.sender_id ? profiles[m.sender_id] : undefined;
          const remind = remindLabel(r, now);
          const selected = activeConversationId === m.conversation_id;
          const open = menu?.id === r.id;
          return (
            <div
              key={r.id}
              className="sb-row group relative flex gap-2.5 border-t border-sb-border px-3.5 py-3 text-sb-text"
              style={selected ? { background: "var(--sb-sel)", color: "var(--sb-sel-text)" } : undefined}
            >
              <Link
                href={`/later/${m.conversation_id}?m=${m.id}`}
                className="flex min-w-0 flex-1 gap-2.5 text-inherit no-underline"
              >
                <Avatar profile={sender ?? null} size={36} radius={9} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2 text-[14px] opacity-90">
                    <span className="truncate font-semibold">{where}</span>
                    <span className="ml-auto whitespace-nowrap">{listTime(r.saved_at)}</span>
                  </span>
                  <span className="mt-0.5 block text-[15px]">
                    <span className="font-bold">{sender?.display_name ?? "Stayful"}</span>{" "}
                    <span className="opacity-95">{previewOf(m.body, 90) || "Attachment"}</span>
                  </span>
                  {remind && (
                    <span
                      className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                      style={
                        remind.due
                          ? { background: "#FFFFFF", color: "#3E5A3A" }
                          : { border: "1px solid var(--sb-border)", opacity: 0.9 }
                      }
                    >
                      <Icon name="clock" size={12} strokeWidth={2.4} /> {remind.text}
                    </span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  if (open) return setMenu(null);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenu({ id: r.id, view: "main", x: rect.right, y: rect.bottom + 4 });
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-current hover:bg-sb-hover"
                aria-label={`Options for saved message from ${sender?.display_name ?? "Stayful"}`}
                aria-expanded={open}
              >
                <Icon name="more" size={16} strokeWidth={2.6} />
              </button>
            </div>
          );
        })}
      </div>
      {menuRow && menu && (
        <div className="fixed z-40" style={{ left: Math.max(8, menu.x - 260), top: menu.y }}>
          <Menu
            label="Saved item options"
            header={menu.view === "remind" ? "Remind me" : undefined}
            items={itemsFor(menuRow)}
            onClose={() => setMenu(null)}
            align="left"
          />
        </div>
      )}
    </>
  );
}
