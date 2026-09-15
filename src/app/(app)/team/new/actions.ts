"use server";

import { createClient } from "@/lib/supabase/server";
import { generatePassword } from "@/lib/email/password";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { siteUrl } from "@/lib/site";
import type { InviteResult } from "@/app/(app)/customers/new/actions";

/** Admins add a Stayful team member (staff or admin) with a generated password. */
export async function inviteTeamMember(formData: FormData): Promise<InviteResult> {
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
  const role = String(formData.get("role") ?? "staff") === "admin" ? "admin" : "staff";
  if (!email || !fullName) return { ok: false, error: "Name and email are required." };

  const { data: me } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const password = generatePassword();
  const { data: userId, error } = await supabase.rpc("create_team_account", {
    p_email: email,
    p_full_name: fullName,
    p_display_name: displayName,
    p_password: password,
    p_role: role,
  });
  if (error || !userId) return { ok: false, error: error?.message ?? "The account could not be created." };

  const mail = welcomeEmail({
    recipientName: displayName,
    email,
    password,
    loginUrl: `${siteUrl()}/login`,
    invitedBy: me?.display_name ?? "The Stayful team",
    groups: [],
  });
  const result: InviteResult = { ok: true, userId, email, password };
  if (!emailConfigured()) {
    result.emailStatus = "not_configured";
    return result;
  }
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  result.emailStatus = sent.ok ? "sent" : "failed";
  result.emailError = sent.error;
  return result;
}
