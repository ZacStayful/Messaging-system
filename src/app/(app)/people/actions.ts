"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generatePassword } from "@/lib/email/password";
import { emailConfigured, sendEmail } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { siteUrl } from "@/lib/site";

export interface GrantAccessResult {
  ok: boolean;
  error?: string;
  /** Shown once when Resend is not configured, exactly as an invite does. */
  password?: string;
  emailed?: boolean;
}

/**
 * Lets an imported person in.
 *
 * Everyone the Slack import and the lead import put on file has an account that cannot sign in:
 * a password nobody knows and `banned_until` far in the future, so their history is here and they
 * are not. This is the one action that reverses that, one person at a time and deliberately — the
 * database does the lifting in `grant_portal_access` (0042), which is admin-gated and audited, and
 * this sends the login details afterwards the way `createAccountAndInvite` does.
 *
 * Runs as the signed-in admin, so the RPC's own gate is what decides whether they may.
 */
export async function grantPortalAccess(userId: string): Promise<GrantAccessResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { data: me } = await supabase.from("profiles").select("display_name").eq("id", user.id).single();
  const { data: target } = await supabase
    .from("profiles")
    .select("display_name, email, portal_access")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That person could not be found." };
  if (!target.email) return { ok: false, error: "That account has no email address to send login details to." };
  if (target.portal_access) return { ok: false, error: `${target.display_name} already has access.` };

  const password = generatePassword();
  const { error } = await supabase.rpc("grant_portal_access", { p_user_id: userId, p_password: password });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/people");

  const mail = welcomeEmail({
    recipientName: target.display_name,
    email: target.email,
    password,
    loginUrl: `${siteUrl()}/login`,
    invitedBy: me?.display_name ?? "The Stayful team",
    groups: [],
  });
  if (!emailConfigured()) return { ok: true, password, emailed: false };
  const sent = await sendEmail({ to: target.email, subject: mail.subject, html: mail.html, text: mail.text });
  // The account is open either way: a failed email is a message to re-send, not a reason to
  // pretend the grant did not happen.
  return sent.ok ? { ok: true, emailed: true } : { ok: true, password, emailed: false, error: sent.error };
}
