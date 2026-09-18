import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { messageEmail, welcomeEmail } from "@/lib/email/templates";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { newReplyToken, replyAddress, replyDomain, REPLY_TOKEN_TTL_MS } from "@/lib/email/inbound";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp/timelines";
import { messageWhatsApp } from "@/lib/whatsapp/templates";
import { siteUrl } from "@/lib/site";
import { groupOutboxRows, skipReason } from "@/lib/notifications/policy";
import { authorised } from "@/lib/cron/auth";
import type { NotificationOutbox } from "@/lib/database.types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ATTEMPTS = 5;
/** Messages posted within this window to the same person in the same conversation go in one email (spec D8). */
const GROUP_WINDOW_MS = 2 * 60_000;
/**
 * WhatsApp does not batch: one message, one chat message, as agreed. That removes the natural
 * brake a grouping window gave us, so this cap is what stands between a busy morning and the
 * kind of outbound burst that gets a real WhatsApp number flagged. Rows over the cap simply
 * wait for the next minute — no attempt burned, nothing lost.
 */
const WHATSAPP_MAX_PER_RUN = Number(process.env.WHATSAPP_MAX_PER_RUN || 60);
/** Sends run in small parallel chunks: maxDuration is 60s and a run can hold 200 rows. */
const SEND_CONCURRENCY = 5;
/**
 * Rows are claimed by moving them to `sending`, and the drain only ever re-selects `pending`
 * and `failed`. Anything that dies between the claim and finish() would therefore sit in
 * `sending` for ever, unsent and unreported. Older claims are returned to the queue at the top
 * of each run, which is what makes a bad deploy recoverable rather than a silent loss.
 */
const STRANDED_CLAIM_MS = 10 * 60_000;

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
  sent_via?: string;
  /** enqueue_message_notifications (0019) puts this on every payload; a reply carries its thread. */
  parent_id?: string | null;
}

/**
 * Runs `run` over `items` a few at a time. Each call is isolated: a throw is logged and the
 * rest of the batch continues. Without that, one bad row would reject the whole Promise.all —
 * stranding every row already claimed in this run — and a second rejection in the same chunk
 * would surface as an unhandled rejection, which Node treats as fatal.
 */
async function chunked<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const results = await Promise.allSettled(items.slice(i, i + size).map(run));
    for (const r of results) {
      if (r.status === "rejected") console.error("notifications: send failed", r.reason);
    }
  }
}

/**
 * Posts scheduled messages whose time has come, as their sender.
 *
 * Claimed before posting, not after: the old version selected, inserted, and only then wrote
 * sent_message_id, so two overlapping runs both posted the same row and a Cancel pressed inside
 * that window set cancelled_at on a message already on its way out — the chip vanished and it
 * went anyway. A failure now hands the row back rather than leaving it claimed.
 */
async function postScheduledMessages(admin: NonNullable<ReturnType<typeof createAdminClient>>): Promise<number> {
  const { data: candidates } = await admin
    .from("scheduled_messages")
    .select("id")
    .is("sent_message_id", null)
    .is("cancelled_at", null)
    .is("claimed_at", null)
    .lte("send_at", new Date().toISOString())
    .order("send_at", { ascending: true })
    .limit(50);
  if (!candidates?.length) return 0;

  // Claim before posting. Re-asserting all three conditions inside the update is what makes it
  // a claim rather than a hopeful select: a second overlapping run takes nothing, and a Cancel
  // that lands first wins outright instead of arriving after the message has gone.
  const { data: due } = await admin
    .from("scheduled_messages")
    .update({ claimed_at: new Date().toISOString() })
    .in(
      "id",
      candidates.map((c) => c.id),
    )
    .is("sent_message_id", null)
    .is("cancelled_at", null)
    .is("claimed_at", null)
    .select("*");

  let posted = 0;
  for (const row of due ?? []) {
    // client_id makes the insert idempotent: messages_client_id_idx (0016) is unique on
    // (conversation_id, meta->>'client_id'), so if this row was posted but its sent_message_id
    // write did not land, the retry hits 23505 instead of posting a second copy. Messages from
    // the app have always had one; these did not, which is why nothing caught the duplicate.
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
        meta: { scheduled_id: row.id, client_id: row.id },
      })
      .select("id")
      .single();

    let messageId = msg?.id ?? null;
    if (error) {
      if (error.code !== "23505") {
        // Hand it back so the next run can try again, rather than stranding it as claimed.
        await admin.from("scheduled_messages").update({ claimed_at: null }).eq("id", row.id);
        continue;
      }
      // Already posted by a run that died before recording it. Find it and finish the job.
      const { data: existing } = await admin
        .from("messages")
        .select("id")
        .eq("conversation_id", row.conversation_id)
        .eq("meta->>client_id", row.id)
        .maybeSingle();
      messageId = existing?.id ?? null;
    }
    if (!messageId) continue;
    await admin.from("scheduled_messages").update({ sent_message_id: messageId }).eq("id", row.id);
    posted++;
  }
  return posted;
}

