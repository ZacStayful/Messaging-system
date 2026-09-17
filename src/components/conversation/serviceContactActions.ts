"use server";

import { createClient } from "@/lib/supabase/server";
import { generatePassword } from "@/lib/email/password";
import { emailConfigured, sendEmail } from "@/lib/email/resend";
import { welcomeEmail } from "@/lib/email/templates";
import { normaliseUkMobile } from "@/lib/phone";
import { siteUrl } from "@/lib/site";

export interface ServiceContactResult {
  ok: boolean;
  error?: string;
  /** Shown to the team member when email is not configured, exactly as inviting a customer does. */
  password?: string;
  emailStatus?: "sent" | "failed" | "not_configured";
}

/**
 * Registers a cleaner or contractor against one strand of a property group.
 *
 * Three things have to be true for a service contact to work, and this is the only place that
 * does all three:
 *   1. they have an account, so their messages have an identity and a history
 *   2. their mobile is on that account, because inbound WhatsApp resolves a number to a person
 *   3. they are registered on the thread, which `add_property_contact` (0024) turns into a
 *      membership and a thread follow as well as a routing row
 *
 * Deliberately mirrors `customers/new/actions.ts` — same password generation, same welcome
 * email, same outbox bookkeeping — rather than inventing a second way to create an account.
 */
export async function addServiceContact(formData: FormData): Promise<ServiceContactResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const conversationId = String(formData.get("conversation_id") ?? "").trim();
  const kind = String(formData.get("kind") ?? "") === "maintenance" ? "maintenance" : "cleaning";
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const rawPhone = String(formData.get("phone") ?? "").trim();

  if (!conversationId) return { ok: false, error: "Which property?" };
  if (!fullName) return { ok: false, error: "Give the contact a name." };
  if (!email) return { ok: false, error: "An email address is needed to create their account." };

  // A number is optional — a contact can be registered before we have their mobile — but a bad
  // one is rejected here rather than by a constraint, because the rule is narrow and surprising:
  // profiles.phone accepts UK mobiles only (0018), and inbound routing depends on that.
  let phone: string | null = null;
  if (rawPhone) {
    const parsed = normaliseUkMobile(rawPhone);
    if (!parsed.ok || !parsed.e164) {
      return { ok: false, error: "That is not a UK mobile number, and WhatsApp routing needs one." };
    }
    phone = parsed.e164;
  }

  const { data: me } = await supabase.from("profiles").select("display_name, org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  // Someone who already has an account — a cleaner taking on a second property — is registered
  // rather than created. Creating would fail on the unique email anyway, and this is what the
  // team means by "add them to this one too".
  const { data: existing } = await supabase.from("profiles").select("id").ilike("email", email).maybeSingle();

  let userId = existing?.id ?? null;
  let password: string | undefined;
  let emailStatus: ServiceContactResult["emailStatus"];

  if (!userId) {
    password = generatePassword();
    const { data: created, error } = await supabase.rpc("create_customer_account", {
      p_email: email,
      p_full_name: fullName,
      p_display_name: fullName.split(/\s+/)[0] ?? fullName,
      p_password: password,
      p_conversation_ids: [],
      p_role: kind === "cleaning" ? "cleaner" : "contractor",
    });
    if (error || !created) return { ok: false, error: error?.message ?? "The account could not be created." };
    userId = created;
  }

  const { error: contactError } = await supabase.rpc("add_property_contact", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_kind: kind,
  });
  if (contactError) return { ok: false, error: contactError.message };

  if (phone) {
    // Set by the team, so phone_verified_at stays null: they typed it, the contact has not
    // proved it. Not fatal if it fails — the registration itself has already worked.
    const { error: phoneError } = await supabase.rpc("set_customer_phone", { p_user_id: userId, p_phone: phone });
    if (phoneError)
      return {
        ok: true,
        password,
        emailStatus,
        error: `Registered, but the number was rejected: ${phoneError.message}`,
      };
  }

  if (password) {
    const loginUrl = `${siteUrl()}/login`;
    const { data: group } = await supabase.from("conversations").select("name").eq("id", conversationId).maybeSingle();
    const mail = welcomeEmail({
      recipientName: fullName.split(/\s+/)[0] ?? fullName,
      email,
      password,
      loginUrl,
      invitedBy: me.display_name,
      groups: group?.name ? [group.name] : [],
    });
    const { data: outboxId } = await supabase.rpc("queue_welcome_email", {
      p_user_id: userId,
      p_payload: {
        email,
        login_url: loginUrl,
        invited_by: me.display_name,
        groups: group?.name ? [group.name] : [],
        recipient_name: fullName,
      },
    });
    if (!emailConfigured()) {
      emailStatus = "not_configured";
      if (outboxId)
        await supabase.rpc("mark_outbox", { p_id: outboxId, p_status: "skipped", p_error: "RESEND_API_KEY not set" });
    } else {
      const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
      emailStatus = sent.ok ? "sent" : "failed";
      if (outboxId) {
        await supabase.rpc("mark_outbox", {
          p_id: outboxId,
          p_status: sent.ok ? "sent" : "failed",
          p_provider_message_id: sent.id ?? null,
          p_error: sent.error ?? null,
        });
      }
    }
  }

  return { ok: true, password, emailStatus };
}

export async function removeServiceContact(
  conversationId: string,
  userId: string,
  kind: string,
): Promise<ServiceContactResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_property_contact", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_kind: kind,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
