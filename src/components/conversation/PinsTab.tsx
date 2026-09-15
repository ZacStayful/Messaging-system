"use client";

import type { Attachment, Message, Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { pinWhen } from "@/lib/format";
import { extractLinks } from "@/lib/richtext";
import { MessageBody } from "./MessageBody";
import { AttachmentView } from "./AttachmentView";
import type { PinWithMessage } from "./ConversationView";

interface PinsTabProps {
  pins: PinWithMessage[];
  profiles: Record<string, Profile>;
  attachments: Map<string, Attachment[]>;
  urls: Record<string, string>;
  onUnpin: (message: Message) => void;
  onJump: (messageId: string) => void;
}

export function PinsTab({ pins, profiles, attachments, urls, onUnpin, onJump }: PinsTabProps) {
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
      <div className="mb-3.5 text-[16px] font-semibold">Pinned messages</div>
      {pins.length === 0 && (
        <p className="text-[15px] text-muted">
          Nothing pinned yet. Hover a message and choose the pin icon so everyone can find it quickly.
        </p>
      )}
      <div className="flex flex-col gap-3">
        {pins.map((p) => {
          const m = p.message;
          const sender = m.sender_id ? profiles[m.sender_id] : undefined;
          const pinner = p.pinned_by ? profiles[p.pinned_by] : undefined;
          const links = extractLinks(m.body);
          const linkOnly = links.length === 1 && m.body.trim() === links[0].href;
          const files = attachments.get(m.id) ?? [];
          return (
            <div key={m.id} className="flex gap-3 rounded-xl border border-line bg-card px-4 py-3.5">
              <div className="h-[38px] w-[38px] shrink-0">
                <Avatar profile={m.sender_id ? sender : null} size={38} radius={8} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[16px] font-bold">
                    {m.sender_id ? (sender?.display_name ?? "Former member") : "Stayful"}
                  </span>
                  <span className="text-[13px] text-muted">{pinWhen(m.created_at)}</span>
                  {pinner && <span className="text-[13px] text-muted">· pinned by {pinner.display_name}</span>}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => onJump(m.id)}
                    className="text-[13px] font-semibold text-link hover:underline"
                  >
                    Jump to message
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnpin(m)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink"
                    aria-label="Unpin"
                    title="Unpin"
                  >
                    <Icon name="close" size={16} />
                  </button>
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
                  m.body && <MessageBody body={m.body} />
                )}
                {files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {files.map((a) => (
                      <AttachmentView
                        key={a.id}
                        attachment={a}
                        url={urls[a.storage_path]}
                        onOpen={() => urls[a.storage_path] && window.open(urls[a.storage_path], "_blank", "noopener")}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
