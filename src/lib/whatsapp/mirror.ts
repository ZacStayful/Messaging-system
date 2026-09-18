/**
 * Mirroring what the team types on the phone.
 *
 * The inbound webhook drops every `direction === "sent"` message, and for good reason: the
 * app's own WhatsApp notifications come back through the same webhook, and storing one would
 * post it as a new message, which notifies, which comes back. That guard stays.
 *
 * But a lead-database customer is being talked to from a phone, not from the app, and a thread
 * with only their half of the conversation is not much of a record. So a "sent" message is
 * mirrored into their group when — and only when — it was typed on the phone rather than sent
 * by the app. The decision is pure and lives in decideMirror; mirrorSentMessage does the reads
 * and the one write.
 *
 * Only lead-database customers are mirrored. For everyone else the app is the way the team
 * writes to them, and every one of those sends echoes here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normaliseUkMobile } from "@/lib/phone";
import type { InboundWhatsApp } from "./inbound";

type Admin = SupabaseClient<Database>;

/** How far back to look for an app send with the same text: the drain runs once a minute. */
export const APP_SEND_WINDOW_MS = 10 * 60_000;

/** The other party's number. For a sent message that is the recipient, not the sender. */
export function counterpartPhone(
  m: Pick<InboundWhatsApp, "direction" | "fromPhone" | "chatPhone" | "recipientPhone">,
): string | null {
  if (m.direction === "sent") return m.recipientPhone ?? m.chatPhone ?? null;
  return m.fromPhone || m.chatPhone || null;
}

export interface MirrorInput {
  message: Pick<
    InboundWhatsApp,
    "direction" | "isGroup" | "externalRef" | "text" | "mediaUrl" | "fromPhone" | "chatPhone" | "recipientPhone"
  >;
  /** The person the number belongs to, if any. */
  counterpart: { profileId: string; orgId: string; leadCategory: string | null; deactivatedAt: string | null } | null;
  /** Their customer group, if they have one. */
  ownerGroup: { conversationId: string; archivedAt: string | null } | null;
  /** True when the app sent it: the uid is in the outbox, or an outbox row just sent this text. */
  sentByApp: boolean;
  /** The team member the sending number belongs to; null posts the mirror as a system-less row. */
  senderUserId: string | null;
}

export type MirrorReason =
  | "not_sent"
  | "group"
  | "no_counterpart_phone"
  | "bad_number"
  | "sent_by_app"
  | "unknown_counterpart"
  | "not_a_lead"
  | "deactivated"
  | "no_group"
  | "archived"
  | "empty_body";

export type MirrorDecision =
  | { kind: "mirror"; conversationId: string; orgId: string; senderId: string | null; body: string; to: string }
  | {
      kind: "ignore";
      reason: MirrorReason;
      /** Whether this is worth a row in inbound_messages_unmatched. Most are not. */
      record: boolean;
    };

/**
 * The decision, in order:
 *
 * 1. Not a sent message, or a group chat → not this code's business.
 * 2. No usable counterpart number → nothing to match on.
 * 3. Sent by the app → the echo loop guard, unchanged in effect.
 * 4. Nobody, or somebody who is not a lead-database customer → ignored quietly. Every app send
 *    to an ordinary customer passes through here, and a record per one would bury the table.
 * 5. Deactivated, no group, archived, empty → recorded, because for a lead these are the
 *    cases someone needs to look at.
 */
export function decideMirror(input: MirrorInput): MirrorDecision {
  const m = input.message;
  if (m.direction !== "sent") return { kind: "ignore", reason: "not_sent", record: false };
  if (m.isGroup) return { kind: "ignore", reason: "group", record: false };

  const raw = counterpartPhone(m);
  if (!raw) return { kind: "ignore", reason: "no_counterpart_phone", record: false };
  const parsed = normaliseUkMobile(raw);
  if (!parsed.ok || !parsed.e164) return { kind: "ignore", reason: "bad_number", record: false };

  if (input.sentByApp) return { kind: "ignore", reason: "sent_by_app", record: false };
  if (!input.counterpart) return { kind: "ignore", reason: "unknown_counterpart", record: false };
  if (!input.counterpart.leadCategory) return { kind: "ignore", reason: "not_a_lead", record: false };
  if (input.counterpart.deactivatedAt) return { kind: "ignore", reason: "deactivated", record: true };
  if (!input.ownerGroup) return { kind: "ignore", reason: "no_group", record: true };
  if (input.ownerGroup.archivedAt) return { kind: "ignore", reason: "archived", record: true };

  const body = m.text.trim() || (m.mediaUrl ? "[Sent an attachment on WhatsApp]" : "");
  if (!body) return { kind: "ignore", reason: "empty_body", record: true };

  return {
    kind: "mirror",
    conversationId: input.ownerGroup.conversationId,
    orgId: input.counterpart.orgId,
    senderId: input.senderUserId,
    body,
    to: parsed.e164,
  };
}

/**
 * Whether the app sent this message. Two fingerprints, because the webhook can beat the drain
 * to the database: the uid the drain stores on the outbox row once TimelinesAI has answered,
 * and failing that, an outbox row to this number in the last few minutes carrying the same
 * text. A phone-typed message that happens to repeat an app send word for word within ten
 * minutes is not mirrored; that is the cheaper mistake.
 */
