"use client";

import { useState } from "react";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";
import { EmojiPicker } from "@/components/conversation/EmojiPicker";
import {
  CLEAR_OPTIONS,
  DND_OPTIONS,
  activeStatus,
  dndActive,
  manualAway,
  untilFor,
  type ClearId,
  type DndId,
} from "@/lib/presence";

const SUGGESTIONS: { emoji: string; text: string; clear: ClearId }[] = [
  { emoji: "📅", text: "In a meeting", clear: "1h" },
  { emoji: "🚗", text: "Commuting", clear: "30m" },
  { emoji: "🤒", text: "Out sick", clear: "today" },
  { emoji: "🌴", text: "On holiday", clear: "week" },
  { emoji: "🏠", text: "Working remotely", clear: "today" },
];

/** Sentinel for "leave the existing away expiry alone"; not one of the CLEAR_OPTIONS ids. */
const KEEP = "__keep__";

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
  const [away, setAway] = useState(manualAway(me));
  // null = the expiry select has not been touched. An existing away_until is a timestamp and
  // cannot be mapped back onto one of these ids, so leaving it alone is the only way not to
  // silently turn "away until 3pm" into "away indefinitely" when someone opens this sheet
  // just to set a status.
  const [awayClear, setAwayClear] = useState<ClearId | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  /** True when there is an existing away expiry worth offering to keep as-is. */
  const keepsAwayUntil = manualAway(me) && !!me.away_until;

  const save = async () => {
    setBusy(true);
    const has = text.trim() || emoji;
    await updateMe({
      status_text: has ? text.trim() : null,
      status_emoji: has ? emoji || null : null,
      status_expires_at: has ? untilFor(clear) : null,
      dnd_until: keepDnd ? me.dnd_until : untilFor(dnd),
      presence_mode: away ? "away" : "auto",
      // Keep the original away_since when it was already set, so "Away since Tuesday" stays true.
      away_since: away ? (manualAway(me) ? me.away_since : new Date().toISOString()) : null,
      away_until: away ? (awayClear ? untilFor(awayClear) : manualAway(me) ? me.away_until : null) : null,
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
          <label className="flex items-center gap-3 text-[15px] font-bold">
            <Icon name="moon" size={16} />
            <span className="flex-1">Set yourself away</span>
            <input
              type="checkbox"
              checked={away}
              onChange={(e) => setAway(e.target.checked)}
              className="h-5 w-5 accent-[var(--brand)]"
              aria-label="Set yourself away"
            />
          </label>
          <p className="mt-1 text-[13px] text-muted">
            People see an Away badge and every notification stops, email and in-app, until you turn this off.
          </p>
          {away && (
            <label className="mt-2 flex items-center gap-3 text-[14px] font-semibold">
              Clear after
              <select
                value={awayClear ?? (keepsAwayUntil ? KEEP : "never")}
                onChange={(e) => setAwayClear(e.target.value === KEEP ? null : (e.target.value as ClearId))}
                className="h-10 flex-1 rounded-lg border border-input-border bg-input px-3 text-[15px] font-normal text-ink"
                aria-label="Clear away after"
              >
                {manualAway(me) && me.away_until && (
                  <option value={KEEP}>
                    Keep{" "}
                    {new Date(me.away_until).toLocaleString("en-GB", {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </option>
                )}
                {CLEAR_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

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
