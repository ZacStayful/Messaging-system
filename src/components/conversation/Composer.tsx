"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Popover";
import { useDraft } from "@/lib/drafts";
import { durationLabel } from "@/lib/format";
import { mentionToken } from "@/lib/richtext";
import { parseSlash, type SlashCommand } from "@/lib/slash";
import { useBoolPref } from "@/lib/prefs";
import { useNow } from "@/lib/useNow";
import { Menu } from "@/components/ui/Menu";
import { ACCEPT_ATTR, baseMime, validateFile } from "@/lib/storage/attachments";
import { EmojiPicker } from "./EmojiPicker";
import { AttachmentView, type PendingAttachment } from "./AttachmentView";

/** A file chosen in the composer, waiting to be sent with the next message. */
export interface OutgoingFile {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  previewUrl?: string;
  voice?: boolean;
  duration_ms?: number;
}

/** Window event other parts of the pane fire when files are dropped onto them. */
export const ATTACH_EVENT = "stayful:attach";

interface ComposerProps {
  conversationId: string;
  /** Separate draft storage, e.g. one per thread. Defaults to the conversation. */
  draftKey?: string;
  placeholder: string;
  canPostInternal: boolean;
  members: Profile[];
  onSend: (body: string, visibility: "public" | "internal", files: OutgoingFile[]) => void;
  /** Slash commands the picker offers; `onCommand` returns true when it handled the text. */
  commands?: SlashCommand[];
  onCommand?: (name: string, args: string, visibility: "public" | "internal") => boolean;
  /** Schedule the text to be posted later (no files). */
  onSchedule?: (body: string, visibility: "public" | "internal", sendAt: Date) => void;
  /** Fired (throttled) while typing, for the typing indicator. */
  onTyping?: () => void;
  /** ↑ in an empty composer: edit your last message. */
  onEditLast?: () => void;
}

const SLASH_TRIGGER = /^\/([a-z]*)$/i;

const toolBtn =
  "flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-hover disabled:opacity-40";

