import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { generatePassword } from "@/lib/email/password";
import { sendEmail, emailConfigured } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { siteUrl } from "@/lib/site";

export type InviteRole = "owner" | "delegate" | "staff" | "admin";

export interface InviteInput {
  email: string;
  fullName: string;
  displayName?: string;
  role?: InviteRole;
  /** Groups to add a customer to. Ignored for team accounts, which join groups separately. */
  conversationIds?: string[];
}

export interface InviteOutcome {
  userId: string;
  email: string;
  /** Returned so the caller can show it once when email is not configured. Never logged. */
  password: string;
  emailStatus: "sent" | "failed" | "not_configured";
  emailError?: string;
  groups: string[];
}

const TEAM_ROLES: InviteRole[] = ["staff", "admin"];

/**
 * Creates an account, adds it to the chosen groups and emails the login details.
 *
 * Extracted from the "Invite a customer" / "Add a team member" server actions so the API and
 * MCP server create accounts by exactly the same route — the welcome email a person receives
 * should not depend on whether a human or an agent invited them. Runs as the caller, so the
 * database enforces who is allowed to do this.
 */
export async function createAccountAndInvite(
  supabase: SupabaseClient<Database>,
  actorId: string,
  input: InviteInput,
): Promise<InviteOutcome> {
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const displayName = (input.displayName ?? "").trim() || fullName.split(" ")[0];
  const role: InviteRole = input.role ?? "owner";
  const conversationIds = input.conversationIds ?? [];
  if (!email || !fullName) throw new Error("Name and email are required.");

  const { data: me } = await supabase.from("profiles").select("display_name").eq("id", actorId).single();

  const password = generatePassword();
  const isTeamAccount = TEAM_ROLES.includes(role);
  const { data: userId, error } = isTeamAccount
    ? await supabase.rpc("create_team_account", {
        p_email: email,
        p_full_name: fullName,
        p_display_name: displayName,
        p_password: password,
        p_role: role === "admin" ? "admin" : "staff",
      })
    : await supabase.rpc("create_customer_account", {
        p_email: email,
        p_full_name: fullName,
        p_display_name: displayName,
        p_password: password,
        p_conversation_ids: conversationIds,
        p_role: role === "delegate" ? "delegate" : "owner",
      });
  if (error || !userId) throw new Error(error?.message ?? "The account could not be created.");

  const { data: groupRows } = conversationIds.length
    ? await supabase.from("conversations").select("name").in("id", conversationIds)
    : { data: [] as { name: string | null }[] };
  const groups = (groupRows ?? []).map((g) => g.name).filter((n): n is string => !!n);

  const loginUrl = `${siteUrl()}/login`;
  const mail = welcomeEmail({
    recipientName: displayName,
    email,
    password,
    loginUrl,
    invitedBy: me?.display_name ?? "The Stayful team",
    groups,
  });

  if (!emailConfigured()) {
    return { userId, email, password, emailStatus: "not_configured", groups };
  }
  const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
  return {
    userId,
    email,
    password,
    emailStatus: sent.ok ? "sent" : "failed",
    emailError: sent.error,
    groups,
  };
}
