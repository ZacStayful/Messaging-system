import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { htmlToText, stripQuotedReply, tokenFromRecipients, verifySvixSignature } from "@/lib/email/inbound";

export const dynamic = "force-dynamic";

interface ReceivedEvent {
  type: string;
  data: {
    email_id?: string;
    id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
    message_id?: string;
  };
}

/** Fetches the full inbound email from Resend when the webhook only carries metadata. */
async function fetchReceivedEmail(
  emailId: string,
): Promise<{ text?: string; html?: string; from?: string; to?: string[]; subject?: string } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  for (const path of [`/emails/receiving/${emailId}`, `/emails/${emailId}`]) {
    const res = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (res.ok)
      return (await res.json()) as { text?: string; html?: string; from?: string; to?: string[]; subject?: string };
  }
  return null;
}

/**
 * Resend "email.received" webhook. A customer replying to a notification email lands here;
 * the reply token in the To address identifies who they are and which conversation it belongs to.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not set" }, { status: 503 });
  const raw = await request.text();
  const ok = verifySvixSignature(
    raw,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
    },
    secret,
  );
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let event: ReceivedEvent;
  try {
    event = JSON.parse(raw) as ReceivedEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (event.type !== "email.received") return NextResponse.json({ ignored: event.type });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });

  const emailId = event.data.email_id ?? event.data.id;
  if (!emailId) return NextResponse.json({ error: "missing email id" }, { status: 400 });

  let { to, from, text, html, subject } = event.data;
  if (!text && !html) {
    const full = await fetchReceivedEmail(emailId);
    if (full) ({ to = to, from = from, text, html, subject = subject } = { ...event.data, ...full });
  }

  const token = tokenFromRecipients(to ?? []);
  if (!token) return NextResponse.json({ ignored: "no reply token" });

  const { data: thread } = await admin.from("email_reply_threads").select("*").eq("token", token).maybeSingle();
  if (!thread) return NextResponse.json({ ignored: "unknown token" });

  // The sender must still be a member; a forwarded email from someone else is dropped.
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("id, email, deactivated_at").eq("id", thread.user_id).maybeSingle(),
    admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", thread.conversation_id)
      .eq("user_id", thread.user_id)
      .maybeSingle(),
  ]);
  if (!profile || profile.deactivated_at || !membership) return NextResponse.json({ ignored: "not a member" });
  const fromAddr = (from?.match(/<([^>]+)>/)?.[1] ?? from ?? "").trim().toLowerCase();
  if (profile.email && fromAddr && fromAddr !== profile.email.toLowerCase()) {
    return NextResponse.json({ ignored: "sender does not match account email" });
  }

  const body = stripQuotedReply(text?.trim() ? text : htmlToText(html ?? ""));
  if (!body) return NextResponse.json({ ignored: "empty reply" });

  const { error } = await admin.from("messages").insert({
    org_id: thread.org_id,
    conversation_id: thread.conversation_id,
    sender_id: thread.user_id,
    body,
    kind: "text",
    visibility: "public",
    sent_via: "email",
    external_ref: emailId,
    meta: { email_subject: subject ?? null, email_from: fromAddr || null },
  });
  if (error) {
    // Duplicate delivery of the same email: already stored
    if (error.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await admin.from("email_reply_threads").update({ last_used_at: new Date().toISOString() }).eq("token", token);
  return NextResponse.json({ ok: true });
}