const MENTION_TRIGGER = /(^|\s)@([^\s@]*(?: [^\s@]*)?)$/;

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function Composer({
  conversationId,
  draftKey,
  placeholder,
  canPostInternal,
  members,
  onSend,
  commands = [],
  onCommand,
  onSchedule,
  onTyping,
  onEditLast,
}: ComposerProps) {
  const [draft, update] = useDraft(draftKey ?? conversationId);
  const [format, setFormat] = useBoolPref("composer.format", false);
  const [slash, setSlash] = useState<{ query: string; index: number } | null>(null);
  const [schedule, setSchedule] = useState<"none" | "menu" | "custom">("none");
  const [customAt, setCustomAt] = useState("");
  const lastTyping = useRef(0);
  const now = useNow(30_000);
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState<OutgoingFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<"none" | "attach" | "emoji">("none");
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState<{ startedAt: number; elapsed: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discardRecording = useRef(false);
  /**
   * The live microphone tracks, held separately from the recorder.
   *
   * rec.onstop was the only thing that stopped them, and it is only reached through
   * recorder.current.stop(). recorder.current is assigned *after* `await getUserMedia`, so
   * unmounting while the permission prompt is up left the cleanup with nothing to stop, and the
   * stream the await then handed back was never released — the browser's recording indicator
   * stayed lit for the rest of the session.
   */
  const mediaStream = useRef<MediaStream | null>(null);
  /** Set before the await, so a second tap during acquisition cannot start a second recorder. */
  const acquiring = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  // ---- files ----------------------------------------------------------------
  const addFiles = useCallback((incoming: Iterable<File>) => {
    const next: OutgoingFile[] = [];
    const problems: string[] = [];
    for (const f of incoming) {
      const problem = validateFile(f);
      if (problem) {
        problems.push(problem);
        continue;
      }
      const mime = baseMime(f.type);
      next.push({
        id: crypto.randomUUID(),
        blob: f,
        name: f.name,
        mime,
        previewUrl: mime.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      });
    }
    if (next.length) setFiles((prev) => [...prev, ...next].slice(0, 10));
    setError(problems[0] ?? null);
    setMenu("none");
  }, []);

  useEffect(() => {
    const onAttach = (e: Event) => addFiles((e as CustomEvent<File[]>).detail);
    window.addEventListener(ATTACH_EVENT, onAttach);
    return () => window.removeEventListener(ATTACH_EVENT, onAttach);
  }, [addFiles]);

  const removeFile = (id: string) =>
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((x) => x.id !== id);
    });

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      setDragging(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ---- voice notes ----------------------------------------------------------
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(
      () => setRecording((r) => (r ? { ...r, elapsed: Date.now() - r.startedAt } : r)),
      250,
    );
    return () => window.clearInterval(id);
  }, [recording]);

  /** Stops every track and forgets the stream. Safe to call twice; safe to call with none. */
  const releaseMicrophone = () => {
    mediaStream.current?.getTracks().forEach((t) => t.stop());
    mediaStream.current = null;
  };

  const startRecording = async () => {
    setMenu("none");
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !pickRecorderMime()) {
      setError("Voice notes aren't supported in this browser.");
      return;
    }
    if (acquiring.current || recorder.current) return;
    acquiring.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      const mimeType = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      discardRecording.current = false;
      const startedAt = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        releaseMicrophone();
        const duration = Date.now() - startedAt;
        setRecording(null);
        if (discardRecording.current || duration < 500 || chunks.current.length === 0) return;
        const mime = baseMime(mimeType);
        const ext = mime === "audio/mp4" ? "m4a" : mime === "audio/mpeg" ? "mp3" : "webm";
        const blob = new Blob(chunks.current, { type: mime });
        setFiles((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            blob,
            name: `Voice note ${new Date(startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.${ext}`,
            mime,
            voice: true,
            duration_ms: duration,
            previewUrl: URL.createObjectURL(blob),
          },
        ]);
      };
      recorder.current = rec;
      rec.start(250);
      setRecording({ startedAt, elapsed: 0 });
    } catch {
      // MediaRecorder can throw after getUserMedia has already succeeded, so the stream has to
      // be released here too; otherwise the failure message appears with the mic still live.
      releaseMicrophone();
      setError("Microphone access was blocked. Allow the microphone for chat.stayful.co.uk and try again.");
    } finally {
      acquiring.current = false;
    }
  };
  const stopRecording = (discard = false) => {
    discardRecording.current = discard;
    recorder.current?.stop();
    recorder.current = null;
    // stop() fires onstop, which releases the microphone — but only if the recorder was still
    // running. Releasing again here is harmless and covers a recorder already in "inactive".
    releaseMicrophone();
  };
  // Stop the recorder *and* the tracks: unmounting mid-acquisition leaves recorder.current null
  // while the stream is live, which is exactly the case that used to strand the microphone.
  useEffect(
    () => () => {
      recorder.current?.stop();
      recorder.current = null;
      releaseMicrophone();
    },
    [],
  );

  // ---- mentions -------------------------------------------------------------
  const mentionCandidates = mention
    ? members
        .filter((p) => {
          const q = mention.query.toLowerCase();
          return !q || `${p.display_name} ${p.full_name ?? ""}`.toLowerCase().includes(q);
        })
        .slice(0, 8)
    : [];

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = MENTION_TRIGGER.exec(before);
    if (m) setMention({ query: m[2], index: 0 });
    else setMention(null);
  };

  const insertAtCaret = (insert: string, replaceBack = 0) => {
    const el = ref.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const next = draft.slice(0, start - replaceBack) + insert + draft.slice(end);
    update(next);
    const pos = start - replaceBack + insert.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  /** Wraps the selection (or inserts a placeholder) with markdown markers. */
  const wrapSelection = (before: string, after = before, placeholder = "text") => {
    const el = ref.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const selected = draft.slice(start, end);
    const inner = selected || placeholder;
    const next = draft.slice(0, start) + before + inner + after + draft.slice(end);
    update(next);
    const selStart = start + before.length;
    const selEnd = selStart + inner.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(selStart, selEnd);
    });
  };

  /** Prefixes every selected line (or the current one) for lists and quotes. */
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = ref.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const lineStart = draft.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = draft.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? draft.length : lineEndIdx;
    const lines = draft.slice(lineStart, lineEnd).split("\n");
    const out = lines.map((l, i) => (typeof prefix === "string" ? prefix : prefix(i)) + l).join("\n");
    const next = draft.slice(0, lineStart) + out + draft.slice(lineEnd);
    update(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(lineStart + out.length, lineStart + out.length);
    });
  };

  const codeBlock = () => {
    const el = ref.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const selected = draft.slice(start, end) || "code";
    const next = `${draft.slice(0, start)}\`\`\`\n${selected}\n\`\`\`${draft.slice(end)}`;
    update(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + 4, start + 4 + selected.length);
    });
  };

  const insertLink = () => {
    const el = ref.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const selected = draft.slice(start, end);
    const isUrl = /^https?:\/\//.test(selected);
    const text = isUrl ? "link text" : selected || "link text";
    const href = isUrl ? selected : "https://";
    const next = `${draft.slice(0, start)}[${text}](${href})${draft.slice(end)}`;
    update(next);
    const pos = isUrl ? start + 1 : start + 1 + text.length + 2;
    const len = isUrl ? text.length : href.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos + len);
    });
  };

  // ---- slash commands -------------------------------------------------------
  const slashCandidates = slash ? commands.filter((c) => c.name.startsWith(slash.query.toLowerCase())).slice(0, 8) : [];
  const detectSlash = (text: string) => {
    const m = SLASH_TRIGGER.exec(text);
    if (m && commands.length) setSlash({ query: m[1], index: 0 });
    else setSlash(null);
  };
  const pickSlash = (c: SlashCommand) => {
    setSlash(null);
    if (c.args) {
      update(`/${c.name} `);
      requestAnimationFrame(() => ref.current?.focus());
    } else {
      update("");
      onCommand?.(c.name, "", internal ? "internal" : "public");
    }
  };

  const pickMention = (p: Profile) => {
    if (!mention) return;
    insertAtCaret(`${mentionToken(p.display_name)} `, mention.query.length + 1);
    setMention(null);
  };

  // ---- send -----------------------------------------------------------------
  const hasText = draft.trim().length > 0;
  const canSend = (hasText || files.length > 0) && !recording;

  const send = () => {
    if (!canSend) return;
    const cmd = onCommand && files.length === 0 ? parseSlash(draft) : null;
    if (cmd && commands.some((c) => c.name === cmd.name)) {
      const handled = onCommand!(cmd.name, cmd.args, internal ? "internal" : "public");
      if (handled) {
        update("");
        setSlash(null);
        setError(null);
        return;
      }
    }
    onSend(draft.trim(), internal ? "internal" : "public", files);
    update("");
    setFiles([]);
    setError(null);
    ref.current?.focus();
  };

  const scheduleAt = (when: Date) => {
    if (!hasText || !onSchedule) return;
    onSchedule(draft.trim(), internal ? "internal" : "public", when);
    update("");
    setSchedule("none");
    setError(null);
  };
  const nextMorning = (daysAhead: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const nextMonday = () => {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() + ((8 - (day || 7)) % 7 || 7));
    d.setHours(9, 0, 0, 0);
    return d;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        wrapSelection("**");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        wrapSelection("_");
        return;
      }
      if (e.shiftKey && k === "x") {
        e.preventDefault();
        wrapSelection("~");
        return;
      }
      if (e.shiftKey && k === "c") {
        e.preventDefault();
        wrapSelection("`");
        return;
      }
    }
    if (slash && slashCandidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + delta + slashCandidates.length) % slashCandidates.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickSlash(slashCandidates[slash.index]);
        return;
      }
      if (e.key === "Escape") {
        setSlash(null);
        return;
      }
    }
    if (e.key === "ArrowUp" && draft.length === 0 && !mention && onEditLast) {
      e.preventDefault();
      onEditLast();
      return;
    }
    if (mention && mentionCandidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setMention({
          ...mention,
          index: (mention.index + delta + mentionCandidates.length) % mentionCandidates.length,
        });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionCandidates[mention.index]);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const pendingViews: PendingAttachment[] = files.map((f) => ({
    id: f.id,
    file_name: f.name,
    mime: f.mime,
    size_bytes: f.blob.size,
    previewUrl: f.previewUrl,
    progress: "uploading",
    voice: f.voice,
    duration_ms: f.duration_ms,
  }));

  const openFiles = () => fileInput.current?.click();
  const openCamera = () => cameraInput.current?.click();
  const attachOption = "flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[15px] font-medium hover:bg-hover";

  return (
    <div
      className="shrink-0 px-3 pb-3 md:px-5 md:pb-[18px]"
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        aria-label="Choose files"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Take a photo"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        className="relative rounded-[10px] border bg-input shadow-[0_1px_2px_rgba(0,0,0,.04)] focus-within:border-muted"
        style={{
          borderColor: dragging ? "var(--brand)" : internal ? "#E28A2B" : "var(--input-border)",
          background: internal ? "rgba(226,138,43,.06)" : undefined,
          outline: dragging ? "2px dashed var(--brand)" : undefined,
        }}
      >
        {internal && (
          <div className="flex items-center gap-2 px-3.5 pt-2 text-[13px] font-semibold text-[#B4661F]">
            Internal note · only the Stayful team will see this
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[10px] bg-panel/85 text-[15px] font-semibold text-link">
            Drop files to attach
          </div>
        )}

        {mention && mentionCandidates.length > 0 && (
          <div
            role="listbox"
            aria-label="Mention someone"
            className="absolute bottom-full left-3 z-30 mb-2 w-[300px] max-w-[calc(100vw-40px)] overflow-hidden rounded-xl border border-line bg-panel py-1 text-ink shadow-[0_12px_40px_rgba(0,0,0,.25)]"
          >
            {mentionCandidates.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === mention.index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(p)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left"
                style={i === mention.index ? { background: "var(--hover)" } : undefined}
              >
                <Avatar profile={p} size={26} radius={6} />
                <span className="text-[15px] font-semibold">{p.display_name}</span>
                <span className="truncate text-[14px] text-muted">{p.full_name}</span>
                {p.account_type === "team" && (
                  <span className="ml-auto rounded bg-soft px-1.5 py-0.5 text-[11px] font-semibold text-link">
                    Stayful
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {slash && slashCandidates.length > 0 && (
          <div
            role="listbox"
            aria-label="Commands"
            className="absolute bottom-full left-3 z-30 mb-2 w-[360px] max-w-[calc(100vw-40px)] overflow-hidden rounded-xl border border-line bg-panel py-1 text-ink shadow-[0_12px_40px_rgba(0,0,0,.25)]"
          >
            {slashCandidates.map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === slash.index}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSlash(c)}
                className="flex w-full items-center gap-3 px-3 py-1.5 text-left"
                style={i === slash.index ? { background: "var(--hover)" } : undefined}
              >
                <span className="text-[15px] font-semibold">
                  /{c.name} {c.args && <span className="font-normal text-muted">{c.args}</span>}
                </span>
                <span className="ml-auto truncate text-[13px] text-muted">{c.description}</span>
              </button>
            ))}
          </div>
        )}

        {format && !recording && (
          <div
            className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1"
            role="toolbar"
            aria-label="Formatting"
          >
            <button
              type="button"
              onClick={() => wrapSelection("**")}
              className={`${toolBtn} font-bold`}
              aria-label="Bold"
              title="Bold (Ctrl+B)"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => wrapSelection("_")}
              className={`${toolBtn} italic`}
              aria-label="Italic"
              title="Italic (Ctrl+I)"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => wrapSelection("~")}
              className={`${toolBtn} line-through`}
              aria-label="Strikethrough"
              title="Strikethrough (Ctrl+Shift+X)"
            >
              S
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <button type="button" onClick={insertLink} className={toolBtn} aria-label="Link" title="Link">
              <Icon name="link" size={17} />
            </button>
            <button
              type="button"
              onClick={() => prefixLines(() => "1. ")}
              className={`${toolBtn} text-[12px] font-bold`}
              aria-label="Numbered list"
              title="Numbered list"
            >
              1.
            </button>
            <button
              type="button"
              onClick={() => prefixLines("- ")}
              className={`${toolBtn} text-[16px] font-bold`}
              aria-label="Bulleted list"
              title="Bulleted list"
            >
              •
            </button>
            <button
              type="button"
              onClick={() => prefixLines("> ")}
              className={`${toolBtn} text-[16px] font-bold`}
              aria-label="Quote"
              title="Quote"
            >
              &ldquo;
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <button
              type="button"
              onClick={() => wrapSelection("`")}
              className={toolBtn}
              aria-label="Code"
              title="Inline code (Ctrl+Shift+C)"
            >
              <Icon name="code" size={17} />
            </button>
            <button
              type="button"
              onClick={codeBlock}
              className={`${toolBtn} font-mono text-[12px] font-bold`}
              aria-label="Code block"
              title="Code block"
            >
              {"{ }"}
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-3 px-3.5 pt-3">
            {pendingViews.map((p) => (
              <AttachmentView key={p.id} attachment={p} onRemove={() => removeFile(p.id)} />
            ))}
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="h-3 w-3 animate-pulse rounded-full bg-new" aria-hidden="true" />
            <span className="text-[16px] font-semibold tabular-nums">{durationLabel(recording.elapsed)}</span>
            <span className="text-[14px] text-muted">Recording a voice note…</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => stopRecording(true)}
              className="h-9 rounded-md border border-input-border px-3 text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => stopRecording(false)}
              className="flex h-9 items-center gap-1.5 rounded-md px-3 text-[14px] font-semibold text-white"
              style={{ background: "var(--brand)" }}
            >
              <Icon name="stop" size={14} filled strokeWidth={0} /> Stop
            </button>
          </div>
        ) : (
          <textarea
            ref={ref}
            rows={1}
            value={draft}
            onChange={(e) => {
              update(e.target.value);
              detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
              detectSlash(e.target.value);
              if (onTyping && e.target.value && Date.now() - lastTyping.current > 2500) {
                lastTyping.current = Date.now();
                onTyping();
              }
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="block w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-1 text-[16px] leading-normal text-ink outline-none"
            style={{ minHeight: 44 }}
          />
        )}

        {error && (
          <p role="alert" className="px-3.5 pb-1 text-[13px] font-medium text-new">
            {error}
          </p>
        )}

        <div className="flex items-center gap-0.5 px-2 pt-1 pb-2 text-ink">
          <div className="relative mr-1.5">
            <button
              type="button"
              onClick={() => setMenu(menu === "attach" ? "none" : "attach")}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-0 bg-soft text-ink"
              aria-label="Attach"
              aria-expanded={menu === "attach"}
              title="Attach files, photos or a voice note"
            >
              <Icon name="plus" size={18} strokeWidth={2} />
            </button>
            {menu === "attach" && (
              <Popover onClose={() => setMenu("none")} label="Attach" className="w-[260px] py-1">
                <button type="button" onClick={openFiles} className={attachOption}>
                  <Icon name="upload" size={20} />
                  Upload from your device
                </button>
                <button type="button" onClick={openCamera} className={`${attachOption} md:hidden`}>
                  <Icon name="camera" size={20} />
                  Take a photo
                </button>
                <button type="button" onClick={() => void startRecording()} className={attachOption}>
                  <Icon name="mic" size={20} />
                  Record a voice note
                </button>
                <p className="px-3.5 pt-1 pb-2 text-[12px] text-muted">
                  You can also drag files in or paste a screenshot. Up to 50 MB each.
                </p>
              </Popover>
            )}
          </div>
          <button
            type="button"
            className="h-[30px] rounded-md border-0 px-1.5 text-[16px] font-medium text-ink hover:bg-hover"
            style={format ? { background: "var(--soft)" } : { background: "transparent" }}
            aria-label="Formatting"
            aria-pressed={format}
            title="Show formatting"
            onClick={() => setFormat(!format)}
          >
            Aa
          </button>
          {commands.length > 0 && (
            <button
              type="button"
              onClick={() => {
                update("/");
                setSlash({ query: "", index: 0 });
                requestAnimationFrame(() => ref.current?.focus());
              }}
              className={toolBtn}
              aria-label="Commands"
              title="Slash commands"
            >
              <Icon name="slash" size={18} />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === "emoji" ? "none" : "emoji")}
              className={toolBtn}
              aria-label="Emoji"
              aria-expanded={menu === "emoji"}
              title="Emoji"
            >
              <Icon name="emoji" size={19} />
            </button>
            {menu === "emoji" && (
              <EmojiPicker
                onClose={() => setMenu("none")}
                onPick={(e) => {
                  insertAtCaret(e);
                  setMenu("none");
                }}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              insertAtCaret(
                draft.length === 0 || /\s$/.test(draft.slice(0, ref.current?.selectionStart ?? draft.length))
                  ? "@"
                  : " @",
              );
              setMention({ query: "", index: 0 });
            }}
            className={toolBtn}
            aria-label="Mention someone"
            title="Mention someone"
          >
            <Icon name="mention" size={19} />
          </button>
          <span className="mx-1.5 h-5 w-px bg-line" />
          <button
            type="button"
            onClick={openCamera}
            className={`${toolBtn} md:hidden`}
            aria-label="Take a photo"
            title="Take a photo"
          >
            <Icon name="camera" size={19} />
          </button>
          <button
            type="button"
            onClick={openFiles}
            className={`${toolBtn} hidden sm:flex`}
            aria-label="Upload a file"
            title="Upload a file"
          >
            <Icon name="upload" size={19} />
          </button>
          <button
            type="button"
            onClick={() => (recording ? stopRecording(false) : void startRecording())}
            className={toolBtn}
            aria-label={recording ? "Stop recording" : "Record a voice note"}
            title={recording ? "Stop recording" : "Record a voice note"}
            aria-pressed={!!recording}
            style={recording ? { color: "var(--new)" } : undefined}
          >
            <Icon name="mic" size={19} />
          </button>
          {canPostInternal && (
            <button
              type="button"
              onClick={() => setInternal((v) => !v)}
              aria-pressed={internal}
              className="ml-1 h-[26px] rounded-md px-2 text-[13px] font-semibold"
              style={
                internal
                  ? { background: "#E28A2B", color: "#fff" }
                  : { border: "1px solid var(--input-border)", color: "var(--muted)" }
              }
              title="Internal notes are never shown to owners"
            >
              Internal note
            </button>
          )}
          <div className="flex-1" />
          <div className="relative flex items-center">
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              className={`flex h-[30px] items-center gap-1.5 border-0 px-2.5 disabled:cursor-default ${onSchedule ? "rounded-l-md" : "rounded-md"}`}
              style={{ background: canSend ? "var(--brand)" : "transparent", color: canSend ? "#fff" : "var(--muted)" }}
              aria-label="Send"
            >
              <Icon name="send" size={18} />
            </button>
            {onSchedule && (
              <button
                type="button"
                onClick={() => setSchedule(schedule === "none" ? "menu" : "none")}
                disabled={!hasText || files.length > 0 || !!recording}
                className="flex h-[30px] w-6 items-center justify-center rounded-r-md border-0 border-l border-l-white/30 disabled:cursor-default"
                style={{
                  background: hasText && !files.length ? "var(--brand)" : "transparent",
                  color: hasText && !files.length ? "#fff" : "var(--muted)",
                }}
                aria-label="Schedule for later"
                title="Schedule for later"
                aria-expanded={schedule !== "none"}
              >
                <Icon name="chevronDown" size={14} strokeWidth={2.4} />
              </button>
            )}
            {schedule === "menu" && (
              <Menu
                label="Schedule message"
                header="Send later"
                align="right"
                items={[
                  {
                    id: "tomorrow",
                    label: `Tomorrow at 9:00`,
                    icon: "clock",
                    onSelect: () => scheduleAt(nextMorning(1)),
                  },
                  { id: "monday", label: `Monday at 9:00`, icon: "clock", onSelect: () => scheduleAt(nextMonday()) },
                  {
                    id: "custom",
                    label: "Custom time…",
                    icon: "pencil",
                    keepOpen: true,
                    onSelect: () => setSchedule("custom"),
                  },
                ]}
                onClose={() => setSchedule("none")}
              />
            )}
            {schedule === "custom" && (
              <Popover onClose={() => setSchedule("none")} label="Custom time" align="right" className="w-[280px] p-3">
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                  Send at
                  <input
                    type="datetime-local"
                    value={customAt}
                    min={new Date(now + 60_000).toISOString().slice(0, 16)}
                    onChange={(e) => setCustomAt(e.target.value)}
                    className="h-10 rounded-lg border border-input-border bg-input px-2.5 text-[15px] font-normal text-ink"
                    aria-label="Send at"
                  />
                </label>
                <button
                  type="button"
                  disabled={!customAt || new Date(customAt).getTime() <= now}
                  onClick={() => scheduleAt(new Date(customAt))}
                  className="mt-3 h-9 w-full rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
                  style={{ background: "var(--brand)" }}
                >
                  Schedule
                </button>
              </Popover>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
