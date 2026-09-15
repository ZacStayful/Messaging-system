"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Attachment } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/components/shell/store";
import { Icon } from "@/components/ui/Icon";
import { fileSize, listTime } from "@/lib/format";
import { isImage, isVideo } from "@/lib/storage/attachments";
import { useSignedUrls } from "@/lib/storage/useSignedUrls";
import { fileIcon } from "@/components/conversation/AttachmentView";
import { SidebarHeader, SidebarSearch } from "./SidebarBits";

type Chip = "All" | "Media" | "Documents" | "Voice notes";
type Row = Attachment & { message: { sender_id: string | null; body: string } | null };

const isVoice = (a: Attachment) => a.category === "voice" || !!(a.meta as { voice?: boolean } | null)?.voice;

/** Every file shared in my conversations, newest first. Click to open it in its chat. */
export function FilesSidebar() {
  const { profiles, conversationById, conversationName } = useStore();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [chip, setChip] = useState<Chip>("All");
  const [q, setQ] = useState("");
  const urls = useSignedUrls((rows ?? []).filter((r) => isImage(r)).map((r) => r.storage_path));

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("attachments")
      .select("*, message:messages(sender_id, body)")
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needle = q.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => {
    if (chip === "Media" && !(isImage(r) || isVideo(r))) return false;
    if (chip === "Voice notes" && !isVoice(r)) return false;
    if (chip === "Documents" && (isImage(r) || isVideo(r) || isVoice(r))) return false;
    if (!needle) return true;
    const c = conversationById(r.conversation_id);
    const who = r.message?.sender_id ? (profiles[r.message.sender_id]?.display_name ?? "") : "";
    return `${r.file_name} ${who} ${c ? conversationName(c) : ""}`.toLowerCase().includes(needle);
  });

  return (
    <>
      <SidebarHeader title="Files" chevron={false} />
      <SidebarSearch value={q} onChange={setQ} placeholder="Search files..." />
      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pt-1 pb-2.5" role="tablist">
        {(["All", "Media", "Documents", "Voice notes"] as Chip[]).map((c) => {
          const on = chip === c;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setChip(c)}
              className="flex h-7 items-center rounded-[14px] px-3 text-[14px] whitespace-nowrap"
              style={
                on
                  ? { background: "#FFFFFF", color: "#3E5A3A", fontWeight: 600 }
                  : { border: "1px solid var(--sb-border)", color: "var(--sb-dim)", fontWeight: 500 }
              }
            >
              {c}
            </button>
          );
        })}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {rows === null && <p className="px-4 py-6 text-[15px] text-sb-dim">Loading…</p>}
        {rows !== null && visible.length === 0 && (
          <p className="px-4 py-6 text-[15px] text-sb-dim">
            {rows.length === 0
              ? "No files shared yet. Use + in the composer to attach photos, documents or voice notes."
              : "No files match."}
          </p>
        )}
        {visible.map((r) => {
          const c = conversationById(r.conversation_id);
          const isDm = c ? c.type === "dm" || c.type === "group_dm" : false;
          const where = c ? (isDm ? conversationName(c) : `#${c.name}`) : "Conversation";
          const who = r.message?.sender_id ? (profiles[r.message.sender_id]?.display_name ?? "Someone") : "Stayful";
          const { icon, bg, label } = fileIcon(r.mime);
          const thumb = isImage(r) ? urls[r.storage_path] : undefined;
          return (
            <Link
              key={r.id}
              href={`/files/${r.conversation_id}?m=${r.message_id}`}
              className="sb-row text-sb-text no-underline flex items-center gap-3 border-t border-sb-border px-3.5 py-2.5"
            >
              <span
                className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-white"
                style={{ background: thumb ? "var(--thumb)" : isVoice(r) ? "#5D8156" : bg }}
              >
                {thumb ? (
                  <Image src={thumb} alt="" fill unoptimized className="object-cover" sizes="44px" />
                ) : (
                  <Icon name={isVoice(r) ? "mic" : isVideo(r) ? "video" : icon} size={20} strokeWidth={2} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {isVoice(r) ? "Voice note" : r.file_name}
                </span>
                <span className="block truncate text-[13px] opacity-90">
                  {isVoice(r) ? "Audio" : label} · {fileSize(r.size_bytes)} · {who} in {where} ·{" "}
                  {listTime(r.created_at).toLowerCase()}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
