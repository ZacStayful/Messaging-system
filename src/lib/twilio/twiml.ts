/**
 * The XML Twilio asks us for mid-call.
 *
 * A call is a live thing: Twilio stops and asks what to do next, and this is the answer. Built
 * as strings rather than with a library because it is a handful of elements, and because a pure
 * string function can be asserted exactly — including the escaping, which is the part that
 * breaks on the first contact with a real person's name.
 */

/** XML escaping. A contact called "Bell & Sons" must not end the document early. */
export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const doc = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;

/**
 * What both parties hear before they are connected.
 *
 * UK law requires that people are told a call is recorded, and an automated line before the
 * connection is the only way to be sure it happened on every call rather than when someone
 * remembered. Deliberately said to the *caller* as well: the team member should hear what the
 * contact hears, so nobody is surprised by their own system.
 */
export const RECORDING_NOTICE = "This call is recorded for quality and record keeping.";

export interface DialOptions {
  /** E.164 number to ring. */
  to: string;
  /** The Stayful number the contact sees. Must be one we own — Ofcom blocks anything else. */
  callerId: string;
  /** Where Twilio posts what happened to the dialled leg. */
  statusCallback?: string;
  /** Where Twilio posts the finished recording. */
  recordingStatusCallback?: string;
  record?: boolean;
  /** Seconds to ring before giving up. Twilio's default of 60 is a long time to listen to. */
  timeout?: number;
}

/** Announcement, then dial the contact's mobile. The answer to an outbound call's first ask. */
export function dialTwiML(opts: DialOptions): string {
  const attrs = [
    `callerId="${esc(opts.callerId)}"`,
    `timeout="${opts.timeout ?? 25}"`,
    opts.record ? `record="record-from-answer-dual"` : null,
    opts.recordingStatusCallback ? `recordingStatusCallback="${esc(opts.recordingStatusCallback)}"` : null,
    opts.recordingStatusCallback ? `recordingStatusCallbackEvent="completed"` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const numberAttrs = opts.statusCallback
    ? ` statusCallback="${esc(opts.statusCallback)}" statusCallbackEvent="answered completed"`
    : "";

  return doc(
    `<Say>${esc(RECORDING_NOTICE)}</Say>` + `<Dial ${attrs}><Number${numberAttrs}>${esc(opts.to)}</Number></Dial>`,
  );
}

export interface VoicemailOptions {
  greeting: string;
  /** Where Twilio posts the finished voicemail. */
  recordingStatusCallback: string;
  maxLengthSeconds?: number;
}

/**
 * Someone rang the Stayful number back.
 *
 * They will: Ofcom requires the caller ID be dialable, so it is not optional to have an answer
 * here. A number that rings out forever is the worst of both worlds — it looks like a real line
 * and behaves like a disconnected one.
 */
export function voicemailTwiML(opts: VoicemailOptions): string {
  return doc(
    `<Say>${esc(opts.greeting)}</Say>` +
      `<Record maxLength="${opts.maxLengthSeconds ?? 120}" playBeep="true" trim="trim-silence"` +
      ` recordingStatusCallback="${esc(opts.recordingStatusCallback)}"` +
      ` recordingStatusCallbackEvent="completed" />` +
      // Reached only if they hang up without leaving anything; Twilio needs a terminal verb.
      `<Hangup />`,
  );
}

/** Said when something is wrong our end. Better than silence, which sounds like a dead line. */
export function sayAndHangupTwiML(message: string): string {
  return doc(`<Say>${esc(message)}</Say><Hangup />`);
}

export const TWIML_CONTENT_TYPE = "text/xml; charset=utf-8";
