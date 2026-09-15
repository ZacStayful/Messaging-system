"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type { Attachment, Profile } from "@/lib/database.types";
import { Icon, type IconName } from "@/components/ui/Icon";
import { extractLinks } from "@/lib/richtext";
import { fileSize, listTime } from "@/lib/format";
import { isImage, isVideo } from "@/lib/storage/attachments";
import { fileIcon } from "./AttachmentView";
import type { LocalMessage } from "./MessageItem";

type Chip = "All" | "Files" | "Media" | "Links";

interface Row {
  key: string;
  kind: "file" | "link";
  name: string;
  meta: string;
  href?: string;
  messageId: string;
  icon: IconName | "stayful";
  iconBg: string;
  at: string;
}

const chipCls = "flex h-[34px] items-center rounded-lg px-3.5 text-[15px]";

interface FilesTabProps {
  messages: LocalMessage[];
  attachments: Attachment[];
  profiles: Record<string, Profile>;
  urls: Record<string, string>;
  onJump: (messageId: string) => void;
}

export function FilesTab({ messages, attachments, profiles, urls, onJump }: FilesTabProps) {
  const [chip, setChip] = useState<Chip>("All");
  const [q, setQ] = useState("");

  const media = useMemo(() => attachments.filter((a) => isImage(a) || isVideo(a)), [attachments]);

  const rows = useMemo<Row[]>(() => {
    const byMessage = new Map(messages.map((m) => [m.id, m]));
    const files: Row[] = attachments
      .filter((a) => !isImage(a) && !isVideo(a))
      .map((a) => {
        const m = byMessage.get(a.message_id);
        const who = m?.sender_id ? (profiles[m.sender_id]?.display_name ?? "Someone") : "Stayful";
        const { icon, bg, label } = fileIcon(a.mime);
        return {
          key: `a:${a.id}`,
          kind: "file",
          name: a.file_name,
          meta: `${label} · ${fileSize(a.size_bytes)} · shared by ${who} ${listTime(a.created_at).toLowerCase()}`,
          href: urls[a.storage_path],
          messageId: a.message_id,
          icon,
          iconBg: bg,
          at: a.created_at,
        };
      });
    const links: Row[] = [];
    for (const m of [...messages].reverse()) {
      for (const l of extractLinks(m.body)) {
        const isDrive =
          l.host.includes("google.com") &&
          (l.host.startsWith("drive") || l.path.startsWith("/drive") || l.path.startsWith("/file"));
        const isStayful = l.host.endsWith("stayful.co.uk");
        links.push({
          key: `l:${m.id}:${l.href}`,
          kind: "link",
          name: isStayful ? "Stayful" : l.host,
          meta: isStayful ? l.host : l.path.length > 1 ? l.path : l.host,
          href: l.href,
          messageId: m.id,
          icon: isDrive ? "drive" : isStayful ? "stayful" : "link",
          iconBg: isDrive ? "#5D8156" : isStayful ? "transparent" : "#7A8C99",
          at: m.created_at,
        });
      }
    }
    return [...files, ...links].sort((a, b) => b.at.localeCompare(a.at));
  }, [messages, attachments, profiles, urls]);

  const query = q.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (chip === "Files" && r.kind !== "file") return false;
    if (chip === "Links" && r.kind !== "link") return false;
    if (chip === "Media") return false;
    return !query || `${r.name} ${r.meta}`.toLowerCase().includes(query);
  });
  const visibleMedia = media.filter((m) => !query || m.file_name.toLowerCase().includes(query));
  const showMedia = chip === "All" || chip === "Media";

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <div className="flex h-11 items-center gap-3 rounded-[10px] border border-input-border bg-input px-3.5 text-muted">
        <Icon name="search" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search files and links"
          aria-label="Search files and links"
          className="flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
        />
      </div>
      <div className="my-4 flex flex-wrap items-center gap-2 md:mt-4 md:mb-5">
        {(["All", "Files", "Media", "Links"] as Chip[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChip(c)}
            aria-pressed={chip === c}
            className={chipCls}
            style={
              chip === c
                ? { background: "var(--brand)", color: "#fff", fontWeight: 600 }
                : { border: "1px solid var(--input-border)", fontWeight: 500 }
            }
          >
            {c}
          </button>
        ))}
        <div className="flex-1" />
        <span className={`${chipCls} gap-1.5 border border-input-border font-semibold`}>
          Newest <Icon name="chevronDown" size={14} strokeWidth={2} />
        </span>
      </div>

      {showMedia && (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[16px] font-semibold">Photos and videos</span>
            {visibleMedia.length > 0 && <span className="text-[15px] text-link">{visibleMedia.length}</span>}
          </div>
          {visibleMedia.length === 0 ? (
            <p className="mb-5 text-[15px] text-muted">
              No photos or videos in this conversation yet. Use the + button in the composer to add some.
            </p>
          ) : (
            <div className="mb-5 grid grid-cols-3 gap-2 md:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] md:gap-3">
              {visibleMedia.map((m) => (
                <a
                  key={m.id}
                  href={urls[m.storage_path]}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={m.file_name}
                  className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-line"
                  style={{ background: "var(--thumb)" }}
                >
                  {isImage(m) && urls[m.storage_path] && (
                    <Image
                      src={urls[m.storage_path]}
                      alt={m.file_name}
                      fill
                      unoptimized
                      className="object-cover"
                      sizes="200px"
                    />
                  )}
                  {isVideo(m) && (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(30,42,28,.55)]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  )}
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {chip !== "Media" && (
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          {visible.length === 0 && <p className="px-4 py-4 text-[15px] text-muted">Nothing to show.</p>}
          {visible.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 hover:bg-hover"
            >
              <a
                href={r.href}
                target={r.href ? "_blank" : undefined}
                rel="noopener noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3.5 text-ink no-underline"
              >
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-white"
                  style={{ background: r.iconBg }}
                >
                  {r.icon === "stayful" ? (
                    <Image src="/brand/stayful-logo.png" alt="" width={48} height={48} className="h-12 w-12" />
                  ) : (
                    <Icon name={r.icon} size={r.icon === "drive" ? 24 : 22} strokeWidth={2} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-semibold">{r.name}</div>
                  <div className="truncate text-[14px] text-muted">{r.meta}</div>
                </div>
              </a>
              <button
                type="button"
                onClick={() => onJump(r.messageId)}
                className="shrink-0 text-[13px] font-semibold text-link hover:underline"
              >
                View in chat
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
