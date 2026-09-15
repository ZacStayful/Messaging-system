"use client";

import { useState } from "react";
import type { ConversationBookmark } from "@/lib/database.types";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import { hostLabel, safeHttpUrl } from "@/lib/urls";

/** Chips beyond this go behind a "+N" menu, so the bar never crowds out the header. */
const VISIBLE = 6;

interface BookmarkBarProps {
  bookmarks: ConversationBookmark[];
  canAdd: boolean;
  onAdd: () => void;
  onManage: () => void;
}

export function label(b: Pick<ConversationBookmark, "title" | "url">): string {
  if (b.title.trim()) return b.title.trim();
  const u = safeHttpUrl(b.url);
  return u ? hostLabel(u) : b.url;
}

const chip =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-ink no-underline hover:bg-hover";

/**
 * The row of bookmark chips under the conversation header. Hidden entirely when a conversation
 * has none, so it costs nothing in the conversations that do not use it. Scrolls horizontally
 * rather than wrapping, on desktop and on a phone alike, so the header height never moves.
 */
export function BookmarkBar({ bookmarks, canAdd, onAdd, onManage }: BookmarkBarProps) {
  const [overflow, setOverflow] = useState(false);
  if (bookmarks.length === 0) return null;

  const shown = bookmarks.slice(0, VISIBLE);
  const rest = bookmarks.slice(VISIBLE);

  return (
    <div
      className="scroll-thin flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2 md:px-4"
      aria-label="Bookmarks"
    >
      {shown.map((b) => (
        <a
          key={b.id}
          href={b.url}
          target="_blank"
          rel="noopener noreferrer"
          className={chip}
          title={b.note ? `${label(b)} — ${b.note}` : label(b)}
        >
          {b.emoji ? <span className="text-[14px]">{b.emoji}</span> : <Icon name="link" size={13} />}
          <span className="max-w-[160px] truncate">{label(b)}</span>
        </a>
      ))}

      {rest.length > 0 && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOverflow((v) => !v)}
            aria-expanded={overflow}
            aria-haspopup="menu"
            className={chip}
          >
            +{rest.length}
          </button>
          {overflow && (
            <Menu
              onClose={() => setOverflow(false)}
              label="More bookmarks"
              items={rest.map((b) => ({
                id: b.id,
                label: label(b),
                onSelect: () => window.open(b.url, "_blank", "noopener,noreferrer"),
              }))}
            />
          )}
        </div>
      )}

      <div className="flex-1" />
      {canAdd && (
        <button type="button" onClick={onAdd} className={`${chip} text-muted`} title="Add a bookmark">
          <Icon name="plus" size={13} strokeWidth={2.4} />
        </button>
      )}
      <button type="button" onClick={onManage} className={`${chip} text-muted`} title="Manage bookmarks">
        <Icon name="more" size={13} />
      </button>
    </div>
  );
}
