"use client";

import type { Message, Profile } from "@/lib/database.types";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { timeLabel } from "@/lib/format";
import { MessageBody } from "./MessageBody";

export type LocalMessage = Message & { _status?: "sending" | "failed" };

interface MessageItemProps {
  message: LocalMessage;
  sender: Profile | undefined;
  onRetry?: (message: LocalMessage) => void;
}

export function MessageItem({ message, sender, onRetry }: MessageItemProps) {
  const internal = message.visibility === "internal";
  const name = message.sender_id ? (sender?.display_name ?? "Former member") : "Stayful";
  return (
    <article
      className="-mx-2 flex gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover"
      style={internal ? { background: "rgba(226,138,43,.10)", borderLeft: "3px solid #E28A2B" } : undefined}
      aria-label={`${name} at ${timeLabel(message.created_at)}`}
    >
      <div className="mt-0.5 h-[38px] w-[38px] shrink-0">
        <Avatar profile={message.sender_id ? sender : null} size={38} radius={8} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[16px] font-bold">{name}</span>
          <span className="text-[13px] text-muted">{timeLabel(message.created_at)}</span>
          {message.edited_at && <span className="text-[13px] text-muted">(edited)</span>}
          {message.sent_via === "email" && (
            <span className="flex items-center gap-1 text-[13px] text-muted" title="Sent by replying to an email">
              <Icon name="mail" size={13} /> via email
            </span>
          )}
          {internal && (
            <span className="text-[13px] font-semibold text-[#B4661F]">Internal note · not visible to owners</span>
          )}
        </div>
        <div style={{ opacity: message._status === "sending" ? 0.6 : 1 }}>
          <MessageBody body={message.body} />
        </div>
        {message._status === "sending" && <div className="-mt-1 text-[13px] text-muted">Sending…</div>}
        {message._status === "failed" && (
          <button
            type="button"
            onClick={() => onRetry?.(message)}
            className="-mt-1 flex items-center gap-1 text-[13px] font-semibold text-new"
          >
            <Icon name="retry" size={14} strokeWidth={2} /> Failed to send. Tap to retry
          </button>
        )}
      </div>
    </article>
  );
}
