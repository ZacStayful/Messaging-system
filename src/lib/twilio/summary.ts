/**
 * What the thread says a call was.
 *
 * message_kind has carried 'call_summary' since 0001 and nothing has ever written one. This is
 * what finally does. Pure, so every outcome can be asserted without a call taking place — and
 * the outcomes that matter most are the ones where nobody spoke, because those are the ones a
 * person reading the thread later needs explained.
 */

/** Twilio's own words for how a call ended. Stored and read verbatim rather than remapped. */
export type CallStatus =
  "queued" | "initiated" | "ringing" | "in-progress" | "completed" | "busy" | "no-answer" | "failed" | "canceled";

export interface CallForSummary {
  id: string;
  status: CallStatus | string;
  direction: "outbound" | "inbound";
  /** Who the team called, or who rang in. */
  contactName: string;
  callerName?: string;
  durationSeconds?: number | null;
  recorded?: boolean;
}

/** "4m 12s", "38s". Minutes and seconds, because a call is never usefully measured in hours. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export interface CallSummary {
  body: string;
  meta: Record<string, unknown>;
}

/**
 * A line for the thread, and the meta the UI renders from.
 *
 * A call that was not answered is still worth a line: "we tried" is information, and without it
 * the thread implies nobody reached out. The wording distinguishes the three ways that happens,
 * because "busy" and "failed" mean different things to whoever reads it next — one is a person
 * declining, the other is usually a wrong number.
 */
export function buildCallSummary(call: CallForSummary): CallSummary {
  const duration = call.durationSeconds ?? 0;
  const who = call.contactName;
  let body: string;

  switch (call.status) {
    case "completed":
      body =
        duration > 0
          ? call.direction === "outbound"
            ? `Called ${who} · ${formatDuration(duration)}`
            : `${who} called · ${formatDuration(duration)}`
          : // Completed with no duration is a call that connected and ended immediately —
            // usually the contact hanging up as they answered.
            `Called ${who} · not answered`;
      break;
    case "no-answer":
      body = `Called ${who} · no answer`;
      break;
    case "busy":
      body = `Called ${who} · line busy`;
      break;
    case "canceled":
      body = `Call to ${who} · cancelled`;
      break;
    case "failed":
      body = `Call to ${who} failed · the number could not be reached`;
      break;
    default:
      body = `Call to ${who} · ${call.status}`;
  }

  return {
    body,
    meta: {
      call_id: call.id,
      status: call.status,
      direction: call.direction,
      duration_seconds: call.durationSeconds ?? null,
      contact_name: who,
      caller_name: call.callerName ?? null,
      recorded: !!call.recorded,
    },
  };
}

/** Voicemail lands as an ordinary message from that person, with the audio attached. */
export function voicemailBody(contactName: string, seconds: number | null): string {
  return seconds ? `Voicemail from ${contactName} · ${formatDuration(seconds)}` : `Voicemail from ${contactName}`;
}
