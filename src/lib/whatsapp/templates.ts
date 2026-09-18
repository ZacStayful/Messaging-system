/**
 * What a customer actually receives on WhatsApp.
 *
 * WhatsApp is plain text with its own light markup (*bold*, _italic_), not HTML, so none of
 * src/lib/email/templates.ts can be reused. Two rules shape this:
 *
 *   1. Name the author on every message. One WhatsApp number serves the whole company, so
 *      without it a customer reads a thread from four people as one person sending everything.
 *   2. Carry the message itself, not just a nudge to go and look. The whole point is that they
 *      can read and reply where they already are.
 */

/** Long messages are trimmed so one chat message stays readable; the link has the rest. */
const MAX_BODY = 900;

export interface WhatsAppMessageInput {
  senderName: string;
  body: string;
  conversationTitle: string;
  /** null for a direct message, where the sender's name is the title. */
  isGroup: boolean;
  viewUrl: string;
  /**
   * Just the message, as if typed on a phone: no author line, no link. For lead-database
   * customers, who are not using the app yet and must not be pointed at it.
   */
  plain?: boolean;
}

function trim(body: string): string {
  const clean = body.trim();
  if (clean.length <= MAX_BODY) return clean;
  return `${clean.slice(0, MAX_BODY).trimEnd()}…`;
}

export function messageWhatsApp(input: WhatsAppMessageInput): { text: string } {
  if (input.plain) return { text: trim(input.body) };
  const where = input.isGroup ? ` in ${input.conversationTitle}` : "";
  const text = [`*${input.senderName}*${where}`, "", trim(input.body), "", `Reply here, or open it: ${input.viewUrl}`]
    .join("\n")
    .trim();
  return { text };
}
