"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/database.types";
import { Icon, type IconName } from "@/components/ui/Icon";
import { durationLabel, fileSize } from "@/lib/format";
import { attachmentMeta, isAudio, isImage, isVideo, isVoiceNote } from "@/lib/storage/attachments";

/** An attachment still being uploaded by this browser (never persisted in this shape). */
export interface PendingAttachment {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  previewUrl?: string;
  progress: "uploading" | "failed";
  voice?: boolean;
  duration_ms?: number;
}

export type AnyAttachment = Attachment | PendingAttachment;

export function isPending(a: AnyAttachment): a is PendingAttachment {
  return "progress" in a;
}

export function fileIcon(mime: string): { icon: IconName; bg: string; label: string } {
  if (mime.startsWith("audio/")) return { icon: "audio", bg: "#1E9BD7", label: "Audio" };
  if (mime.startsWith("image/")) return { icon: "image", bg: "#5D8156", label: "Image" };
  if (mime.startsWith("video/")) return { icon: "video", bg: "#7F4FA8", label: "Video" };
  if (mime === "application/pdf") return { icon: "file", bg: "#E2394A", label: "PDF" };
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
    return { icon: "file", bg: "#1E7A46", label: "Spreadsheet" };
  if (mime.includes("word") || mime === "text/plain") return { icon: "file", bg: "#2E6FD6", label: "Document" };
  return { icon: "file", bg: "#7A8C99", label: "File" };
}

function VoiceNote({ src, durationMs, name }: { src?: string; durationMs?: number; name: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [total, setTotal] = useState(durationMs ? durationMs / 1000 : 0);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setPos(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setTotal(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPos(0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, [src]);

  const toggle = () => {
    const el = audio.current;
    if (!el || !src) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const pct = total > 0 ? Math.min(100, (pos / total) * 100) : 0;
  return (
    <div
      className="flex h-12 w-[min(320px,100%)] items-center gap-3 rounded-full border border-line bg-card pr-4 pl-1.5"
      aria-label={`Voice note, ${durationLabel(total * 1000)}`}
    >
      {src && <audio ref={audio} src={src} preload="metadata" />}
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50"
        style={{ background: "var(--brand)" }}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        <Icon name={playing ? "pause" : "play"} size={16} filled strokeWidth={0} />
      </button>
      <div
        className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        onClick={(e) => {
          const el = audio.current;
          if (!el || !total) return;
          const r = e.currentTarget.getBoundingClientRect();
          el.currentTime = ((e.clientX - r.left) / r.width) * total;
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: "var(--brand)" }}
        />
      </div>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted" title={name}>
        {durationLabel((playing || pos > 0 ? pos : total) * 1000)}
      </span>
    </div>
  );
}

interface AttachmentViewProps {
  attachment: AnyAttachment;
  url?: string;
  onRemove?: () => void;
  onOpen?: () => void;
}

/** Inline rendering for one attachment: photo, video, voice note, audio or a file card. */
export function AttachmentView({ attachment: a, url, onRemove, onOpen }: AttachmentViewProps) {
  const pending = isPending(a);
  const src = pending ? a.previewUrl : url;
  const meta = pending ? { voice: a.voice, duration_ms: a.duration_ms } : attachmentMeta(a);
  const voice = pending ? !!a.voice : isVoiceNote(a);
  const remove = onRemove && (
    <button
      type="button"
      onClick={onRemove}
      className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-panel text-ink shadow"
      aria-label={`Remove ${a.file_name}`}
    >
      <Icon name="close" size={12} strokeWidth={2.4} />
    </button>
  );
  const status = pending && (
    <span
      className={`absolute bottom-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-white ${a.progress === "failed" ? "bg-new" : "bg-[rgba(30,42,28,.7)]"}`}
    >
      {a.progress === "failed" ? "Upload failed" : "Uploading…"}
    </span>
  );

  if (voice) {
    return (
      <div className="relative">
        <VoiceNote src={src} durationMs={meta.duration_ms} name={a.file_name} />
        {pending && a.progress === "failed" && <span className="ml-2 text-[13px] text-new">Upload failed</span>}
        {remove}
      </div>
    );
  }

  if (isImage(a)) {
    const w = (meta as { width?: number }).width;
    const h = (meta as { height?: number }).height;
    const ratio = w && h ? `${w} / ${h}` : undefined;
    return (
      <div className="relative inline-block max-w-full">
        <button
          type="button"
          onClick={onOpen}
          disabled={!src || pending}
          className="relative block max-h-[360px] max-w-[min(420px,100%)] overflow-hidden rounded-lg border border-line bg-soft"
          style={{ aspectRatio: ratio, minWidth: 80, minHeight: 80 }}
          aria-label={`Open ${a.file_name}`}
        >
          {src ? (
            <Image
              src={src}
              alt={a.file_name}
              width={w ?? 420}
              height={h ?? 320}
              unoptimized
              className="block max-h-[360px] w-auto max-w-full object-contain"
            />
          ) : (
            <span className="flex h-40 w-56 items-center justify-center text-muted">
              <Icon name="image" size={28} />
            </span>
          )}
        </button>
        {status}
        {remove}
      </div>
    );
  }

  if (isVideo(a)) {
    return (
      <div className="relative inline-block max-w-full">
        {src && !pending ? (
          <video src={src} controls preload="metadata" className="max-h-[360px] max-w-[min(480px,100%)] rounded-lg" />
        ) : (
          <FileCard a={a} url={undefined} pending={pending} />
        )}
        {status}
        {remove}
      </div>
    );
  }

  if (isAudio(a)) {
    return (
      <div className="relative inline-block max-w-full">
        {src && !pending ? (
          <div className="flex flex-col gap-1">
            <span className="text-[13px] text-muted">{a.file_name}</span>
            <audio src={src} controls preload="metadata" className="max-w-[min(360px,100%)]" />
          </div>
        ) : (
          <FileCard a={a} url={undefined} pending={pending} />
        )}
        {remove}
      </div>
    );
  }

  return (
    <div className="relative inline-block max-w-full">
      <FileCard a={a} url={pending ? undefined : url} pending={pending} />
      {remove}
    </div>
  );
}

function FileCard({ a, url, pending }: { a: AnyAttachment; url?: string; pending: boolean }) {
  const { icon, bg, label } = fileIcon(a.mime);
  const inner = (
    <>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
        style={{ background: bg }}
      >
        {label === "PDF" ? "PDF" : <Icon name={icon} size={22} strokeWidth={2} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{a.file_name}</span>
        <span className="block text-[13px] text-muted">
          {pending
            ? (a as PendingAttachment).progress === "failed"
              ? "Upload failed"
              : "Uploading…"
            : `${label} · ${fileSize(a.size_bytes)}`}
        </span>
      </span>
      {url && <Icon name="download" size={18} className="ml-1 shrink-0 text-muted" />}
    </>
  );
  const cls =
    "flex w-[min(340px,100%)] items-center gap-3 rounded-xl border border-line bg-card px-3 py-2.5 text-left text-ink no-underline hover:bg-hover";
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" download={a.file_name} className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
