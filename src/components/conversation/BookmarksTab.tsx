"use client";

import type { ConversationBookmark, Profile } from "@/lib/database.types";
import { Icon } from "@/components/ui/Icon";
import { pinWhen } from "@/lib/format";
import { hostLabel, safeHttpUrl } from "@/lib/urls";
import { label } from "./BookmarkBar";

interface BookmarksTabProps {
  bookmarks: ConversationBookmark[];
  profiles: Record<string, Profile>;
  /** Team accounts (and a bookmark's own author) can edit, reorder and remove. */
  isTeam: boolean;
  meId: string;
  canAdd: boolean;
  onAdd: () => void;
  onEdit: (bookmark: ConversationBookmark) => void;
  onRemove: (bookmark: ConversationBookmark) => void;
  onMove: (bookmark: ConversationBookmark, delta: number) => void;
}

const action = "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent text-muted hover:bg-hover";

export function BookmarksTab({
  bookmarks,
  profiles,
  isTeam,
  meId,
  canAdd,
  onAdd,
  onEdit,
  onRemove,
  onMove,
}: BookmarksTabProps) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <div className="mb-3.5 flex items-center gap-3">
        <div className="text-[16px] font-semibold">Bookmarks</div>
        <div className="flex-1" />
        {canAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-input-border px-3 text-[14px] font-semibold hover:bg-hover"
          >
            <Icon name="plus" size={15} strokeWidth={2.4} /> Add a bookmark
          </button>
        )}
      </div>

      {bookmarks.length === 0 && (
        <p className="text-[15px] text-muted">
          No bookmarks yet. Add links to the sites and documents this group needs often — a property listing, a cleaning
          rota, a shared folder — and they stay one click away for everyone.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {bookmarks.map((b, i) => {
          const author = b.created_by ? profiles[b.created_by] : undefined;
          // The database refuses both for a mandatory bookmark (0021); do not offer a button
          // whose only outcome is an error.
          const canEdit = !b.is_mandatory && (isTeam || b.created_by === meId);
          const u = safeHttpUrl(b.url);
          return (
            <div key={b.id} className="flex gap-3 rounded-xl border border-line bg-card px-4 py-3.5">
              <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-soft text-[18px]">
                {b.emoji || <Icon name="link" size={18} className="text-muted" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <a
                    href={b.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[16px] font-bold text-ink hover:underline"
                  >
                    {label(b)}
                  </a>
                  <span className="text-[13px] text-muted">{u ? hostLabel(u) : b.url}</span>
                  <div className="flex-1" />
                  {isTeam && (
                    <>
                      <button
                        type="button"
                        onClick={() => onMove(b, -1)}
                        disabled={i === 0}
                        className={`${action} disabled:opacity-30`}
                        aria-label={`Move ${label(b)} up`}
                        title="Move up"
                      >
                        <Icon name="arrowUp" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(b, 1)}
                        disabled={i === bookmarks.length - 1}
                        className={`${action} disabled:opacity-30`}
                        aria-label={`Move ${label(b)} down`}
                        title="Move down"
                      >
                        <Icon name="arrowDown" size={15} />
                      </button>
                    </>
                  )}
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => onEdit(b)}
                        className={action}
                        aria-label={`Edit ${label(b)}`}
                        title="Edit"
                      >
                        <Icon name="pencil" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(b)}
                        className={action}
                        aria-label={`Remove ${label(b)}`}
                        title="Remove"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </>
                  )}
                </div>
                {b.note && <p className="mt-1 text-[15px] whitespace-pre-wrap">{b.note}</p>}
                <div className="mt-1 text-[13px] text-muted">
                  {b.is_mandatory
                    ? "On every Stayful customer group"
                    : `Added by ${author?.display_name ?? "a former member"} · ${pinWhen(b.created_at)}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
