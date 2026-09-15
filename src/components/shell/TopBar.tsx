"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { Avatar } from "@/components/ui/Avatar";
import { listTime } from "@/lib/format";
import { useStore, liveConversations } from "./store";

const btn = "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-sb-dim hover:bg-sb-hover";

const SHORTCUTS: [string, string][] = [
  ["Enter", "Send message"],
  ["Shift + Enter", "New line"],
  ["Ctrl/⌘ + K", "Jump to a conversation or person"],
  ["Alt + ↑ / ↓", "Previous / next conversation"],
  ["↑", "Edit your last message (empty composer)"],
  ["Ctrl/⌘ + B / I", "Bold / italic"],
  ["Ctrl/⌘ + Shift + X", "Strikethrough"],
  ["@", "Mention someone"],
  ["/", "Slash commands (/status, /dnd, /shrug…)"],
  ["Shift + Esc", "Mark everything as read"],
  ["Esc", "Close a panel or search"],
];

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { conversations, conversationName, otherMember, isCustomer } = useStore();
  const initial = pathname === "/search" ? (params.get("q") ?? "") : "";
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState<"none" | "history" | "help">("none");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  const recent = liveConversations(conversations)
    .filter((c) => c.last_read_at)
    .sort((a, b) => (b.last_read_at ?? "").localeCompare(a.last_read_at ?? ""))
    .slice(0, 8);

  return (
    <header className="hidden h-11 shrink-0 items-center gap-2 pr-3 text-sb-text md:flex">
      <div className="w-[72px] shrink-0" />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
        <button type="button" className={btn} onClick={() => router.back()} aria-label="Back">
          <Icon name="back" />
        </button>
        <button type="button" className={`${btn} opacity-50`} onClick={() => router.forward()} aria-label="Forward">
          <Icon name="forward" />
        </button>
        <div className="relative mr-2">
          <button
            type="button"
            className={btn}
            onClick={() => setOpen(open === "history" ? "none" : "history")}
            aria-label="History"
            title="Recent conversations"
            aria-expanded={open === "history"}
          >
            <Icon name="clock" />
          </button>
          {open === "history" && (
            <Popover
              onClose={() => setOpen("none")}
              label="Recent conversations"
              below
              align="left"
              className="w-[320px] py-1"
            >
              <div className="px-3.5 py-2 text-[13px] font-semibold text-muted">Recent</div>
              {recent.length === 0 && <p className="px-3.5 pb-3 text-[14px] text-muted">Nothing opened yet.</p>}
              {recent.map((c) => {
                const dm = c.type === "dm" || c.type === "group_dm";
                const other = dm ? otherMember(c) : undefined;
                return (
                  <Link
                    key={c.id}
                    href={`/${dm ? "dms" : "home"}/${c.id}`}
                    onClick={() => setOpen("none")}
                    className="flex items-center gap-2.5 px-3.5 py-1.5 text-ink no-underline hover:bg-hover"
                  >
                    {dm ? <Avatar profile={other} size={22} radius={5} /> : <Icon name="lock" size={16} />}
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{conversationName(c)}</span>
                    <span className="text-[12px] text-muted">{listTime(c.last_read_at)}</span>
                  </Link>
                );
              })}
            </Popover>
          )}
        </div>
        {isCustomer ? (
          <div className="flex h-[30px] min-w-0 flex-1 max-w-[720px] items-center justify-center text-[14px] font-semibold text-sb-dim">
            Stayful
          </div>
        ) : (
          <form
            onSubmit={submit}
            role="search"
            className="flex h-[30px] min-w-0 flex-1 max-w-[720px] items-center gap-2 rounded-md border border-sb-border bg-sb-input px-2.5 text-sb-dim focus-within:bg-input focus-within:text-ink"
          >
            <Icon name="search" size={16} strokeWidth={2} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Stayful"
              aria-label="Search Stayful"
              className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-inherit outline-none placeholder:text-current"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="flex h-5 w-5 items-center justify-center rounded"
                aria-label="Clear search"
              >
                <Icon name="close" size={12} strokeWidth={2.4} />
              </button>
            )}
          </form>
        )}
        <Image
          src="/brand/stayful-logo.png"
          alt=""
          width={26}
          height={26}
          className="ml-2 h-[26px] w-[26px] rounded-md"
        />
      </div>
      <div className="relative">
        <button
          type="button"
          className={btn}
          onClick={() => setOpen(open === "help" ? "none" : "help")}
          aria-label="Help"
          title="Help"
          aria-expanded={open === "help"}
        >
          <Icon name="help" />
        </button>
        {open === "help" && (
          <Popover onClose={() => setOpen("none")} label="Help" below align="right" className="w-[320px] p-4">
            <div className="text-[16px] font-bold">Help</div>
            <p className="mt-1 text-[14px] text-muted">
              Stayful Messaging keeps owners and the Stayful team in one place. Messages you send to a group also reach
              owners by email, and their email replies land back here.
            </p>
            <div className="mt-3 text-[13px] font-semibold text-muted">Keyboard shortcuts</div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>
                    <kbd className="rounded border border-input-border bg-soft px-1.5 py-0.5 text-[12px] font-semibold">
                      {k}
                    </kbd>
                  </dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
            <a
              href="mailto:info@stayful.co.uk?subject=Stayful%20Messaging%20help"
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-input-border px-3 text-[14px] font-semibold text-ink no-underline hover:bg-hover"
            >
              <Icon name="mail" size={16} /> Email the Stayful team
            </a>
          </Popover>
        )}
      </div>
    </header>
  );
}
