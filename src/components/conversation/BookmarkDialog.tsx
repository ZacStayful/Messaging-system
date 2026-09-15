"use client";

import { useState } from "react";
import type { ConversationBookmark } from "@/lib/database.types";
import { Icon } from "@/components/ui/Icon";
import { EmojiPicker } from "./EmojiPicker";
import { safeHttpUrl } from "@/lib/urls";
import type { UnfurlResult } from "@/app/api/unfurl/route";

export interface BookmarkDraft {
  title: string;
  url: string;
  emoji: string | null;
  note: string | null;
}

interface BookmarkDialogProps {
  /** The bookmark being edited, or null when adding a new one. */
  bookmark: ConversationBookmark | null;
  onSave: (draft: BookmarkDraft) => Promise<void>;
  onClose: () => void;
}

const input =
  "h-11 w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] text-ink outline-none focus:border-brand";

export function BookmarkDialog({ bookmark, onSave, onClose }: BookmarkDialogProps) {
  const [url, setUrl] = useState(bookmark?.url ?? "");
  const [title, setTitle] = useState(bookmark?.title ?? "");
  const [emoji, setEmoji] = useState(bookmark?.emoji ?? "");
  const [note, setNote] = useState(bookmark?.note ?? "");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fill an empty title from the page's Open Graph data. /api/unfurl is signed-in only, blocks
   * private hosts and caches for a week, so this costs one request per new link at most.
   */
  const prefill = async () => {
    const parsed = safeHttpUrl(url);
    if (!parsed || title.trim()) return;
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(parsed.toString())}`);
      if (!res.ok) return;
      const data: UnfurlResult = await res.json();
      if (data.title) setTitle(data.title.slice(0, 120));
    } catch {
      // A title the person can type themselves is not worth an error message.
    }
  };

  const save = async () => {
    const parsed = safeHttpUrl(url);
    if (!parsed) {
      setError("Enter a full http:// or https:// link. Private and local addresses are not allowed.");
      return;
    }
    if (!title.trim()) {
      setError("Give the bookmark a short title so people know what it is.");
      return;
    }
    setError(null);
    setBusy(true);
    await onSave({
      title: title.trim().slice(0, 120),
      url: parsed.toString(),
      emoji: emoji || null,
      note: note.trim() || null,
    });
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 md:items-center md:p-6"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={bookmark ? "Edit bookmark" : "Add a bookmark"}
        className="w-full max-w-[520px] rounded-t-2xl bg-panel p-5 text-ink shadow-[0_12px_40px_rgba(0,0,0,.35)] md:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-[20px] font-bold">{bookmark ? "Edit bookmark" : "Add a bookmark"}</h2>
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

        <label className="mb-1 block text-[14px] font-semibold">Link</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void prefill()}
          placeholder="https://"
          aria-label="Bookmark link"
          className={input}
          autoFocus
          inputMode="url"
        />

        <label className="mt-3 mb-1 block text-[14px] font-semibold">Title</label>
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
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 120))}
            placeholder="Cleaning rota"
            aria-label="Bookmark title"
            className={input}
          />
        </div>

        <label className="mt-3 mb-1 block text-[14px] font-semibold">
          Note <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder="Anything worth knowing — a gate code, which tab to open, who to ask."
          aria-label="Bookmark note"
          rows={3}
          className="w-full resize-none rounded-lg border border-input-border bg-input px-3.5 py-2.5 text-[16px] text-ink outline-none focus:border-brand"
        />

        {error && <p className="mt-3 text-[14px] text-[#D4674A]">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
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
            {busy ? "Saving…" : bookmark ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
