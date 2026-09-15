"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useDraft } from "@/lib/drafts";

interface ComposerProps {
  conversationId: string;
  placeholder: string;
  canPostInternal: boolean;
  onSend: (body: string, visibility: "public" | "internal") => void;
}

const toolBtn = "flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-hover";

export function Composer({ conversationId, placeholder, canPostInternal, onSend }: ComposerProps) {
  const [draft, update] = useDraft(conversationId);
  const [internal, setInternal] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text, internal ? "internal" : "public");
    update("");
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const hasText = draft.trim().length > 0;
  const tools: { icon: IconName; label: string }[] = [
    { icon: "emoji", label: "Emoji" },
    { icon: "mention", label: "Mention someone" },
  ];
  const media: { icon: IconName; label: string }[] = [
    { icon: "video", label: "Record video" },
    { icon: "mic", label: "Record audio" },
  ];

  return (
    <div className="shrink-0 px-3 pb-3 md:px-5 md:pb-[18px]">
      <div
        className="rounded-[10px] border bg-input shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-muted"
        style={{ borderColor: internal ? "#E28A2B" : "var(--input-border)", background: internal ? "rgba(226,138,43,.06)" : undefined }}
      >
        {internal && (
          <div className="flex items-center gap-2 px-3.5 pt-2 text-[12px] font-semibold text-[#B4661F]">
            Internal note · only the Stayful team will see this
          </div>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-1 text-[15px] leading-normal text-ink outline-none"
          style={{ minHeight: 44 }}
        />
        <div className="flex items-center gap-0.5 px-2 pt-1 pb-2 text-ink">
          <button type="button" className="mr-1.5 flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-soft text-ink" aria-label="Attach" title="Attachments are coming in the next release">
            <Icon name="plus" size={18} strokeWidth={2} />
          </button>
          <button type="button" className="h-[30px] rounded-md border-0 bg-transparent px-1.5 text-[16px] font-medium text-ink hover:bg-hover" aria-label="Formatting" title="Use **bold**, - lists and [links](url)">
            Aa
          </button>
          {tools.map((t) => (
            <button key={t.icon} type="button" className={toolBtn} aria-label={t.label} title={t.label}>
              <Icon name={t.icon} size={19} />
            </button>
          ))}
          <span className="mx-1.5 h-5 w-px bg-line" />
          {media.map((t) => (
            <button key={t.icon} type="button" className={`${toolBtn} hidden sm:flex`} aria-label={t.label} title={t.label}>
              <Icon name={t.icon} size={19} />
            </button>
          ))}
          <span className="mx-1.5 hidden h-5 w-px bg-line sm:block" />
          <button type="button" className={`${toolBtn} hidden sm:flex`} aria-label="Shortcuts" title="Shortcuts">
            <Icon name="slash" size={19} />
          </button>
          {canPostInternal && (
            <button
              type="button"
              onClick={() => setInternal((v) => !v)}
              aria-pressed={internal}
              className="ml-1 h-[26px] rounded-md px-2 text-[12px] font-semibold"
              style={internal ? { background: "#E28A2B", color: "#fff" } : { border: "1px solid var(--input-border)", color: "var(--muted)" }}
              title="Internal notes are never shown to owners"
            >
              Internal note
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={send}
            disabled={!hasText}
            className="flex h-[30px] items-center gap-1.5 rounded-md border-0 px-2.5 disabled:cursor-default"
            style={{ background: hasText ? "var(--brand)" : "transparent", color: hasText ? "#fff" : "var(--muted)" }}
            aria-label="Send"
          >
            <Icon name="send" size={18} />
            <Icon name="chevronDown" size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
