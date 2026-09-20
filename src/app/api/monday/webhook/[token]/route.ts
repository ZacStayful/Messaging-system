import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookToken } from "@/lib/whatsapp/inbound";
import { isItemCreated, normaliseMondayEvent } from "@/lib/monday/webhook";
import { mondayConfigured } from "@/lib/monday/client";
import { isUnfinished, provisionClientItem, readIntegration, type Outcome } from "@/lib/monday/provision";

export const dynamic = "force-dynamic";
// Provisioning is several round trips — the Monday fetch, two groups, three messages — and
// Vercel cannot reliably finish work after the response, so it happens inline. Monday's own
// timeout is generous and a retry is a no-op thanks to monday_links.
export const maxDuration = 60;

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Every delivery is recorded, whether or not it did anything.
 *
 * A webhook that is switched off and logs nothing is indistinguishable from one that was never
 * configured, and "is Monday actually reaching us?" is the exact question this integration ships
 * switched off in order to answer.
 */
async function record(
  admin: Admin,
  event: { eventId: string | null; boardId: string | null; itemId: string | null; type: string | null },
  outcome: Outcome,
  payload: unknown,
  error?: string,
) {
  const { error: insertError } = await admin.from("monday_events").insert({
    event_id: event.eventId,
    board_id: event.boardId,
    item_id: event.itemId,
    event_type: event.type,
    payload: (payload ?? {}) as never,
    outcome,
    error: error ?? null,
  });
  // monday_events_event_idx: Monday redelivered one we have already handled. Not an error —
  // it is the dedupe working.
  if (insertError && insertError.code === "23505") return true;
  return false;
}

/**
 * Monday.com inbound webhook. Register it on the Clients board as
 * https://chat.stayful.co.uk/api/monday/webhook/<MONDAY_WEBHOOK_TOKEN>.
 *
 * A new Contact on that board becomes two groups here: one for the customer, opening with the
 * welcome message, and one for the property, carrying the Cleaning and Maintenance threads.
 *
 * Always answers 2xx once the token checks out, for the same reason the TimelinesAI webhook
 * does: a 4xx only makes the provider retry something that was never going to succeed, and the
 * monday_events row is a better record of the problem than a retry storm.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const expected = process.env.MONDAY_WEBHOOK_TOKEN;
  if (!expected) return NextResponse.json({ error: "MONDAY_WEBHOOK_TOKEN is not set" }, { status: 503 });

  const { token } = await params;
  if (!verifyWebhookToken(token, expected)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // Optional second factor, matching WHATSAPP_WEBHOOK_SECRET: set means required, so it can be
  // switched on without a deploy if the Monday recipe is ever able to send custom headers.
  const headerSecret = process.env.MONDAY_WEBHOOK_SECRET;
  if (headerSecret && !verifyWebhookToken(request.headers.get("x-stayful-token"), headerSecret)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = normaliseMondayEvent(raw);

  // The URL-verification handshake, sent once when the webhook is saved. It must be echoed
  // verbatim and it arrives before any authentication Monday could have been given, so it is
  // answered before anything else happens.
  if (event.kind === "challenge") return NextResponse.json({ challenge: event.challenge });
  if (event.kind === "unknown") return NextResponse.json({ ok: true, ignored: "unrecognised payload" });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  if (!isItemCreated(event)) {
    await record(admin, event, "skipped_event", raw);
    return NextResponse.json({ ok: true, ignored: `event ${event.type}` });
  }
  if (!event.itemId) {
    await record(admin, event, "error", raw, "the event carried no item id");
    return NextResponse.json({ ok: true, ignored: "no item id" });
  }

  const settings = await readIntegration(admin);
  if (!settings) {
    await record(admin, event, "not_configured", raw, "no integrations row for monday_clients");
    return NextResponse.json({ ok: true, ignored: "not configured" });
  }
  // Recorded before the work, so a delivery that then throws still leaves a trace — but as
  // 'received', which means "seen", not "done".
  //
  // It used to record 'created' here, and since the unique index on event_id makes a redelivery
  // stop at this line, a delivery killed between the record and provisionClientItem left a
  // customer who was never set up and a row that claimed they were, for ever: every retry read
  // its own half-finished marker as proof the work had been done. Carrying on is safe because
  // provisionClientItem is idempotent through monday_links, which is what the comment at the top
  // of this file has always promised; the retry simply never reached it.
  const duplicate = await record(admin, event, settings.enabled ? "received" : "skipped_disabled", raw);
  if (duplicate && !(await unfinished(admin, event.eventId))) {
    return NextResponse.json({ ok: true, duplicate: true, ref: event.eventId });
  }

  if (!settings.enabled) return NextResponse.json({ ok: true, skipped: "integration disabled" });
  if (!mondayConfigured()) {
    await admin
      .from("monday_events")
      .update({ outcome: "not_configured", error: "MONDAY_API_TOKEN is not set" })
      .eq("event_id", event.eventId ?? "");
    return NextResponse.json({ ok: true, ignored: "MONDAY_API_TOKEN is not set" });
  }

  let result;
  try {
    result = await provisionClientItem(admin, settings, event.itemId, event.boardId, event.groupId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await updateOutcome(admin, event.eventId, "error", message);
    return NextResponse.json({ ok: true, error: message });
  }

  await updateOutcome(admin, event.eventId, result.outcome, result.error);
  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    customer_conversation_id: result.customerConversationId ?? null,
    property_conversation_id: result.propertyConversationId ?? null,
  });
}

/**
 * Whether a redelivery is of something that never finished.
 *
 * True only for a row still sitting at 'received': the previous attempt was interrupted between
 * recording the delivery and reaching a terminal outcome, so this one should do the work rather
 * than report a duplicate. Every other outcome is final and a redelivery is genuinely a
 * duplicate. A delivery with no event id never dedupes in the first place.
 */
async function unfinished(admin: Admin, eventId: string | null): Promise<boolean> {
  if (!eventId) return false;
  const { data } = await admin.from("monday_events").select("outcome").eq("event_id", eventId).maybeSingle();
  return isUnfinished(data?.outcome);
}

/** The row was written optimistically before the work; this is what actually happened. */
async function updateOutcome(admin: Admin, eventId: string | null, outcome: Outcome, error?: string) {
  if (!eventId) return;
  await admin
    .from("monday_events")
    .update({ outcome, error: error ?? null })
    .eq("event_id", eventId);
}
