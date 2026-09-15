"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Profile, SearchHit } from "@/lib/database.types";
import { useStore } from "@/components/shell/store";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { MessageBody } from "@/components/conversation/MessageBody";
import { fileIcon } from "@/components/conversation/AttachmentView";
import { fileSize, listTime, pinWhen } from "@/lib/format";
import { presenceLook } from "@/lib/presence";
import { useSignedUrls } from "@/lib/storage/useSignedUrls";

export interface FileHit {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: string;
  conversation_id: string;
  message_id: string;
  storage_path: string;
  sender_id: string | null;
}

type Chip = "All" | "Messages" | "People" | "Files";

interface SearchResultsProps {
  query: string;
  messages: SearchHit[];
  people: Profile[];
  files: FileHit[];
}

const chipCls = "flex h-[34px] items-center gap-1.5 rounded-lg px-3.5 text-[15px]";

export function SearchResults({ query, messages, people, files }: SearchResultsProps) {
  const { me, profiles, conversationById, conversationName, isOnline, openDm } = useStore();
  const router = useRouter();
  const [chip, setChip] = useState<Chip>("All");
  const [q, setQ] = useState(query);
  const urls = useSignedUrls(files.map((f) => f.storage_path));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = q.trim();
    router.push(next ? `/search?q=${encodeURIComponent(next)}` : "/search");
  };

  const whereFor = (conversationId: string, fallbackType?: string, fallbackName?: string | null) => {
    const c = conversationById(conversationId);
    if (c) {
      const dm = c.type === "dm" || c.type === "group_dm";
      return { label: dm ? conversationName(c) : `#${c.name}`, nav: dm ? "dms" : "home", dm };
    }
    const dm = fallbackType === "dm" || fallbackType === "group_dm";
    return { label: dm ? "Direct message" : `#${fallbackName ?? "conversation"}`, nav: dm ? "dms" : "home", dm };
  };

  const canDm = (p: Profile) => p.id !== me.id && (me.account_type === "team" || p.account_type === "team");
  const goDm = async (p: Profile) => {
    const id = await openDm(p.id);
    if (id) router.push(`/dms/${id}`);
  };

  const total = messages.length + people.length + files.length;
  const showMessages = chip === "All" || chip === "Messages";
  const showPeople = chip === "All" || chip === "People";
  const showFiles = chip === "All" || chip === "Files";

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-4 py-4 md:px-8 md:py-6">
        <div className="mb-4 flex items-center gap-2 md:hidden">
          <Link href="/dms" className="flex h-10 w-10 items-center justify-center text-ink" aria-label="Back">
            <Icon name="back" size={24} strokeWidth={2} />
          </Link>
          <span className="font-display text-[20px] font-bold">Search</span>
        </div>
        <form
          onSubmit={submit}
          role="search"
          className="flex h-12 items-center gap-3 rounded-[10px] border border-input-border bg-input px-3.5 text-muted focus-within:border-muted"
        >
          <Icon name="search" />
          <input
            autoFocus={!query}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages, people and files"
            aria-label="Search Stayful"
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink outline-none"
          />
          <button
            type="submit"
            className="h-9 rounded-md px-3 text-[14px] font-semibold text-white"
            style={{ background: "var(--brand)" }}
          >
            Search
          </button>
        </form>

        {!query ? (
          <p className="mt-6 text-[15px] text-muted">
            Search every conversation you belong to. Try a customer&apos;s name, a property, a file name or a word from
            a message.
          </p>
        ) : (
          <>
            <div className="my-4 flex flex-wrap items-center gap-2">
              {(
                [
                  ["All", total],
                  ["Messages", messages.length],
                  ["People", people.length],
                  ["Files", files.length],
                ] as [Chip, number][]
              ).map(([c, n]) => (
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
                  <span className={`text-[13px] ${chip === c ? "opacity-85" : "text-muted"}`}>{n}</span>
                </button>
              ))}
            </div>

            {total === 0 && (
              <p className="py-8 text-center text-[15px] text-muted">
                Nothing matches &ldquo;{query}&rdquo;. Check the spelling or try a shorter word.
              </p>
            )}

            {showPeople && people.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-[16px] font-semibold">People</h2>
                <div className="overflow-hidden rounded-xl border border-line bg-card">
                  {people.map((p) => {
                    const look = presenceLook(p, isOnline(p.id));
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void goDm(p)}
                        disabled={!canDm(p)}
                        className="flex w-full items-center gap-3 border-t border-line px-4 py-2.5 text-left text-ink first:border-t-0 hover:bg-hover disabled:cursor-default"
                      >
                        <Avatar profile={p} size={40} radius={8} />
                        <span className="text-[16px] font-bold">{p.display_name}</span>
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: look.bg, boxShadow: look.ring }}
                        />
                        <span className="truncate text-[15px] text-muted">{p.full_name}</span>
                        {p.id === me.id && <span className="text-[13px] text-muted">(you)</span>}
                        <span className="ml-auto text-[13px] font-semibold text-link">
                          {canDm(p) ? "Message" : p.account_type === "team" ? "Stayful" : "Owner"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {showMessages && messages.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-[16px] font-semibold">Messages</h2>
                <div className="flex flex-col gap-2.5">
                  {messages.map((m) => {
                    const where = whereFor(m.conversation_id, m.conversation_type, m.conversation_name);
                    const sender = m.sender_id ? profiles[m.sender_id] : undefined;
                    return (
                      <Link
                        key={m.message_id}
                        href={`/${where.nav}/${m.conversation_id}?m=${m.message_id}`}
                        className="block rounded-xl border border-line bg-card px-4 py-3 text-ink no-underline hover:bg-hover"
                      >
                        <div className="mb-1 flex items-center gap-2 text-[13px] text-muted">
                          {!where.dm && <Icon name="lock" size={13} strokeWidth={2.2} />}
                          <span className="font-semibold text-ink">{where.label}</span>
                          <span>· {pinWhen(m.created_at)}</span>
                          {m.visibility === "internal" && (
                            <span className="ml-auto font-semibold text-[#B4661F]">Internal note</span>
                          )}
                        </div>
                        <div className="flex gap-2.5">
                          <div className="mt-0.5 h-8 w-8 shrink-0">
                            <Avatar profile={m.sender_id ? sender : null} size={32} radius={7} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-[15px] font-bold">
                              {m.sender_id ? (sender?.display_name ?? m.sender_name ?? "Former member") : "Stayful"}
                            </span>
                            <MessageBody body={m.body} compact query={query} />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            {showFiles && files.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 text-[16px] font-semibold">Files</h2>
                <div className="overflow-hidden rounded-xl border border-line bg-card">
                  {files.map((f) => {
                    const where = whereFor(f.conversation_id);
                    const { icon, bg, label } = fileIcon(f.mime);
                    const who = f.sender_id ? (profiles[f.sender_id]?.display_name ?? "Someone") : "Stayful";
                    return (
                      <div
                        key={f.id}
                        className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 hover:bg-hover"
                      >
                        <a
                          href={urls[f.storage_path]}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 flex-1 items-center gap-3.5 text-ink no-underline"
                        >
                          <span
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] text-[12px] font-bold text-white"
                            style={{ background: bg }}
                          >
                            {label === "PDF" ? "PDF" : <Icon name={icon} size={22} strokeWidth={2} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[16px] font-semibold">{f.file_name}</span>
                            <span className="block truncate text-[14px] text-muted">
                              {label} · {fileSize(f.size_bytes)} · {who} in {where.label} ·{" "}
                              {listTime(f.created_at).toLowerCase()}
                            </span>
                          </span>
                        </a>
                        <Link
                          href={`/${where.nav}/${f.conversation_id}?m=${f.message_id}`}
                          className="shrink-0 text-[13px] font-semibold text-link no-underline hover:underline"
                        >
                          View in chat
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
