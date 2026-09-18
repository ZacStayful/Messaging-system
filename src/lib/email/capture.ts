/**
 * Capturing email that never had a reply token.
 *
 * The reply-by-email path works because every notification carries a token that says who is
 * replying and to which conversation. Lead-database customers get no notifications by email, so
 * nothing they send carries one — they write to zac@stayful.co.uk, and until now that mail went
 * nowhere near the system.
 *
 * This is the matcher for that mail: the From line (inbound) or the To line (outbound) names a
 * lead-database customer, and the message goes into their group. It is fed from two places —
 * the Resend inbound webhook, for mail Gmail auto-forwards to a capture address, and
 * POST /api/email/capture, for an automation that reads a mailbox (both directions).
 *
 * The From line is an unauthenticated header. That is tolerable here for the same reason the
 * reply-token path tolerates it as a secondary check: a forged message lands in an internal
 * thread only the team can read, attributed to someone who cannot sign in, and it never sends
 * anything back out (meta.mirrored). It is not tolerable for anyone else, which is why only
 * lead-database customers are matched.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { htmlToText, stripQuotedReply } from "./inbound";

type Admin = SupabaseClient<Database>;

/** "Name <a@b.com>" or "a@b.com" → "a@b.com", lower-cased. */
export function emailAddressOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : null;
}

/** "<abc@mail.gmail.com>" → "abc@mail.gmail.com". RFC 5322 message ids are wrapped in brackets. */
export function normaliseMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const id = raw.trim().replace(/^<|>$/g, "").trim();
  return id || null;
}

/** The address Gmail forwards to, on the receiving domain. Unset means the forward path is off. */
export function captureAddress(): string | null {
  const addr = process.env.EMAIL_CAPTURE_ADDRESS?.trim().toLowerCase();
  return addr || null;
}

export function isCaptureRecipient(recipients: (string | null | undefined)[]): boolean {
  const target = captureAddress();
  if (!target) return false;
  return recipients.some((r) => emailAddressOf(r) === target);
}

export type CaptureDirection = "inbound" | "outbound";

export interface CaptureMessage {
  messageId: string | null;
  from: string | null;
  to: string[];
  cc?: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  /** Known when an automation says so; inferred from who the sender is otherwise. */
  direction?: CaptureDirection | null;
}

export interface LeadRecord {
  userId: string;
  orgId: string;
  deactivatedAt: string | null;
  ownerGroup: { conversationId: string; archivedAt: string | null } | null;
}

export interface CaptureDirectory {
  /** Every lead-database customer, by lower-cased email. */
  leadsByEmail: Map<string, LeadRecord>;
  /** Every team member, by lower-cased email → user id. */
  teamByEmail: Map<string, string>;
  /** Who an outbound message is attributed to when its From is not a team member's address. */
  fallbackTeamUserId: string | null;
}

export type CaptureReason =
  "no_message_id" | "no_sender" | "no_lead" | "deactivated" | "no_group" | "archived" | "empty_body" | "no_team_sender";

export interface CapturePost {
  conversationId: string;
  orgId: string;
  senderId: string;
  leadUserId: string;
}

export type CaptureDecision =
  | { kind: "post"; direction: CaptureDirection; body: string; posts: CapturePost[] }
  | { kind: "unmatched"; reason: CaptureReason; from: string | null };

/**
 * Pure. Inbound: the sender must be a lead, and the message is posted as them. Outbound: every
 * lead among the recipients gets a copy in their group, posted as the team member who sent it
 * (or the fallback), because an email to two leads is two conversations.
 */
export function decideCapture(msg: CaptureMessage, dir: CaptureDirectory): CaptureDecision {
  const from = emailAddressOf(msg.from);
  if (!normaliseMessageId(msg.messageId)) return { kind: "unmatched", reason: "no_message_id", from };
  if (!from) return { kind: "unmatched", reason: "no_sender", from };

  const direction: CaptureDirection = msg.direction ?? (dir.teamByEmail.has(from) ? "outbound" : "inbound");

  const check = (lead: LeadRecord): CaptureReason | null => {
    if (lead.deactivatedAt) return "deactivated";
    if (!lead.ownerGroup) return "no_group";
    if (lead.ownerGroup.archivedAt) return "archived";
    return null;
  };

  const body = stripQuotedReply(msg.text?.trim() ? msg.text : htmlToText(msg.html ?? ""));

  if (direction === "inbound") {
    const lead = dir.leadsByEmail.get(from);
    if (!lead) return { kind: "unmatched", reason: "no_lead", from };
    const reason = check(lead);
    if (reason) return { kind: "unmatched", reason, from };
    if (!body) return { kind: "unmatched", reason: "empty_body", from };
    return {
      kind: "post",
      direction,
      body,
      posts: [
        {
          conversationId: lead.ownerGroup!.conversationId,
          orgId: lead.orgId,
          senderId: lead.userId,
          leadUserId: lead.userId,
        },
      ],
    };
  }

  const senderId = dir.teamByEmail.get(from) ?? dir.fallbackTeamUserId;
  if (!senderId) return { kind: "unmatched", reason: "no_team_sender", from };

  const recipients = [...msg.to, ...(msg.cc ?? [])].map(emailAddressOf).filter((a): a is string => !!a);
  const posts: CapturePost[] = [];
  let firstReason: CaptureReason | null = null;
  const seen = new Set<string>();
  for (const addr of recipients) {
    if (seen.has(addr)) continue;
    seen.add(addr);
    const lead = dir.leadsByEmail.get(addr);
    if (!lead) continue;
    const reason = check(lead);
    if (reason) {
      firstReason ??= reason;
      continue;
    }
    posts.push({
      conversationId: lead.ownerGroup!.conversationId,
      orgId: lead.orgId,
      senderId,
      leadUserId: lead.userId,
    });
  }
  if (!posts.length) return { kind: "unmatched", reason: firstReason ?? "no_lead", from };
  if (!body) return { kind: "unmatched", reason: "empty_body", from };
  return { kind: "post", direction, body, posts };
}

