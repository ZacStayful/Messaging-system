"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Message, Profile, Reaction } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon, type IconName } from "@/components/ui/Icon";
import { listTime, timeLabel } from "@/lib/format";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { MessageBody } from "./MessageBody";
import { LinkPreview } from "./LinkPreview";
import { previewableLink } from "@/lib/richtext";
import { EmojiPicker } from "./EmojiPicker";
import { AttachmentView, isPending, type AnyAttachment } from "./AttachmentView";
import { CallSummary, type CallMeta } from "./CallSummary";
import { useStore } from "@/components/shell/store";

export type LocalMessage = Message & { _status?: "sending" | "failed" };

/** Customers may edit or delete their own messages for 15 minutes; team accounts any time. */
export function canModify(message: Message, me: Profile): boolean {
  if (message.sender_id !== me.id || message.kind === "system" || message.kind === "call_summary") return false;
  if (me.account_type === "team") return true;
  return Date.now() - new Date(message.created_at).getTime() < 15 * 60_000;
}

interface MessageItemProps {
  message: LocalMessage;
  sender: Profile | undefined;
  me: Profile;
  profiles: Record<string, Profile>;
  reactions: Reaction[];
  attachments: AnyAttachment[];
  urls: Record<string, string>;
  pinned: boolean;
  /** Search hit or deep-link target. */
  highlighted?: boolean;
  query?: string;
  onRetry?: (message: LocalMessage) => void;
  onReact: (emoji: string) => void;
  onTogglePin: () => void;
  onEdit: (body: string) => void;
  onDelete: () => void;
  onOpenImage?: (attachment: AnyAttachment) => void;
  /** Opens (or focuses) the thread for this message. Absent inside the thread panel. */
  onOpenThread?: () => void;
  /** Rendered inside the thread panel: no reply summary, no "reply in thread" action. */
  inThread?: boolean;
  /** Files this message into a property's Cleaning or Maintenance thread (team). */
  onFile?: () => void;
  /** Saved for later (team). Absent hides the action. */
  saved?: boolean;
  onToggleSave?: () => void;
  /** Same sender within a few minutes of the previous message: no avatar or name, time on hover. */
  compact?: boolean;
  /** Controlled edit mode (the conversation opens the last own message on ↑). */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

const actionBtn =
  "flex h-8 min-w-8 items-center justify-center rounded-md border-0 bg-transparent px-1 text-ink hover:bg-hover";

/**
 * How a message got here, when it did not come from someone typing in the app. `sent_via` is
 * free text, so anything unlisted simply shows no chip.
 */
const VIA: Record<string, { icon: IconName; label: string; title: string }> = {
  email: { icon: "mail", label: "via email", title: "Sent by replying to an email" },
  api: { icon: "link", label: "via API", title: "Posted through the Stayful API" },
  mcp: { icon: "link", label: "via MCP", title: "Posted by an assistant over MCP" },
};

export function MessageItem({
  message,
  sender,
  me,
  profiles,
  reactions,
  attachments,
  urls,
  pinned,
  highlighted,
  query,
  onRetry,
  onReact,
  onTogglePin,
  onEdit,
  onDelete,
  onOpenThread,
  onFile,
  inThread = false,
  saved,
  onToggleSave,
  compact = false,
  editing: editingProp,
  onEditingChange,
}: MessageItemProps) {
  const { openProfile } = useStore();
  const internal = message.visibility === "internal";
  const system = message.kind === "system";
  const name = message.sender_id ? (sender?.display_name ?? "Former member") : "Stayful";
  const [menu, setMenu] = useState<"none" | "emoji" | "confirmDelete">("none");
  const [editingState, setEditingState] = useState(false);
  const editing = editingProp ?? editingState;
  const setEditing = (v: boolean) => {
    if (onEditingChange) onEditingChange(v);
    if (editingProp === undefined) setEditingState(v);
  };
  const [draft, setDraft] = useState(message.body);
  // When edit mode is switched on from outside, start from the current body.
  const [seenEditing, setSeenEditing] = useState(editing);
  if (seenEditing !== editing) {
    setSeenEditing(editing);
    if (editing) setDraft(message.body);
  }
  const editRef = useRef<HTMLTextAreaElement>(null);
  const modifiable = canModify(message, me) && !message._status;

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [editing, draft]);

