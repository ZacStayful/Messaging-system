import { timingSafeEqual } from "node:crypto";

/**
 * Reading what TimelinesAI posts at us, and proving it was them.
 *
 * TimelinesAI publishes no signature or HMAC scheme for webhook deliveries, so authentication is
 * a long secret in the URL path, compared in constant time. That works whatever the dashboard
 * supports, because it is just a URL. verifyTimelinesSignature is left as the seam to fill in if
 * they ever publish one.
 */

/** Constant-time compare that does not leak length through an early return. */
export function verifyWebhookToken(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so hash-free equalisation first: compare a
  // against itself and return false, which costs the same as the real comparison.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export interface InboundWhatsApp {
  externalRef: string;
  fromPhone: string;
  text: string;
  sentAt: string | null;
  chatId: string | null;
  isGroup: boolean;
  /** "received" is a customer writing to us; "sent" is our own outbound coming back. */
  direction: "received" | "sent";
  /** Set when the message carried media we are not ingesting yet. */
  mediaUrl?: string | null;
}

type Unknown = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Normalises both documented TimelinesAI webhook shapes into one list.
 *
 * The newer event form is `{ event_type: "message:received:new", data: { ... } }`; the older
 * "Outbound Integration" bundle is `{ chat_id, phone, messages: [{ direction, ... }] }`. Which
 * one an account sends depends on how its webhook was configured, and we do not control that,
 * so both are handled rather than guessed at.
 *
 * Callers MUST drop direction === "sent". Those are our own outbound notifications coming back
 * through the same webhook, and storing one would post it into the conversation as if the
 * customer had written it — which then notifies them, which arrives back here. That is the echo
 * loop, and this is the only thing standing in front of it.
 */
export function normaliseInboundPayload(raw: unknown): InboundWhatsApp[] {
  if (!raw || typeof raw !== "object") return [];
  const body = raw as Unknown;

  // --- bundle form: a chat plus a list of messages ---
  if (Array.isArray(body.messages)) {
    const chatPhone = str(body.phone);
    const chatId = str(body.chat_id);
    const isGroup = body.is_group === true;
    return (body.messages as Unknown[])
      .map((m): InboundWhatsApp | null => {
        const sender = (m.sender ?? {}) as Unknown;
        const ref = str(m.message_uid) ?? str(m.uid) ?? str(m.id);
        const phone = str(sender.phone) ?? chatPhone;
        if (!ref || !phone) return null;
        return {
          externalRef: ref,
          fromPhone: phone,
          text: str(m.text) ?? "",
          sentAt: str(m.timestamp) ?? str(m.created_at),
          chatId,
          isGroup,
          direction: m.direction === "sent" ? "sent" : "received",
          mediaUrl: str(m.attachment_url) ?? str(m.media_url),
        };
      })
      .filter((x): x is InboundWhatsApp => x !== null);
  }

  // --- event form ---
  const eventType = str(body.event_type) ?? str(body.event);
  const data = (body.data ?? body) as Unknown;
  const ref = str(data.message_uid) ?? str(data.uid) ?? str(data.id);
  const phone = str(data.phone) ?? str(data.sender_phone) ?? str((data.sender as Unknown)?.phone as string);
  if (!ref || !phone) return [];
  // An event form with no event_type at all is treated as received; an explicitly "sent" one is
  // kept and labelled so the caller drops it, rather than silently vanishing here.
  const direction = eventType?.includes(":sent:") || data.direction === "sent" ? "sent" : "received";
  return [
    {
      externalRef: ref,
      fromPhone: phone,
      text: str(data.text) ?? "",
      sentAt: str(data.timestamp) ?? str(data.created_at),
      chatId: str(data.chat_id),
      isGroup: data.is_group === true,
      direction,
      mediaUrl: str(data.attachment_url) ?? str(data.media_url),
    },
  ];
}

/** Placeholder for a signature scheme TimelinesAI has not published. */
export function verifyTimelinesSignature(): boolean {
  return true;
}