/** Everything decideCapture needs, read in one place. */
export async function loadCaptureDirectory(admin: Admin, fallbackTeamUserId: string | null): Promise<CaptureDirectory> {
  const [{ data: leads }, { data: team }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, org_id, email, deactivated_at")
      .not("lead_category", "is", null)
      .not("email", "is", null),
    admin
      .from("profiles")
      .select("id, email")
      .eq("account_type", "team")
      .is("deactivated_at", null)
      .not("email", "is", null),
  ]);

  const leadIds = (leads ?? []).map((l) => l.id);
  const groups = new Map<string, { conversationId: string; archivedAt: string | null }>();
  if (leadIds.length) {
    const { data: memberships } = await admin
      .from("conversation_members")
      .select("user_id, conversation_id, conversations!inner(type, archived_at)")
      .in("user_id", leadIds)
      .eq("member_side", "external")
      .eq("conversations.type", "owner");
    for (const m of memberships ?? []) {
      const conv = m.conversations as unknown as { archived_at: string | null } | null;
      // Prefer a live group if a person somehow has an archived one too.
      const current = groups.get(m.user_id);
      if (current && !current.archivedAt) continue;
      groups.set(m.user_id, { conversationId: m.conversation_id, archivedAt: conv?.archived_at ?? null });
    }
  }

  const leadsByEmail = new Map<string, LeadRecord>();
  for (const l of leads ?? []) {
    const email = emailAddressOf(l.email);
    if (!email) continue;
    leadsByEmail.set(email, {
      userId: l.id,
      orgId: l.org_id,
      deactivatedAt: l.deactivated_at,
      ownerGroup: groups.get(l.id) ?? null,
    });
  }
  const teamByEmail = new Map<string, string>();
  for (const t of team ?? []) {
    const email = emailAddressOf(t.email);
    if (email) teamByEmail.set(email, t.id);
  }
  return { leadsByEmail, teamByEmail, fallbackTeamUserId };
}

export interface CaptureResult {
  ok: boolean;
  posted?: number;
  duplicate?: boolean;
  ignored?: CaptureReason;
  error?: string;
}

/**
 * Captures one email, or records why it could not be. The Message-ID is the dedupe key
 * (messages_external_ref_email_idx), so the same mail arriving by both the forward and the
 * automation is stored once.
 */
export async function captureEmail(
  admin: Admin,
  msg: CaptureMessage,
  opts: { fallbackActorId?: string | null; raw?: unknown } = {},
): Promise<CaptureResult> {
  const directory = await loadCaptureDirectory(admin, opts.fallbackActorId ?? null);
  const decision = decideCapture(msg, directory);
  const messageId = normaliseMessageId(msg.messageId);

  if (decision.kind === "unmatched") {
    await admin.from("inbound_messages_unmatched").insert({
      channel: "email",
      external_ref: messageId,
      from_identifier: decision.from ?? "unknown",
      body: msg.text?.slice(0, 4000) ?? null,
      payload: (opts.raw ?? { subject: msg.subject, to: msg.to, cc: msg.cc ?? [] }) as never,
      reason: `capture_${decision.reason}`,
    });
    return { ok: true, ignored: decision.reason };
  }

  let posted = 0;
  let duplicate = false;
  for (const post of decision.posts) {
    const { error } = await admin.from("messages").insert({
      org_id: post.orgId,
      conversation_id: post.conversationId,
      sender_id: post.senderId,
      body: decision.body,
      kind: "text",
      visibility: "public",
      sent_via: "email",
      // One email to two leads is two rows, so the key carries the conversation.
      external_ref: decision.posts.length > 1 ? `${messageId}#${post.conversationId}` : messageId,
      meta: {
        mirrored: true,
        email_direction: decision.direction,
        email_subject: msg.subject ?? null,
        email_from: emailAddressOf(msg.from),
        email_to: msg.to.map(emailAddressOf).filter(Boolean),
        email_message_id: messageId,
        captured_for: post.leadUserId,
      },
    });
    if (error) {
      if (error.code === "23505") {
        duplicate = true;
        continue;
      }
      return { ok: false, error: error.message, posted };
    }
    posted++;
  }
  return { ok: true, posted, duplicate: duplicate || undefined };
}
