import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { messageEmail, welcomeEmail } from "@/lib/email/templates";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { newReplyToken, replyAddress, replyDomain } from "@/lib/email/inbound";
import { siteUrl } from "@/lib/site";
import { manualAway, notificationsSilenced } from "@/lib/presence";
import type { NotificationOutbox } from "@/lib/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 5;
/** Messages posted within this window to the same person in the same conversation go in one email (spec D8). */
const GROUP_WINDOW_MS = 2 * 60_000;

interface MessagePayload {
  message_id: string;
  conversation_id: string;
  conversation_type: string;
  conversation_name: string | null;
  sender_id: string | null;
  sender_name: string;
  recipient_name: string;
  body: string;
  created_at: string;
}

/**
 * Posts scheduled messages whose time has come, as their sender. Rows are claimed by setting
 * sent_message_id in one update after the insert; a failure leaves the row for the next minute.
 */
async function postScheduledMessages(admin: NonNullable<ReturnType<typeof createAdminClient>>): Promise<number> {
  const { data: due } = await admin
    .from("scheduled_messages")
    .select("*")
    .is("sent_message_id", null)
    .is("cancelled_at", null)
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(50);
  let posted = 0;
  for (const row of due ?? []) {
    const { data: msg, error } = await admin
      .from("messages")
      .insert({
        org_id: row.org_id,
        conversation_id: row.conversation_id,
        sender_id: row.sender_id,
        parent_id: row.parent_id,
        body: row.body,
        visibility: row.visibility,
        sent_via: "app",
        meta: { scheduled_id: row.id },
      })
      .select("id")
      .single();
    if (error || !msg) continue;
    await admin.from("scheduled_messages").update({ sent_message_id: msg.id }).eq("id", row.id);
    posted++;
  }
  return posted;
}

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

/**
 * Drains the notification outbox. Triggered every minute by Vercel Cron (vercel.json).
 * Idempotent: rows are claimed by moving them to `sending` before any email goes out.
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  const posted = await postScheduledMessages(admin);
  if (!emailConfigured()) return NextResponse.json({ posted, error: "RESEND_API_KEY is not set" }, { status: 503 });

  // Only send message notifications that have had a moment to batch up
  const cutoff = new Date(Date.now() - 20_000).toISOString();
  const { data: rows, error } = await admin
    .from("notification_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ sent: 0, failed: 0, skipped: 0 });

  // Claim
  const ids = rows.map((r) => r.id);
  await admin.from("notification_outbox").update({ status: "sending" }).in("id", ids);

  const base = siteUrl();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const finish = async (batch: NotificationOutbox[], ok: boolean, providerId?: string, err?: string) => {
    for (const r of batch) {
      await admin
        .from("notification_outbox")
        .update({
          status: ok ? "sent" : r.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "failed",
          attempts: r.attempts + 1,
          provider_message_id: providerId ?? r.provider_message_id,
          last_error: err ?? null,
          sent_at: ok ? new Date().toISOString() : r.sent_at,
        })
        .eq("id", r.id);
    }
    if (ok) sent += batch.length;
    else failed += batch.length;
  };

  // Drop message notifications for recipients who turned email off, went away or paused
  // notifications since queuing. The trigger checks this too, but a minute passes in between
  // and going quiet the moment you set yourself away is the entire point of the feature.
  const recipientIds = Array.from(new Set(rows.map((r) => r.recipient_user_id).filter((x): x is string => !!x)));
  const { data: prefs } = await admin
    .from("profiles")
    .select("id, email_notifications, email, presence_mode, away_until, dnd_until")
    .in("id", recipientIds);
  const prefById = new Map((prefs ?? []).map((p) => [p.id, p]));

  // Group message rows per recipient + conversation within the window
  const groups = new Map<string, NotificationOutbox[]>();
  for (const r of rows) {
    if (r.kind !== "message") continue;
    const p = r.payload as unknown as MessagePayload;
    const pref = r.recipient_user_id ? prefById.get(r.recipient_user_id) : undefined;
    if (pref && (pref.email_notifications === "off" || notificationsSilenced(pref))) {
      await admin
        .from("notification_outbox")
        .update({
          status: "skipped",
          last_error: notificationsSilenced(pref)
            ? manualAway(pref)
              ? "recipient away"
              : "notifications paused"
            : "email notifications off",
        })
        .eq("id", r.id);
      skipped++;
      continue;
    }
    const key = `${r.recipient_user_id}:${p.conversation_id}`;
    const list = groups.get(key) ?? [];
    const first = list[0] ? (list[0].payload as unknown as MessagePayload) : null;
    if (first && new Date(p.created_at).getTime() - new Date(first.created_at).getTime() > GROUP_WINDOW_MS) {
      groups.set(`${key}:${r.id}`, [r]);
    } else {
      list.push(r);
      groups.set(key, list);
    }
  }

  const replyTo = async (userId: string, conversationId: string, orgId: string): Promise<string | undefined> => {
    if (!replyDomain()) return undefined;
    const { data: existing } = await admin
      .from("email_reply_threads")
      .select("token")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (existing) return replyAddress(existing.token) ?? undefined;
    const token = newReplyToken();
    const { error } = await admin
      .from("email_reply_threads")
      .insert({ token, org_id: orgId, user_id: userId, conversation_id: conversationId });
    return error ? undefined : (replyAddress(token) ?? undefined);
  };

  for (const batch of groups.values()) {
    const first = batch[0].payload as unknown as MessagePayload;
    const isDm = first.conversation_type === "dm" || first.conversation_type === "group_dm";
    const title = isDm ? first.sender_name : `#${first.conversation_name ?? "conversation"}`;
    const mail = messageEmail({
      recipientName: first.recipient_name,
      conversationTitle: title,
      items: batch.map((r) => {
        const p = r.payload as unknown as MessagePayload;
        return { senderName: p.sender_name, body: p.body, createdAt: p.created_at };
      }),
      viewUrl: `${base}/home/${first.conversation_id}`,
      unsubscribeUrl: unsubscribeUrl(base, batch[0].recipient_user_id ?? ""),
      canReplyByEmail: !!replyDomain(),
    });
    const res = await sendEmail({
      to: batch[0].recipient_email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: batch[0].recipient_user_id
        ? await replyTo(batch[0].recipient_user_id, first.conversation_id, batch[0].org_id)
        : undefined,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl(base, batch[0].recipient_user_id ?? "")}>` },
    });
    await finish(batch, res.ok, res.id, res.error);
  }

  // Welcome emails that the app could not send synchronously
  for (const r of rows.filter((x) => x.kind === "welcome")) {
    const p = r.payload as {
      email?: string;
      login_url?: string;
      invited_by?: string;
      groups?: string[];
      recipient_name?: string;
      password?: string;
    };
    if (!p.password) {
      // The password is never stored; the team re-sends login details from the app instead.
      await admin
        .from("notification_outbox")
        .update({ status: "skipped", last_error: "welcome email must be re-sent from the app" })
        .eq("id", r.id);
      skipped++;
      continue;
    }
    const mail = welcomeEmail({
      recipientName: p.recipient_name ?? "there",
      email: p.email ?? r.recipient_email,
      password: p.password,
      loginUrl: p.login_url ?? `${base}/login`,
      invitedBy: p.invited_by ?? "The Stayful team",
      groups: p.groups ?? [],
    });
    const res = await sendEmail({ to: r.recipient_email, subject: mail.subject, html: mail.html, text: mail.text });
    await finish([r], res.ok, res.id, res.error);
  }

  return NextResponse.json({ sent, failed, skipped, posted });
}