  const startEdit = () => {
    setDraft(message.body);
    setEditing(true);
    setMenu("none");
  };
  const saveEdit = () => {
    const text = draft.trim();
    setEditing(false);
    if (text && text !== message.body) onEdit(text);
  };
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") setEditing(false);
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      saveEdit();
    }
  };

  // Group reactions by emoji, keeping first-seen order.
  const groups = new Map<string, Reaction[]>();
  for (const r of reactions) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r]);

  const bg = highlighted
    ? { background: "rgba(226,161,58,.18)" }
    : internal
      ? { background: "rgba(226,138,43,.10)", borderLeft: "3px solid #E28A2B" }
      : undefined;

  return (
    <article
      id={`m-${message.id}`}
      className="group relative -mx-2 flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover"
      style={bg}
      aria-label={`${name} at ${timeLabel(message.created_at)}`}
    >
      {compact ? (
        <div className="w-[38px] shrink-0 pt-[3px] text-right text-[11px] leading-[20px] text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          {timeLabel(message.created_at).replace(/\s?[AP]M$/i, "")}
        </div>
      ) : (
        <div className="mt-0.5 h-[38px] w-[38px] shrink-0">
          {message.sender_id ? (
            <button
              type="button"
              onClick={openProfile(message.sender_id)}
              className="block border-0 bg-transparent p-0"
              aria-label={`Profile: ${name}`}
            >
              <Avatar profile={sender} size={38} radius={8} />
            </button>
          ) : (
            <Avatar profile={null} size={38} radius={8} />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        {(pinned || saved) && (
          <div className="flex items-center gap-3 text-[12px] font-semibold">
            {pinned && (
              <span className="flex items-center gap-1 text-[#B4661F]">
                <Icon name="pin" size={12} strokeWidth={2.4} /> Pinned
              </span>
            )}
            {saved && (
              <span className="flex items-center gap-1 text-link">
                <Icon name="later" size={12} strokeWidth={2.4} /> Saved for later
              </span>
            )}
          </div>
        )}
        {!compact && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            {message.sender_id ? (
              <button
                type="button"
                onClick={openProfile(message.sender_id)}
                className="border-0 bg-transparent p-0 text-[16px] font-bold text-ink hover:underline"
              >
                {name}
              </button>
            ) : (
              <span className="text-[16px] font-bold">{name}</span>
            )}
            <span className="text-[13px] text-muted">{timeLabel(message.created_at)}</span>
            {message.edited_at && <span className="text-[13px] text-muted">(edited)</span>}
            {VIA[message.sent_via] && (
              <span className="flex items-center gap-1 text-[13px] text-muted" title={VIA[message.sent_via].title}>
                <Icon name={VIA[message.sent_via].icon} size={13} /> {VIA[message.sent_via].label}
              </span>
            )}
            {internal && (
              <span className="text-[13px] font-semibold text-[#B4661F]">Internal note · not visible to owners</span>
            )}
          </div>
        )}
        {compact && message.edited_at && <span className="sr-only">(edited)</span>}

        {editing ? (
          <div className="mt-1 rounded-[10px] border border-input-border bg-input p-2">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKey}
              rows={1}
              aria-label="Edit message"
              className="block w-full resize-none border-0 bg-transparent px-1 text-[16px] leading-normal text-ink outline-none"
            />
            <div className="mt-1.5 flex items-center gap-2 text-[13px]">
              <span className="text-muted">Enter to save · Shift+Enter for a new line</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-8 rounded-md border border-input-border px-2.5 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="h-8 rounded-md px-2.5 font-semibold text-white"
                style={{ background: "var(--brand)" }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div style={{ opacity: message._status === "sending" ? 0.6 : 1 }}>
            {message.kind === "call_summary" ? (
              <CallSummary body={message.body} meta={(message.meta ?? {}) as CallMeta} />
            ) : (
              message.body && <MessageBody body={message.body} query={query} />
            )}
            {message.body && !message._status && previewableLink(message.body) && (
              <LinkPreview url={previewableLink(message.body)!} />
            )}
            {attachments.length > 0 && (
              <div className="mt-1 mb-2 flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <AttachmentView
                    key={a.id}
                    attachment={a}
                    url={isPending(a) ? undefined : urls[a.storage_path]}
                    onOpen={() => {
                      if (!isPending(a) && urls[a.storage_path])
                        window.open(urls[a.storage_path], "_blank", "noopener");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {groups.size > 0 && (
          <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-1.5">
            {Array.from(groups.entries()).map(([emoji, list]) => {
              const mine = list.some((r) => r.user_id === me.id);
              const who = list
                .map((r) => (r.user_id === me.id ? "You" : (profiles[r.user_id]?.display_name ?? "Someone")))
                .join(", ");
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(emoji)}
                  aria-pressed={mine}
                  title={`${who} reacted with ${emoji}`}
                  className="flex h-7 items-center gap-1 rounded-full border px-2 text-[14px] leading-none"
                  style={
                    mine
                      ? { borderColor: "var(--brand)", background: "rgba(93,129,86,.14)", color: "var(--text)" }
                      : { borderColor: "var(--input-border)", background: "var(--card)", color: "var(--text)" }
                  }
                >
                  <span className="text-[16px]">{emoji}</span>
                  <span className="font-semibold tabular-nums">{list.length}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMenu("emoji")}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-input-border bg-card text-muted hover:text-ink"
              aria-label="Add reaction"
            >
              <Icon name="smilePlus" size={15} />
            </button>
          </div>
        )}

        {!inThread && message.reply_count > 0 && onOpenThread && (
          <button
            type="button"
            onClick={onOpenThread}
            className="mt-0.5 mb-1 flex items-center gap-2 rounded-md py-0.5 pr-2 text-[14px] font-semibold text-link hover:underline"
          >
            <Icon name="messages" size={15} />
            {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
            <span className="font-normal text-muted">
              · Last reply {message.last_reply_at ? listTime(message.last_reply_at).toLowerCase() : ""}
            </span>
          </button>
        )}
        {message._status === "sending" && <div className="-mt-1 text-[13px] text-muted">Sending…</div>}
        {message._status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry?.(message)}
            className="-mt-1 flex items-center gap-1 text-[13px] font-semibold text-new"
          >
            <Icon name="retry" size={14} strokeWidth={2} /> Failed to send. Tap to retry
          </button>
        )}
      </div>

      {/* Hover / focus action bar */}
      {!system && !message._status && !editing && (
        <div
          className={`absolute -top-3.5 right-2 z-10 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 shadow-[0_4px_16px_rgba(0,0,0,.14)] ${
            menu !== "none" ? "flex" : "hidden group-focus-within:flex group-hover:flex"
          }`}
          role="toolbar"
          aria-label="Message actions"
        >
          {QUICK_REACTIONS.slice(0, 3).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onReact(e)}
              className={`${actionBtn} hidden text-[18px] sm:flex`}
              aria-label={`React with ${e}`}
            >
              {e}
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === "emoji" ? "none" : "emoji")}
              className={actionBtn}
              aria-label="Add reaction"
              title="Add reaction"
            >
              <Icon name="smilePlus" size={18} />
            </button>
            {menu === "emoji" && (
              <EmojiPicker
                align="right"
                below
                onClose={() => setMenu("none")}
                onPick={(e) => {
                  onReact(e);
                  setMenu("none");
                }}
              />
            )}
          </div>
          {!inThread && onOpenThread && (
            <button
              type="button"
              onClick={onOpenThread}
              className={actionBtn}
              aria-label="Reply in thread"
              title="Reply in thread"
            >
              <Icon name="messages" size={18} />
            </button>
          )}
          {onFile && (
            <button
              type="button"
              onClick={onFile}
              className={actionBtn}
              aria-label="File in a property thread"
              title="File in a property thread"
            >
              <Icon name="hash" size={18} />
            </button>
          )}
          {onToggleSave && (
            <button
              type="button"
              onClick={onToggleSave}
              className={actionBtn}
              aria-label={saved ? "Remove from saved" : "Save for later"}
              title={saved ? "Remove from saved" : "Save for later"}
              aria-pressed={saved}
            >
              <Icon name="later" size={18} filled={saved} style={saved ? { color: "var(--link)" } : undefined} />
            </button>
          )}
          <button
            type="button"
            onClick={onTogglePin}
            className={actionBtn}
            aria-label={pinned ? "Unpin message" : "Pin message"}
            title={pinned ? "Unpin" : "Pin to conversation"}
            aria-pressed={pinned}
          >
            <Icon name="pin" size={18} filled={pinned} style={pinned ? { color: "#B4661F" } : undefined} />
          </button>
          {modifiable && (
            <>
              <button type="button" onClick={startEdit} className={actionBtn} aria-label="Edit message" title="Edit">
                <Icon name="pencil" size={18} />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenu(menu === "confirmDelete" ? "none" : "confirmDelete")}
                  className={`${actionBtn} text-new`}
                  aria-label="Delete message"
                  title="Delete"
                >
                  <Icon name="trash" size={18} />
                </button>
                {menu === "confirmDelete" && (
                  <div
                    role="dialog"
                    aria-label="Delete this message?"
                    className="absolute top-full right-0 z-30 mt-1 w-[240px] rounded-xl border border-line bg-panel p-3 text-ink shadow-[0_12px_40px_rgba(0,0,0,.25)]"
                  >
                    <div className="text-[15px] font-semibold">Delete this message?</div>
                    <p className="mt-1 text-[13px] text-muted">This can&apos;t be undone.</p>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setMenu("none")}
                        className="h-8 rounded-md border border-input-border px-2.5 text-[13px] font-semibold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu("none");
                          onDelete();
                        }}
                        className="h-8 rounded-md bg-new px-2.5 text-[13px] font-semibold text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
