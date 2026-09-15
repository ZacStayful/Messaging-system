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
}

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

export function Composer({ conversationId, draftKey, placeholder, canPostInternal, members, onSend }: ComposerProps) {
  const [draft, update] = useDraft(draftKey ?? conversationId);
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

  const startRecording = async () => {
    setMenu("none");
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !pickRecorderMime()) {
      setError("Voice notes aren't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMime();
      const rec = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      discardRecording.current = false;
      const startedAt = Date.now();
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
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
      setError("Microphone access was blocked. Allow the microphone for chat.stayful.co.uk and try again.");
    }
  };
  const stopRecording = (discard = false) => {
    discardRecording.current = discard;
    recorder.current?.stop();
    recorder.current = null;
  };
  useEffect(() => () => recorder.current?.stop(), []);

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
    onSend(draft.trim(), internal ? "internal" : "public", files);
    update("");
    setFiles([]);
    setError(null);
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
            className="h-[30px] rounded-md border-0 bg-transparent px-1.5 text-[16px] font-medium text-ink hover:bg-hover"
            aria-label="Formatting"
            title="Use **bold**, - lists and [links](url)"
            onClick={() => insertAtCaret("**bold**")}
          >
            Aa
          </button>
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
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            className="flex h-[30px] items-center gap-1.5 rounded-md border-0 px-2.5 disabled:cursor-default"
            style={{ background: canSend ? "var(--brand)" : "transparent", color: canSend ? "#fff" : "var(--muted)" }}
            aria-label="Send"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
