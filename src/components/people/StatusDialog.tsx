"use client";

import { useState } from "react";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";
import { EmojiPicker } from "@/components/conversation/EmojiPicker";
import { activeStatus, dndActive } from "@/lib/presence";

const CLEAR_OPTIONS = [
  { id: "never", label: "Don't clear" },
  { id: "30m", label: "30 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "4h", label: "4 hours" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
] as const;
const DND_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "30m", label: "30 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "2h", label: "2 hours" },
  { id: "tomorrow", label: "Until tomorrow" },
  { id: "week", label: "Until next week" },
] as const;
type ClearId = (typeof CLEAR_OPTIONS)[number]["id"];
type DndId = (typeof DND_OPTIONS)[number]["id"];

const SUGGESTIONS: { emoji: string; text: string; clear: ClearId }[] = [
  { emoji: "📅", text: "In a meeting", clear: "1h" },
  { emoji: "🚗", text: "Commuting", clear: "30m" },
  { emoji: "🤒", text: "Out sick", clear: "today" },
  { emoji: "🌴", text: "On holiday", clear: "week" },
  { emoji: "🏠", text: "Working remotely", clear: "today" },
];

export function untilFor(id: ClearId | DndId, now = new Date()): string | null {
  const d = new Date(now);
  switch (id) {
    case "never":
    case "off":
      return null;
    case "30m":
      return new Date(d.getTime() + 30 * 60_000).toISOString();
    case "1h":
      return new Date(d.getTime() + 60 * 60_000).toISOString();
    case "2h":
      return new Date(d.getTime() + 120 * 60_000).toISOString();
    case "4h":
      return new Date(d.getTime() + 240 * 60_000).toISOString();
    case "today":
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    case "week": {
      const day = d.getDay(); // 0 = Sunday
      d.setDate(d.getDate() + ((8 - (day || 7)) % 7 || 7));
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand";

/** "Set a status" and "Pause notifications" in one sheet, as in Slack. */
export function StatusDialog({ onClose }: { onClose: () => void }) {
  const { me, updateMe } = useStore();
  const current = activeStatus(me);
  const [emoji, setEmoji] = useState(current?.emoji ?? "");
  const [text, setText] = useState(current?.text ?? "");
  const [clear, setClear] = useState<ClearId>(current ? "never" : "1h");
  const [dnd, setDnd] = useState<DndId>(dndActive(me) ? "off" : "off");
  const [keepDnd, setKeepDnd] = useState(dndActive(me));
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const has = text.trim() || emoji;
    await updateMe({
      status_text: has ? text.trim() : null,
      status_emoji: has ? emoji || null : null,
      status_expires_at: has ? untilFor(clear) : null,
      dnd_until: keepDnd ? me.dnd_until : untilFor(dnd),
    });
    setBusy(false);
    onClose();
  };

  const clearStatus = async () => {
    setBusy(true);
    await updateMe({ status_text: null, status_emoji: null, status_expires_at: null });
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Set a status"
        className="w-full max-w-[520px] rounded-t-2xl bg-panel p-5 text-ink shadow-[0_12px_40px_rgba(0,0,0,.35)] md:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[20px] font-bold">Set a status</h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-hover"
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="relative flex gap-2">
          <button
            type="button"
            onClick={() => setPicker((v) => !v)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-input-border bg-input text-[22px]"
            aria-label="Choose an emoji"
          >
            {emoji || <Icon name="emoji" size={20} className="text-muted" />}
          </button>
          {picker && (
            <div className="absolute top-12 left-0 z-10">
              <EmojiPicker
                below
                onPick={(e) => {
                  setEmoji(e);
                  setPicker(false);
                }}
                onClose={() => setPicker(false)}
              />
            </div>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 100))}
            placeholder="What's your status?"
            aria-label="Status text"
            className={input}
            autoFocus
          />
        </div>
        {!text && !emoji && (
          <div className="mt-3 flex flex-col">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                type="button"
                onClick={() => {
                  setEmoji(s.emoji);
                  setText(s.text);
                  setClear(s.clear);
                }}
                className="flex h-10 items-center gap-3 rounded-md px-2 text-left text-[15px] hover:bg-hover"
              >
                <span className="text-[18px]">{s.emoji}</span>
                <span className="flex-1">{s.text}</span>
                <span className="text-[13px] text-muted">{CLEAR_OPTIONS.find((o) => o.id === s.clear)?.label}</span>
              </button>
            ))}
          </div>
        )}
        {(text || emoji) && (
          <label className="mt-3 flex items-center gap-3 text-[14px] font-semibold">
            Clear after
            <select
              value={clear}
              onChange={(e) => setClear(e.target.value as ClearId)}
              className="h-10 flex-1 rounded-lg border border-input-border bg-input px-3 text-[15px] font-normal text-ink"
              aria-label="Clear status after"
            >
              {CLEAR_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-bold">
            <Icon name="bellOff" size={16} /> Pause notifications
          </div>
          <p className="mb-2 text-[13px] text-muted">
            {dndActive(me) && keepDnd
              ? `Paused until ${new Date(me.dnd_until!).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
              : "No email or activity notifications while paused. Mentions still show when you open the app."}
          </p>
          {dndActive(me) && keepDnd ? (
            <button
              type="button"
              onClick={() => setKeepDnd(false)}
              className="h-9 rounded-lg border border-input-border px-3 text-[14px] font-semibold hover:bg-hover"
            >
              Resume notifications
            </button>
          ) : (
            <select
              value={dnd}
              onChange={(e) => setDnd(e.target.value as DndId)}
              className="h-10 w-full rounded-lg border border-input-border bg-input px-3 text-[15px] text-ink"
              aria-label="Pause notifications for"
            >
              {DND_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {current && (
            <button
              type="button"
              onClick={() => void clearStatus()}
              disabled={busy}
              className="h-10 rounded-lg border border-input-border px-3 text-[14px] font-semibold hover:bg-hover"
            >
              Clear status
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg border border-input-border px-3.5 text-[15px] font-semibold hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="h-10 rounded-lg px-4 text-[15px] font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand)" }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
