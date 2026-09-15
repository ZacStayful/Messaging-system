"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { QUICK_REACTIONS, searchEmoji } from "@/lib/emoji";

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
  align?: "left" | "right";
  /** Positions the panel below the trigger instead of above (message action bars near the top). */
  below?: boolean;
}

export function EmojiPicker({ onPick, onClose, align = "left", below = false }: EmojiPickerProps) {
  const [q, setQ] = useState("");
  const results = searchEmoji(q);
  return (
    <Popover
      onClose={onClose}
      align={align}
      label="Choose an emoji"
      className={`w-[300px] max-w-[calc(100vw-24px)] p-2.5 ${below ? "top-full bottom-auto mt-2 mb-0" : ""}`}
    >
      <div className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-input-border bg-input px-2.5 text-muted">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none"
        />
      </div>
      {!q && (
        <div className="mb-1.5 flex items-center gap-1 px-0.5">
          <span className="mr-1 text-[12px] font-semibold text-muted">Frequently used</span>
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onPick(e)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] hover:bg-hover"
              aria-label={`React with ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="scroll-thin grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto">
        {results.map((e) => (
          <button
            key={e.char + e.name}
            type="button"
            title={e.name}
            aria-label={e.name}
            onClick={() => onPick(e.char)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none hover:bg-hover"
          >
            {e.char}
          </button>
        ))}
        {results.length === 0 && <p className="col-span-8 py-4 text-center text-[14px] text-muted">No emoji match.</p>}
      </div>
    </Popover>
  );
}
