/**
 * Capturing WhatsApp history that never came through the webhook.
 *
 * The inbound webhook only sees what TimelinesAI delivers from the moment it is subscribed, and
 * the mirror only sees what the team sends from then on. A lead-database customer's thread
 * therefore starts on the day they were imported, with nothing of what came before. This is the
 * matcher for that history: an automation reads the chat back out of TimelinesAI and posts each
 * message here, and the ones with a lead-database customer land in their group at the time they
 * were actually sent.
 *
 * Only lead-database customers are matched, for the reason email capture gives: the number is
 * whatever the caller says it is, which is tolerable for a thread only the team can read, about
 * a person who cannot sign in, that never sends anything back out (meta.mirrored).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normaliseUkMobile } from "@/lib/phone";

type Admin = SupabaseClient<Database>;

export type WhatsAppCaptureDirection = "inbound" | "outbound";

export interface WhatsAppCaptureMessage {
  /** TimelinesAI's message uid: the dedupe key, shared with the live webhook. */
  messageUid: string | null;
  chatId: string | null;
  /** The customer's number, whichever way the message went. */
  phone: string | null;
  direction: WhatsAppCaptureDirection;
  text: string | null;
  mediaUrl?: string | null;
  /** When it was sent. Null lets the database stamp the row, which a backfill never wants. */
  sentAt?: string | null;
  /** Which of OUR numbers it went through, to attribute an outbound message to its owner. */
  sentFrom?: string | null;
}

export type WhatsAppCaptureReason =
  | "no_message_uid"
  | "no_phone"
  | "bad_number"
  | "unknown_counterpart"
  | "not_a_lead"
  | "deactivated"
  | "no_group"
  | "archived"
  | "empty_body"
  | "no_team_sender";

export interface WhatsAppCaptureInput {
  message: WhatsAppCaptureMessage;
  /** The person the number belongs to, if any. */
  counterpart: { profileId: string; orgId: string; leadCategory: string | null; deactivatedAt: string | null } | null;
  /** Their customer group, if they have one. */
  ownerGroup: { conversationId: string; archivedAt: string | null } | null;
  /** Who an outbound message is posted as: the owner of the sending number, or the caller. */
  senderUserId: string | null;
}

export type WhatsAppCaptureDecision =
  | { kind: "post"; conversationId: string; orgId: string; senderId: string; body: string; phone: string }
  | { kind: "unmatched"; reason: WhatsAppCaptureReason; phone: string | null };

/**
 * Pure. Inbound is posted as the lead; outbound as the team member. There is no "sent by the
 * app" case here: history predates the app, and anything the app did send is already stored
 * under the same uid, which the unique index turns into a duplicate rather than a second row.
 */
export function decideWhatsAppCapture(input: WhatsAppCaptureInput): WhatsAppCaptureDecision {
  const m = input.message;
  if (!m.messageUid?.trim()) return { kind: "unmatched", reason: "no_message_uid", phone: m.phone };
  if (!m.phone?.trim()) return { kind: "unmatched", reason: "no_phone", phone: null };
  const parsed = normaliseUkMobile(m.phone);
  if (!parsed.ok || !parsed.e164) return { kind: "unmatched", reason: "bad_number", phone: m.phone };
  const phone = parsed.e164;

  if (!input.counterpart) return { kind: "unmatched", reason: "unknown_counterpart", phone };
  if (!input.counterpart.leadCategory) return { kind: "unmatched", reason: "not_a_lead", phone };
  if (input.counterpart.deactivatedAt) return { kind: "unmatched", reason: "deactivated", phone };
  if (!input.ownerGroup) return { kind: "unmatched", reason: "no_group", phone };
  if (input.ownerGroup.archivedAt) return { kind: "unmatched", reason: "archived", phone };

  const body = (m.text ?? "").trim() || (m.mediaUrl ? "[Sent an attachment on WhatsApp]" : "");
  if (!body) return { kind: "unmatched", reason: "empty_body", phone };

  const senderId = m.direction === "inbound" ? input.counterpart.profileId : input.senderUserId;
  if (!senderId) return { kind: "unmatched", reason: "no_team_sender", phone };

  return {
    kind: "post",
    conversationId: input.ownerGroup.conversationId,
    orgId: input.counterpart.orgId,
    senderId,
    body,
    phone,
  };
}