/**
 * Drains the notification outbox. Triggered every minute by Vercel Cron (vercel.json).
 * Idempotent: rows are claimed by moving them to `sending` before anything goes out.
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  const posted = await postScheduledMessages(admin);

  // Rescue anything a previous run claimed and never finished (see STRANDED_CLAIM_MS).
  //
  // Keyed on claimed_at, never created_at: created_at is when the row was queued, so asking for
  // rows older than the timeout returned every row that had merely *waited* — which is all of
  // them after an unconfigured provider or a WhatsApp burst — and handed them to the next run
  // while this one was still sending. That is how a queue double-sends everything.
  const { data: rescued } = await admin
    .from("notification_outbox")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "sending")
    .lt("claimed_at", new Date(Date.now() - STRANDED_CLAIM_MS).toISOString())
    .select("id");
  if (rescued?.length) console.warn(`notifications: requeued ${rescued.length} stranded row(s)`);

  // Each channel stands on its own: WhatsApp can ship without Resend and vice versa, and an
  // unconfigured channel leaves its rows `pending` rather than burning attempts against a
  // provider we cannot reach.
  const channels = [emailConfigured() ? "email" : null, whatsappConfigured() ? "whatsapp" : null].filter(
    (c): c is string => !!c,
  );
  if (!channels.length) {
    return NextResponse.json({ posted, error: "no notification channel is configured" }, { status: 503 });
  }

  // Email rows wait 20 seconds so a burst can batch into one message. WhatsApp does not batch,
  // so making it wait would only add a minute to every send.
  const cutoff = new Date(Date.now() - 20_000).toISOString();
  const { data: rows, error } = await admin
    .from("notification_outbox")
    .select("*")
    .in("status", ["pending", "failed"])
    .in("channel", channels)
    .lt("attempts", MAX_ATTEMPTS)
    .or(`channel.eq.whatsapp,created_at.lt.${cutoff}`)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ sent: 0, failed: 0, skipped: 0, posted });

  // Claim.
  //
  // One conditional statement, not a select followed by a blind update: this cron is scheduled
  // every minute and may run for sixty seconds, so two runs overlap by design. Both used to
  // select the same rows and both wrote `sending` unconditionally, so both sent. Re-asserting
  // the status the select saw means Postgres locks each row and the loser updates nothing;
  // `select("id")` then returns only what this run actually took.
  const { data: claimed } = await admin
    .from("notification_outbox")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    )
    .in("status", ["pending", "failed"])
    .select("id");
  const mine = new Set((claimed ?? []).map((r) => r.id));
  const claimedRows = rows.filter((r) => mine.has(r.id));
  if (!claimedRows.length) return NextResponse.json({ sent: 0, failed: 0, skipped: 0, posted });

  const base = siteUrl();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const finish = async (batch: NotificationOutbox[], ok: boolean, providerId?: string, err?: string) => {
    for (const r of batch) {
      await admin
        .from("notification_outbox")
        .update({
          status: ok ? "sent" : "failed",
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

  const skip = async (r: NotificationOutbox, reason: string) => {
    await admin.from("notification_outbox").update({ status: "skipped", last_error: reason }).eq("id", r.id);
    skipped++;
  };

  // Drop message notifications for recipients who turned a channel off, went away or paused
  // notifications since queuing. The trigger checks this too, but a minute passes in between
  // and going quiet the moment you set yourself away is the entire point of the feature.
  const recipientIds = Array.from(new Set(claimedRows.map((r) => r.recipient_user_id).filter((x): x is string => !!x)));
  const { data: prefs } = await admin
    .from("profiles")
    .select(
      "id, email_notifications, whatsapp_notifications, email, phone, presence_mode, away_until, dnd_until, lead_category",
    )
    .in("id", recipientIds);
  const prefById = new Map((prefs ?? []).map((p) => [p.id, p]));

  const messageRows = claimedRows.filter((r) => r.kind === "message");
  const live: NotificationOutbox[] = [];
  for (const r of messageRows) {
    const reason = skipReason(r, r.recipient_user_id ? prefById.get(r.recipient_user_id) : undefined);
    if (reason) await skip(r, reason);
    else live.push(r);
  }

  // ---- email -----------------------------------------------------------------
  // Email batches; WhatsApp deliberately does not (one message, one chat message).
  const groups = groupOutboxRows(
    live.filter((x) => x.channel === "email"),
    GROUP_WINDOW_MS,
  );

  const replyTo = async (userId: string, conversationId: string, orgId: string): Promise<string | undefined> => {
    if (!replyDomain()) return undefined;
    const { data: existing } = await admin
      .from("email_reply_threads")
      .select("token")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (existing) {
      // Every notification that carries the token pushes its expiry out, so a conversation
      // people are actually using never goes cold, and one nobody has touched for a month
      // stops being a way in (0031).
      await admin
        .from("email_reply_threads")
        .update({ expires_at: new Date(Date.now() + REPLY_TOKEN_TTL_MS).toISOString() })
        .eq("token", existing.token);
      return replyAddress(existing.token) ?? undefined;
    }
    const token = newReplyToken();
    const { error } = await admin
      .from("email_reply_threads")
      .insert({ token, org_id: orgId, user_id: userId, conversation_id: conversationId });
    return error ? undefined : (replyAddress(token) ?? undefined);
  };

  for (const batch of groups) {
    const first = batch[0].payload as unknown as MessagePayload;
    const to = batch[0].recipient_email;
    if (!to) {
      // Skip every row, not just the head. Skipping only batch[0] left the rest in 'sending'
      // with a claim, invisible to a drain that selects pending and failed — rescued ten
      // minutes later without burning an attempt, so they could never age out either.
      for (const row of batch) await skip(row, "no email address");
      continue;
    }
    // A batch is addressed once, to batch[0]. groupKey() already makes a mixed batch
    // impossible; this is the assertion that keeps it impossible if the key ever changes,
    // because the failure it guards against is one person receiving another person's messages
    // and nothing downstream would notice.
    const mixed = batch.find(
      (row) => row.recipient_email !== to || row.recipient_user_id !== batch[0].recipient_user_id,
    );
    if (mixed) {
      for (const row of batch) await skip(row, "batch addressed to more than one recipient");
      continue;
    }
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
      to,
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

  // ---- whatsapp --------------------------------------------------------------
  const waRows = live.filter((x) => x.channel === "whatsapp");

  // Which number each group sends from (0022). One query for the run, not one per message.
  const convIds = Array.from(new Set(waRows.map((r) => (r.payload as unknown as MessagePayload).conversation_id)));
  const accountByConv = new Map<string, { id: string; provider_account_id: string | null; phone: string }>();
  if (convIds.length) {
    const { data: convs, error: convErr } = await admin
      .from("conversations")
      .select("id, whatsapp_account:whatsapp_accounts(id, provider_account_id, phone)")
      .in("id", convIds);
    // Worth shouting about: with no accounts resolved every message still sends, but from
    // whichever number the provider defaults to, silently breaking the one-number-per-group
    // guarantee that 0022 exists to provide.
    if (convErr) console.error("notifications: could not resolve sending numbers", convErr.message);
    for (const c of convs ?? []) {
      const a = c.whatsapp_account as unknown as {
        id: string;
        provider_account_id: string | null;
        phone: string;
      } | null;
      if (a) accountByConv.set(c.id, a);
    }
  }
  const waSending = waRows.slice(0, WHATSAPP_MAX_PER_RUN);
  const waDeferred = waRows.slice(WHATSAPP_MAX_PER_RUN);
  // Over the cap: put them back so the next minute picks them up, rather than failing them.
  if (waDeferred.length) {
    await admin
      .from("notification_outbox")
      .update({ status: "pending", claimed_at: null })
      .in(
        "id",
        waDeferred.map((r) => r.id),
      );
  }

  await chunked(waSending, SEND_CONCURRENCY, async (r) => {
    const p = r.payload as unknown as MessagePayload;
    const to = r.recipient_phone;
    if (!to) {
      await skip(r, "no mobile number");
      return;
    }
    const isDm = p.conversation_type === "dm" || p.conversation_type === "group_dm";
    const pref = r.recipient_user_id ? prefById.get(r.recipient_user_id) : undefined;
    const { text } = messageWhatsApp({
      senderName: p.sender_name,
      body: p.body,
      conversationTitle: `#${p.conversation_name ?? "your group"}`,
      isGroup: !isDm,
      viewUrl: `${base}/home/${p.conversation_id}`,
      // A lead-database customer is not using the app and must not be pointed at it: they get
      // the message as it was typed, from the number they already know.
      plain: Boolean(pref?.lead_category),
    });
    const account = accountByConv.get(p.conversation_id);
    const res = await sendWhatsApp({
      to,
      text,
      accountId: account?.provider_account_id,
      accountPhone: account?.phone,
      label: "Stayful",
    });
    await finish([r], res.ok, res.id, res.error);

    if (res.ok) {
      // Remember which group — and which thread — we last WhatsApped this person from, so an
      // inbound reply has an authoritative place to land without re-deriving it.
      //
      // One row per (person, conversation) since 0025: a customer still has exactly one, because
      // 0018 still allows them exactly one customer group, but a cleaner accumulates one per
      // property they serve and the newest no longer overwrites the rest. parent_id is what makes
      // a reply land back under the Cleaning thread it came out of rather than loose in the group.
      await admin.from("whatsapp_threads").upsert(
        {
          user_id: r.recipient_user_id!,
          org_id: r.org_id,
          conversation_id: p.conversation_id,
          phone: to,
          whatsapp_account_id: account?.id ?? null,
          parent_message_id: p.parent_id ?? null,
          last_outbound_at: new Date().toISOString(),
        },
        { onConflict: "user_id,conversation_id" },
      );
      return;
    }

    // Out of retries: fall back to email rather than letting the message go undelivered, and
    // tell the team, because a number that no longer works is theirs to fix.
    if (r.attempts + 1 >= MAX_ATTEMPTS) await fallbackToEmail(r, p);
  });

  /**
   * Queues the email version of a message whose WhatsApp gave up, and leaves an internal note in
   * the conversation. `visibility: 'internal'` is never returned to customer accounts — over
   * Realtime or in sidebar previews — so this reaches the team where the problem is without the
   * customer seeing that we failed to reach them.
   */
  async function fallbackToEmail(r: NotificationOutbox, p: MessagePayload) {
    const pref = r.recipient_user_id ? prefById.get(r.recipient_user_id) : undefined;
    // Only for someone who takes email at all. This used to fall back regardless, which sent a
    // notification — login link and all — to a customer who had switched email off.
    const canEmail = Boolean(pref?.email && pref.email_notifications === "instant");
    if (canEmail) {
      // A plain insert, not an upsert: the dedupe index is on an expression
      // ((payload->>'message_id')) that PostgREST cannot name in on_conflict. A duplicate means
      // they already had an email row for this message, which is exactly the no-op we want.
      const { error: dupe } = await admin!.from("notification_outbox").insert({
        org_id: r.org_id,
        kind: "message",
        channel: "email",
        recipient_user_id: r.recipient_user_id,
        recipient_email: pref!.email,
        payload: r.payload,
        fallback_from: "whatsapp",
      });
      if (dupe && dupe.code !== "23505") console.error("whatsapp fallback to email failed", dupe.message);
    }
    // Written straight to messages rather than through channel_system_message: the admin client
    // bypasses RLS, and that RPC is not exposed to PostgREST.
    await admin!.from("messages").insert({
      org_id: r.org_id,
      conversation_id: p.conversation_id,
      sender_id: null,
      kind: "system",
      visibility: "internal",
      body: `WhatsApp to ${p.recipient_name} failed${canEmail ? " — sent by email instead" : ""}. Check their mobile number.`,
      meta: { event: "whatsapp_failed", user_id: r.recipient_user_id, error: r.last_error ?? null },
    });
  }

  // Welcome emails that the app could not send synchronously
  for (const r of claimedRows.filter((x) => x.kind === "welcome")) {
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
      await skip(r, "welcome email must be re-sent from the app");
      continue;
    }
    // recipient_email is nullable since 0019, so a welcome row needs an address either way.
    const to = p.email ?? r.recipient_email;
    if (!to) {
      await skip(r, "no email address");
      continue;
    }
    const mail = welcomeEmail({
      recipientName: p.recipient_name ?? "there",
      email: to,
      password: p.password,
      loginUrl: p.login_url ?? `${base}/login`,
      invitedBy: p.invited_by ?? "The Stayful team",
      groups: p.groups ?? [],
    });
    const res = await sendEmail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    await finish([r], res.ok, res.id, res.error);
  }

  return NextResponse.json({ sent, failed, skipped, posted, deferred: waDeferred.length });
}
