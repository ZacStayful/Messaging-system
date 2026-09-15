"use client";

import type { Attachment, Profile, Reaction } from "@/lib/database.types";
import { Icon } from "@/components/ui/Icon";
import { Composer, type OutgoingFile } from "./Composer";
import { MessageItem, type LocalMessage } from "./MessageItem";
import type { PendingAttachment } from "./AttachmentView";

interface ThreadPanelProps {
  conversationId: string;
  conversationLabel: string;
  parent: LocalMessage;
  replies: LocalMessage[];
  loading: boolean;
  me: Profile;
  profiles: Record<string, Profile>;
  members: Profile[];
  reactionsByMessage: Map<string, Reaction[]>;
  attachmentsByMessage: Map<string, Attachment[]>;
  pending: Record<string, PendingAttachment[]>;
  urls: Record<string, string>;
  pinnedIds: Set<string>;
  flash: string | null;
  canPostInternal: boolean;
  archived: boolean;
  onClose: () => void;
  onSend: (body: string, visibility: "public" | "internal", files: OutgoingFile[]) => void;
  onRetry: (message: LocalMessage) => void;
  onReact: (message: LocalMessage, emoji: string) => void;
  onTogglePin: (message: LocalMessage) => void;
  onEdit: (message: LocalMessage, body: string) => void;
  onDelete: (message: LocalMessage) => void;
}

function clientIdOf(m: LocalMessage): string {
  return (m.meta as { client_id?: string } | null)?.client_id ?? m.id;
}

/** Slack-style thread: parent message, replies and a composer. Side panel on desktop, full screen on mobile. */
export function ThreadPanel({
  conversationId,
  conversationLabel,
  parent,
  replies,
  loading,
  me,
  profiles,
  members,
  reactionsByMessage,
  attachmentsByMessage,
  pending,
  urls,
  pinnedIds,
  flash,
  canPostInternal,
  archived,
  onClose,
  onSend,
  onRetry,
  onReact,
  onTogglePin,
  onEdit,
  onDelete,
}: ThreadPanelProps) {
  const item = (m: LocalMessage) => (
    <MessageItem
      key={m.id}
      message={m}
      sender={m.sender_id ? profiles[m.sender_id] : undefined}
      me={me}
      profiles={profiles}
      reactions={reactionsByMessage.get(m.id) ?? []}
      attachments={[...(attachmentsByMessage.get(m.id) ?? []), ...(pending[clientIdOf(m)] ?? [])]}
      urls={urls}
      pinned={pinnedIds.has(m.id)}
      highlighted={flash === m.id}
      inThread
      onRetry={onRetry}
      onReact={(emoji) => onReact(m, emoji)}
      onTogglePin={() => onTogglePin(m)}
      onEdit={(body) => onEdit(m, body)}
      onDelete={() => onDelete(m)}
    />
  );

  return (
    <section
      className="fixed inset-0 z-20 flex flex-col bg-panel text-ink md:static md:z-auto md:w-[420px] md:shrink-0 md:border-l md:border-line lg:w-[460px]"
      aria-label="Thread"
    >
      <div
        className="flex h-[50px] shrink-0 items-center gap-2 border-b border-line px-3"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", boxSizing: "content-box" }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[17px] leading-[1.2] font-bold">Thread</div>
          <div className="truncate text-[13px] text-muted">{conversationLabel}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md border-0 bg-transparent text-ink hover:bg-hover"
          aria-label="Close thread"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto pt-2 pb-3">
        <div className="px-3.5">
          {item(parent)}
          <div className="my-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
            <span>
              {parent.reply_count === 0
                ? "No replies yet"
                : `${parent.reply_count} ${parent.reply_count === 1 ? "reply" : "replies"}`}
            </span>
            <div className="h-px flex-1 bg-line" />
          </div>
          {loading && replies.length === 0 && <p className="py-4 text-center text-[14px] text-muted">Loading…</p>}
          {replies.map(item)}
        </div>
      </div>
      {archived ? (
        <p className="mx-3 mb-3 rounded-[10px] border border-line bg-soft px-4 py-3 text-[14px] text-muted">
          This group is archived, so the thread is read-only.
        </p>
      ) : (
        <Composer
          conversationId={conversationId}
          draftKey={`${conversationId}:${parent.id}`}
          placeholder="Reply…"
          canPostInternal={canPostInternal}
          members={members}
          onSend={onSend}
        />
      )}
    </section>
  );
}
