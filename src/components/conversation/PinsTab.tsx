"use client";

import type { Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { pinWhen } from "@/lib/format";
import { extractLinks } from "@/lib/richtext";
import { MessageBody } from "./MessageBody";
import type { PinWithMessage } from "./ConversationView";

export function PinsTab({ pins, profiles }: { pins: PinWithMessage[]; profiles: Record<string, Profile> }) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <div className="mb-3.5 text-[16px] font-semibold">Pinned messages</div>
      {pins.length === 0 && (
        <p className="text-[15px] text-muted">
          Nothing pinned yet. Pin important messages so everyone can find them quickly.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {pins.map((p) => {
          const m = p.message;
          const sender = m.sender_id ? profiles[m.sender_id] : undefined;
          const pdf = /\b([^\s]+\.pdf)\b/i.exec(m.body);
          const links = extractLinks(m.body);
          const linkOnly = links.length === 1 && m.body.trim() === links[0].href;
          return (
            <div key={m.id} className="flex gap-3 rounded-xl border border-line bg-card px-4 py-3.5">
              <div className="h-[38px] w-[38px] shrink-0">
                <Avatar profile={m.sender_id ? sender : null} size={38} radius={8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[16px] font-bold">
                    {m.sender_id ? (sender?.display_name ?? "Former member") : "Stayful"}
                  </span>
                  <span className="text-[13px] text-muted">{pinWhen(m.created_at)}</span>
                </div>
                {linkOnly ? (
                  <a
                    href={links[0].href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-[16px] break-all text-link no-underline hover:underline"
                  >
                    {links[0].href}
                  </a>
                ) : (
                  <MessageBody body={pdf ? m.body.replace(pdf[1], "").trim() : m.body} />
                )}
                {pdf && (
                  <>
                    <div className="mt-2 mb-1.5 flex items-center gap-1.5 text-[15px] text-muted">
                      PDF <Icon name="chevronDown" size={12} strokeWidth={2.4} />
                    </div>
                    <div className="max-w-[720px] overflow-hidden rounded-xl border border-line bg-card">
                      <div className="flex items-center gap-3 px-3.5 py-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#E2394A] text-[12px] font-bold text-white">
                          PDF
                        </div>
                        <div>
                          <div className="text-[16px] font-semibold">{pdf[1]}</div>
                          <div className="text-[14px] text-muted">
                            {links.some((l) => l.host.includes("google")) ? "Google PDF" : "PDF"}
                          </div>
                        </div>
                      </div>
                      <div
                        className="flex h-[260px] items-center justify-center text-[14px] font-semibold text-[#3E5A3A]"
                        style={{ background: "var(--thumb)" }}
                      >
                        Document preview
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
