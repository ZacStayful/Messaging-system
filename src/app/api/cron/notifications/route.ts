import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { messageEmail, welcomeEmail } from "@/lib/email/templates";
import { unsubscribeUrl } from "@/lib/email/unsubscribe";
import { newReplyToken, replyAddress, replyDomain, REPLY_TOKEN_TTL_MS } from "@/lib/email/inbound";
import { findSentMessage, sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp/timelines";
import { messageWhatsApp } from "@/lib/whatsapp/templates";
import { siteUrl } from "@/lib/site";
import { groupOutboxRows, settleBatch, skipReason } from "@/lib/notifications/policy";
import { keyForBatch } from "@/lib/notifications/idempotency";
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
  let dead = 0;
  let duplicates = 0;

  /**
   * Recorded immediately before handing anything to a provider.
   *
   * The claim stops two runs sending the same row; this is what survives one run dying between
   * the provider accepting a message and the UPDATE that records it. A row picked up later with
   * dispatched_at already set is one somebody already handed over, and the channel decides what
   * to do about that — see 0038.
   */
  const markDispatched = async (batch: NotificationOutbox[], idempotencyKey?: string): Promise<boolean> => {
    const at = new Date().toISOString();
    const { error } = await admin
      .from("notification_outbox")
      .update({ dispatched_at: at, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) })
      .in(
        "id",
        batch.map((r) => r.id),
      );
    // Checked, and the caller does not send if it failed. This write is the whole safety net:
    // without the key on the rows, a run that dies after the send re-batches them under a key
    // Resend has never seen and delivers a second copy. Leaving them claimed costs one rescue
    // cycle and delivers once; sending regardless risks delivering twice, which cannot be undone.
    if (error) console.error("notifications: could not record dispatch, holding the send", error.message);
    return !error;
  };

  /**
   * Settles a whole batch at once.
   *
   * One statement per outcome rather than one per row, because the per-row loop was itself a
   * bug: a run killed partway through it — maxDuration is 60 seconds and a run can hold 200
   * rows — left some rows `sent` and the rest `sending`, and `chunked` swallows a throw, so a
   * single failed UPDATE did the same while the run still answered 200. The stranded remainder
   * was then rescued as a strict subset of the batch, which under the old scheme hashed to an
   * idempotency key Resend had never seen and sent the same email again. 0044 makes that
   * replay safe; this makes it rare.
   *
   * Grouped by the attempts each row arrived with — normally one group, since rows in a batch
   * have always travelled together — so `attempts + 1` stays exact without a round trip per row.
   */
  const finish = async (batch: NotificationOutbox[], ok: boolean, providerId?: string, err?: string) => {
    const { groups, goneQuiet } = settleBatch(batch, ok, MAX_ATTEMPTS);
    for (const group of groups) {
      await admin
        .from("notification_outbox")
        .update({
          status: group.status,
          attempts: group.attempts,
          ...(providerId ? { provider_message_id: providerId } : {}),
          last_error: err ?? null,
          ...(ok ? { sent_at: new Date().toISOString() } : {}),
        })
        .in("id", group.ids);
      if (group.status === "dead") {
        dead += group.ids.length;
        // Said out loud as well as recorded, because nothing reads this table: its only policy
        // is an admin SELECT for debugging.
        for (const id of group.ids) {
          console.error(
            `notifications: giving up on outbox row ${id} after ${group.attempts} attempts: ${err ?? "no error recorded"}`,
          );
        }
      }
    }
    // One note for the batch, not one per row. Every row in it shares a recipient and a
    // conversation by construction (policy.ts groupKey), so N notes were N copies of one
    // sentence in one place.
    if (goneQuiet.length) {
      const byId = new Set(goneQuiet);
      await noteGiveUp(
        batch.filter((r) => byId.has(r.id)),
        err,
      );
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

  /**
   * A fresh reply token for this email.
   *
   * One per notification since 0036, where it used to be one per (person, conversation) reused
   * for ever, with its expiry pushed out by every send and every reply. That made a notification
   * from months ago, forwarded to anyone, a working way to post as its recipient — and the From
   * line is the only other gate, which is an unauthenticated header.
   *
   * Minting per email costs one insert on a send we are making anyway, and means the token in
   * someone's inbox stops working a week after it arrives whatever else happens.
   *
   * The token comes back alongside the address because a send does not always use it: Resend
   * can answer that this key was already delivered, or that another request holds it. The email
   * that did go out carries its own working token, so the one minted here would sit in the table
   * until it expired, unreachable, one more on every replay. Handing it back lets the caller
   * take it away again.
   */
  const replyTo = async (
    userId: string,
    conversationId: string,
    orgId: string,
  ): Promise<{ address?: string; token?: string }> => {
    if (!replyDomain()) return {};
    const token = newReplyToken();
    const { error } = await admin.from("email_reply_threads").insert({
      token,
      org_id: orgId,
      user_id: userId,
      conversation_id: conversationId,
      expires_at: new Date(Date.now() + REPLY_TOKEN_TTL_MS).toISOString(),
    });
    return error ? {} : { address: replyAddress(token) ?? undefined, token };
  };

  /** Removes a token that was minted for a send nobody received. */
  const dropReplyToken = async (token?: string) => {
    if (token) await admin.from("email_reply_threads").delete().eq("token", token);
  };

  // Concurrent, like WhatsApp already was. SEND_CONCURRENCY has been declared since this file
  // was written and only ever applied to WhatsApp (chunked, below); email was a plain sequential
  // loop, with an `await replyTo(...)` inline in the arguments costing another round trip per
  // batch before the send even started. Two hundred batches at a few hundred milliseconds each
  // is the whole 60-second budget on its own.
  await chunked(groups, SEND_CONCURRENCY, async (batch) => {
    const first = batch[0].payload as unknown as MessagePayload;
    const to = batch[0].recipient_email;
    if (!to) {
      // Skip every row, not just the head. Skipping only batch[0] left the rest in 'sending'
      // with a claim, invisible to a drain that selects pending and failed — rescued ten
      // minutes later without burning an attempt, so they could never age out either.
      for (const row of batch) await skip(row, "no email address");
      return;
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
      return;
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
    // Derived from the rows this email is made of, so a retry after a crash replays Resend's
    // original response rather than sending a second copy — but only if it is the *same* key.
    // A row that already carries one has been handed over under it once (0044), and recomputing
    // from whichever rows survived would mint a key Resend has never seen and send again.
    const idempotencyKey = keyForBatch(batch);
    // Held, not sent, if the key could not be recorded: see markDispatched. The rows stay
    // claimed and the stranded-claim rescue brings them back.
    if (!(await markDispatched(batch, idempotencyKey))) return;
    const reply = batch[0].recipient_user_id
      ? await replyTo(batch[0].recipient_user_id, first.conversation_id, batch[0].org_id)
      : {};
    const res = await sendEmail({
      idempotencyKey,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo: reply.address,
      headers: { "List-Unsubscribe": `<${unsubscribeUrl(base, batch[0].recipient_user_id ?? "")}>` },
    });
    if (res.inFlight) {
      // Another request holding this key is still running. Neither sent nor failed — burning an
      // attempt on it would be wrong, so put it back and let the next minute settle it.
      await dropReplyToken(reply.token);
      await admin
        .from("notification_outbox")
        .update({ status: "pending", claimed_at: null })
        .in(
          "id",
          batch.map((r) => r.id),
        );
      return;
    }
    if (res.duplicate) {
      // Resend already delivered this key. The email in their inbox carries the token minted on
      // that first send, so this one is unreachable from the moment it was written.
      duplicates += batch.length;
      await dropReplyToken(reply.token);
    }
    await finish(batch, res.ok, res.id, res.error);
  });

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

    // A previous attempt already handed this to TimelinesAI and did not live to record the
    // outcome (0038). TimelinesAI has no idempotency key, so rather than guess between a
    // duplicate and a miss, ask: read what we sent to this number since that moment.
    if (r.dispatched_at) {
      const already = await findSentMessage({ phone: to, text, since: r.dispatched_at });
      if (already?.found) {
        duplicates++;
        console.warn(`notifications: outbox row ${r.id} was already delivered; not sending again`);
        await finish([r], true, already.uid);
        return;
      }
      // `null` is "could not find out" — the API refused, or there is no chat. Sending is the
      // right move on an unanswered question here: the row is a notification the customer has
      // not demonstrably received, and a second copy is recoverable in a way a silent miss is
      // not. `found: false` is a real answer and means the same thing.
      if (already === null) {
        console.warn(`notifications: could not confirm delivery of outbox row ${r.id}; sending again`);
      }
    }

    // Deliberately not held on a failed write, unlike email. WhatsApp's recovery is the
    // findSentMessage check above, which asks the provider what it actually has rather than
    // relying on anything recorded here, and this channel's stated preference (see the comment
    // on `already === null`) is to send again rather than risk a silent miss.
    await markDispatched([r]);
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
    if (r.attempts + 1 >= MAX_ATTEMPTS) await fallbackToEmail(r, p, res.error);
  });

  /**
   * Queues the email version of a message whose WhatsApp gave up, and leaves an internal note in
   * the conversation. `visibility: 'internal'` is never returned to customer accounts — over
   * Realtime or in sidebar previews — so this reaches the team where the problem is without the
   * customer seeing that we failed to reach them.
   */
  // `lastError` is this attempt's error, passed in. It used to read r.last_error off the
  // in-memory row, which holds the *previous* run's error — null on a first failure — because
  // finish() writes the new one to the database and never back onto the object.
  async function fallbackToEmail(r: NotificationOutbox, p: MessagePayload, lastError?: string) {
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
      meta: { event: "whatsapp_failed", user_id: r.recipient_user_id, error: lastError ?? r.last_error ?? null },
    });
  }

  /**
   * Tells the team that somebody was never reached.
   *
   * Only for a message notification, and only once — at the give-up, not on each retry, and not
   * once per row. The WhatsApp channel already had this via fallbackToEmail; email had nothing
   * at all, so five failed attempts to reach a customer left no trace anywhere a person looks.
   *
   * Takes the whole batch because it used to sit inside finish()'s per-row loop, so a dead batch
   * of six rows posted six byte-identical notes into one conversation. Its own doc comment
   * already claimed "only once", which was true across retries and false across rows.
   */
  async function noteGiveUp(batch: NotificationOutbox[], err?: string) {
    // WhatsApp announces its own give-up through fallbackToEmail, including whether the email
    // fallback went out. Two notes for one failure would read like two failures.
    const rows = batch.filter((r) => r.kind === "message" && r.channel !== "whatsapp");
    if (!rows.length) return;
    const r = rows[0];
    const p = r.payload as unknown as MessagePayload;
    if (!p?.conversation_id) return;
    const { error: dupe } = await admin!.from("messages").insert({
      org_id: r.org_id,
      conversation_id: p.conversation_id,
      sender_id: null,
      kind: "system",
      visibility: "internal",
      body: `Could not email ${p.recipient_name} after ${MAX_ATTEMPTS} attempts. They have not seen this conversation.`,
      meta: {
        event: "notification_gave_up",
        channel: r.channel,
        user_id: r.recipient_user_id,
        error: err ?? r.last_error ?? null,
        // messages_client_id_idx (0016) is unique on (conversation_id, client_id) and partial on
        // the column being set, so nothing here used it before. Naming the rows that died makes
        // it a second line of defence: the same give-up can only ever land once, however this is
        // called. A later, different failure names different rows and still gets its own note.
        client_id: `notification_gave_up:${rows
          .map((x) => x.id)
          .sort((a, b) => a - b)
          .join(",")}`,
      },
    });
    // 23505 is that index doing its job — the note is already there. Anything else is worth
    // saying, since an insert that fails here loses the only trace of a failed notification.
    if (dupe && dupe.code !== "23505") console.error("notifications: give-up note failed", dupe.message);
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

  // dead is reported separately from failed: "will be retried" and "given up on" are different
  // facts, and the run summary was the one place that conflated them.
  return NextResponse.json({ sent, failed, dead, duplicates, skipped, posted, deferred: waDeferred.length });
}
