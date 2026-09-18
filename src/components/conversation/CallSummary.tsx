"use client";

import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/components/shell/store";

/**
 * A call, as the thread remembers it.
 *
 * `call_summary` has sat in the message_kind enum since 0001 with nothing writing one. The
 * status callback writes it now, and this renders it: a single quiet line rather than a message
 * bubble, because it is a record of something that happened rather than something anyone said.
 *
 * The wording is already decided server-side by buildCallSummary(), which distinguishes
 * answered, no-answer, busy, cancelled and failed. Nothing is re-derived here — a summary that
 * read differently in the browser from the way it reads in an email notification would be worse
 * than one that is merely terse.
 */
export interface CallMeta {
  call_id?: string;
  status?: string;
  duration_seconds?: number | null;
  recorded?: boolean;
}

/** Twilio's vocabulary for "nobody spoke", which reads red rather than neutral. */
const UNANSWERED = new Set(["no-answer", "busy", "failed", "canceled"]);

export function CallSummary({ body, meta }: { body: string; meta: CallMeta }) {
  const { isTeam } = useStore();
  const missed = UNANSWERED.has(meta.status ?? "");
  // Team only, and only when there is something to play. The route re-checks this against the
  // `call recordings: team reads` policy — this is presentation, not enforcement.
  const canPlay = isTeam && meta.recorded && meta.call_id && !missed;

  return (
    <div className="my-0.5 flex flex-wrap items-center gap-2 text-[15px]">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          missed ? "bg-soft text-new" : "bg-soft text-muted"
        }`}
      >
        <Icon name={missed ? "phoneOff" : "phone"} size={13} />
      </span>
      <span className={missed ? "text-new" : "text-ink"}>{body}</span>
      {canPlay && (
        <audio
          controls
          preload="none"
          // Never Twilio's own URL: that is readable by anyone holding it, and this thread may
          // have a customer in it. The route reads call_recordings through the listener's own
          // session, so RLS decides whether there is anything to play.
          src={`/api/calls/${meta.call_id}/recording`}
          className="h-8 max-w-full"
        >
          <track kind="captions" />
        </audio>
      )}
    </div>
  );
}