async function wasSentByApp(admin: Admin, uid: string, to: string, text: string): Promise<boolean> {
  const { data: byUid } = await admin
    .from("notification_outbox")
    .select("id")
    .eq("channel", "whatsapp")
    .eq("provider_message_id", uid)
    .limit(1)
    .maybeSingle();
  if (byUid) return true;

  const since = new Date(Date.now() - APP_SEND_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("notification_outbox")
    .select("payload")
    .eq("channel", "whatsapp")
    .eq("recipient_phone", to)
    .in("status", ["sending", "sent"])
    .gte("created_at", since)
    .limit(20);
  const wanted = text.trim();
  if (!wanted) return false;
  return (recent ?? []).some((r) => {
    const body = (r.payload as { body?: unknown } | null)?.body;
    return typeof body === "string" && body.trim() === wanted;
  });
}

/** The team member whose number this was sent from, by whatever the webhook told us. */
async function senderFor(
  admin: Admin,
  orgId: string,
  m: InboundWhatsApp,
  conversationId: string,
): Promise<string | null> {
  if (m.receivedOn) {
    const { data: account } = await admin
      .from("whatsapp_accounts")
      .select("owner_user_id")
      .eq("org_id", orgId)
      .eq("phone", m.receivedOn)
      .maybeSingle();
    if (account?.owner_user_id) return account.owner_user_id;
  }
  if (m.receivedByEmail) {
    const { data: owner } = await admin
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .ilike("email", m.receivedByEmail)
      .maybeSingle();
    if (owner) return owner.id;
  }
  const { data: internal } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("member_side", "internal")
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return internal?.user_id ?? null;
}

/**
 * Mirrors one "sent" message into the lead's group, or says why not. Always resolves: the
 * webhook route answers 200 whatever happens here, for the same reason it does for received
 * messages.
 */
export async function mirrorSentMessage(admin: Admin, m: InboundWhatsApp, raw: unknown): Promise<unknown> {
  const rawTo = counterpartPhone(m);
  const parsed = rawTo ? normaliseUkMobile(rawTo) : null;
  const to = parsed?.ok ? parsed.e164! : null;

  const counterpart = to
    ? (await admin.from("profiles").select("id, org_id, lead_category, deactivated_at").eq("phone", to).maybeSingle())
        .data
    : null;

  // The reads that only matter for a lead are skipped for everyone else: an app send to an
  // ordinary customer should cost one profile lookup, not four queries.
  const isLead = Boolean(counterpart?.lead_category);
  const [sentByApp, membership] = isLead
    ? await Promise.all([
        wasSentByApp(admin, m.externalRef, to!, m.text),
        admin
          .from("conversation_members")
          .select("conversation_id, conversations!inner(type, archived_at)")
          .eq("user_id", counterpart!.id)
          .eq("member_side", "external")
          .eq("conversations.type", "owner")
          .limit(1)
          .maybeSingle(),
      ])
    : [false, { data: null }];

  const conv = membership.data?.conversations as unknown as { archived_at: string | null } | null;
  const ownerGroup = membership.data
    ? { conversationId: membership.data.conversation_id, archivedAt: conv?.archived_at ?? null }
    : null;
  const senderUserId =
    isLead && ownerGroup ? await senderFor(admin, counterpart!.org_id, m, ownerGroup.conversationId) : null;

  const decision = decideMirror({
    message: m,
    counterpart: counterpart
      ? {
          profileId: counterpart.id,
          orgId: counterpart.org_id,
          leadCategory: counterpart.lead_category,
          deactivatedAt: counterpart.deactivated_at,
        }
      : null,
    ownerGroup,
    sentByApp,
    senderUserId,
  });

  if (decision.kind === "ignore") {
    if (decision.record) {
      await admin.from("inbound_messages_unmatched").insert({
        channel: "whatsapp",
        external_ref: m.externalRef,
        from_identifier: m.receivedOn ?? m.fromPhone,
        body: m.text || null,
        payload: (raw ?? {}) as never,
        reason: `mirror_${decision.reason}`,
      });
    }
    return { ignored: decision.reason, ref: m.externalRef, mirror: true };
  }

  const { error } = await admin.from("messages").insert({
    org_id: decision.orgId,
    conversation_id: decision.conversationId,
    sender_id: decision.senderId,
    body: decision.body,
    kind: "text",
    visibility: "public",
    sent_via: "whatsapp",
    external_ref: m.externalRef,
    meta: {
      // The one flag enqueue_message_notifications looks for: the customer has this already.
      mirrored: true,
      whatsapp_direction: "sent",
      whatsapp_chat_id: m.chatId,
      whatsapp_to: decision.to,
      whatsapp_sent_from: m.receivedOn ?? null,
      whatsapp_media_url: m.mediaUrl ?? null,
      routed_via: "lead_mirror",
    },
  });
  if (error) {
    // messages_external_ref_whatsapp_idx: TimelinesAI redelivered one we already stored.
    if (error.code === "23505") return { ok: true, duplicate: true, ref: m.externalRef, mirror: true };
    return { error: error.message, ref: m.externalRef, mirror: true };
  }

  // The next reply from them lands here as recent_customer without re-deriving anything.
  await admin.from("whatsapp_threads").upsert(
    {
      user_id: counterpart!.id,
      org_id: decision.orgId,
      conversation_id: decision.conversationId,
      phone: decision.to,
      last_outbound_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );

  return { ok: true, ref: m.externalRef, conversation_id: decision.conversationId, mirror: true };
}
