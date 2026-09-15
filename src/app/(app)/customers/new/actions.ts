"use server";

import { createClient } from "@/lib/supabase/server";
import { generatePassword } from "@/lib/email/password";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { siteUrl } from "@/lib/site";

export interface InviteResult {
  ok: boolean;
  error?: string;
  userId?: string;
  email?: string;
  password?: string;
  emailStatus?: "sent" | "failed" | "not_configured";
  emailError?: string;
}

/**
 * Creates a customer account (email + generated password), adds them to the chosen
 * groups, and emails the login details. Runs as the signed-in team member; the database
 * enforces that only team accounts can do this.
 */
export async function inviteCustomer(formData: FormData): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim() || fullName.split(" ")[0];
  const role = String(formData.get("role") ?? "owner") === "delegate" ? "delegate" : "owner";
  const groupIds = formData.getAll("group_ids").map(String).filter(Boolean);
  const createGroup = formData.get("create_group") === "on";

  if (!email || !fullName) return { ok: false, error: "Name and email are required." };

  const { data: me } = await supabase.from("profiles").select("display_name, org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  // Optionally create the customer's own group first (named like the Slack channels: first-last)
  if (createGroup) {
    const slug = fullName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const { data: conv, error } = await supabase
      .from("conversations")
      .insert({ org_id: me.org_id, type: "owner", name: slug, slug, is_private: true, created_by: user.id })
      .select("id")
      .single();
    if (error || !conv)
      return { ok: false, error: `Couldn't create the group "${slug}": ${error?.message ?? "unknown error"}` };
    const { error: memberError } = await supabase.from("conversation_members").insert({
      conversation_id: conv.id,
      user_id: user.id,
      org_id: me.org_id,
      last_read_at: new Date().toISOString(),
    });
    if (memberError) return { ok: false, error: `Couldn't join the new group: ${memberError.message}` };
    groupIds.push(conv.id);
  }

  const password = generatePassword();
  const { data: userId, error } = await supabase.rpc("create_customer_account", {
    p_email: email,
    p_full_name: fullName,
    p_display_name: displayName,
    p_password: password,
    p_conversation_ids: groupIds,
    p_role: role,
  });
  if (error || !userId) return { ok: false, error: error?.message ?? "The account could not be created." };

  const { data: groupRows } = groupIds.length
    ? await supabase.from("conversations").select("name").in("id", groupIds)
    : { data: [] as { name: string | null }[] };
  const groupNames = (groupRows ?? []).map((g) => g.name).filter((n): n is string => !!n);

  const loginUrl = `${siteUrl()}/login`;
  const mail = welcomeEmail({
    recipientName: displayName,
    email,
    password,
    loginUrl,
    invitedBy: me.display_name,
    groups: groupNames,
  });

  const { data: outboxId } = await supabase.rpc("queue_welcome_email", {
    p_user_id: userId,
    p_payload: {
      email,
      login_url: loginUrl,
      invited_by: me.display_name,
      groups: groupNames,
      recipient_name: displayName,
    },
  });

  const result: InviteResult = { ok: true, userId, email, password };
  if (!emailConfigured()) {
    result.emailStatus = "not_configured";
    if (outboxId)
      await supabase.rpc("mark_outbox", { p_id: outboxId, p_status: "skipped", p_error: "RESEND_API_KEY not set" });
    return result;
  }
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  result.emailStatus = sent.ok ? "sent" : "failed";
  result.emailError = sent.error;
  if (outboxId) {
    await supabase.rpc("mark_outbox", {
      p_id: outboxId,
      p_status: sent.ok ? "sent" : "failed",
      p_provider_message_id: sent.id ?? null,
      p_error: sent.error ?? null,
    });
  }
  return result;
}

export async function resendLoginDetails(userId: string): Promise<InviteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };
  const { data: me } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const { data: target } = await supabase.from("profiles").select("id, email, display_name").eq("id", userId).single();
  if (!me || !target?.email) return { ok: false, error: "Customer not found." };

  const password = generatePassword();
  const { error } = await supabase.rpc("reset_customer_password", { p_user_id: userId, p_password: password });
  if (error) return { ok: false, error: error.message };

  const loginUrl = `${siteUrl()}/login`;
  const mail = welcomeEmail({
    recipientName: target.display_name,
    email: target.email,
    password,
    loginUrl,
    invitedBy: me.display_name,
    groups: [],
  });
  const result: InviteResult = { ok: true, userId, email: target.email, password };
  if (!emailConfigured()) {
    result.emailStatus = "not_configured";
    return result;
  }
  const sent = await sendEmail({ to: target.email, subject: mail.subject, html: mail.html, text: mail.text });
  result.emailStatus = sent.ok ? "sent" : "failed";
  result.emailError = sent.error;
  return result;
}