export interface WhatsAppCaptureResult {
  ok: boolean;
  posted?: number;
  duplicate?: boolean;
  ignored?: WhatsAppCaptureReason;
  conversationId?: string;
  error?: string;
}

/**
 * Captures one WhatsApp message, or records why it could not be. The uid is the dedupe key
 * (messages_external_ref_whatsapp_idx), so a message the webhook already stored, or a second
 * run over the same history, is answered with `duplicate` and nothing is written twice.
 *
 * Deliberately does not touch whatsapp_threads: a message from months ago is not a recent
 * outbound, and treating it as one would misroute the customer's next live reply.
 */
export async function captureWhatsAppMessage(
  admin: Admin,
  msg: WhatsAppCaptureMessage,
  opts: { fallbackActorId?: string | null; raw?: unknown } = {},
): Promise<WhatsAppCaptureResult> {
  const parsed = msg.phone ? normaliseUkMobile(msg.phone) : null;
  const phone = parsed?.ok ? parsed.e164! : null;

  const counterpart = phone
    ? (
        await admin
          .from("profiles")
          .select("id, org_id, lead_category, deactivated_at")
          .eq("phone", phone)
          .maybeSingle()
      ).data
    : null;

  const isLead = Boolean(counterpart?.lead_category);
  const { data: membership } = isLead
    ? await admin
        .from("conversation_members")
        .select("conversation_id, conversations!inner(type, archived_at)")
        .eq("user_id", counterpart!.id)
        .eq("member_side", "external")
        .eq("conversations.type", "owner")
        .limit(1)
        .maybeSingle()
    : { data: null };
  const conv = membership?.conversations as unknown as { archived_at: string | null } | null;
  const ownerGroup = membership
    ? { conversationId: membership.conversation_id, archivedAt: conv?.archived_at ?? null }
    : null;

  let senderUserId: string | null = opts.fallbackActorId ?? null;
  if (isLead && msg.direction === "outbound" && msg.sentFrom) {
    const from = normaliseUkMobile(msg.sentFrom);
    if (from.ok && from.e164) {
      const { data: account } = await admin
        .from("whatsapp_accounts")
        .select("owner_user_id")
        .eq("org_id", counterpart!.org_id)
        .eq("phone", from.e164)
        .maybeSingle();
      if (account?.owner_user_id) senderUserId = account.owner_user_id;
    }
  }

  const decision = decideWhatsAppCapture({
    message: msg,
    counterpart: counterpart
      ? {
          profileId: counterpart.id,
          orgId: counterpart.org_id,
          leadCategory: counterpart.lead_category,
          deactivatedAt: counterpart.deactivated_at,
        }
      : null,
    ownerGroup,
    senderUserId,
  });

  if (decision.kind === "unmatched") {
    await admin.from("inbound_messages_unmatched").insert({
      channel: "whatsapp",
      external_ref: msg.messageUid?.trim() || null,
      from_identifier: decision.phone ?? "unknown",
      body: msg.text?.slice(0, 4000) || null,
      payload: (opts.raw ?? { direction: msg.direction, chat_id: msg.chatId, sent_at: msg.sentAt ?? null }) as never,
      reason: `capture_${decision.reason}`,
    });
    return { ok: true, ignored: decision.reason };
  }

  const { error } = await admin.from("messages").insert({
    org_id: decision.orgId,
    conversation_id: decision.conversationId,
    sender_id: decision.senderId,
    body: decision.body,
    kind: "text",
    visibility: "public",
    sent_via: "whatsapp",
    external_ref: msg.messageUid!.trim(),
    ...(msg.sentAt ? { created_at: msg.sentAt } : {}),
    meta: {
      // The one flag enqueue_message_notifications looks for: nothing goes back out.
      mirrored: true,
      backfill: true,
      whatsapp_direction: msg.direction,
      whatsapp_chat_id: msg.chatId,
      ...(msg.direction === "inbound" ? { whatsapp_from: decision.phone } : { whatsapp_to: decision.phone }),
      whatsapp_sent_from: msg.sentFrom ?? null,
      whatsapp_media_url: msg.mediaUrl ?? null,
      routed_via: "lead_backfill",
    },
  });
  if (error) {
    if (error.code === "23505")
      return { ok: true, posted: 0, duplicate: true, conversationId: decision.conversationId };
    return { ok: false, error: error.message };
  }
  return { ok: true, posted: 1, conversationId: decision.conversationId };
}
