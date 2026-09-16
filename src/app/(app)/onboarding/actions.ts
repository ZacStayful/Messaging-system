"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normaliseUkMobile } from "@/lib/phone";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp/timelines";

export interface PhoneStepResult {
  ok: boolean;
  error?: string;
  /**
   * True when we could not deliver a code at all (no TimelinesAI token, or the send failed).
   * The caller offers "Skip for now" rather than dead-ending someone who cannot get past a
   * screen they did not ask for.
   */
  undeliverable?: boolean;
}

/**
 * Step one of the gate: check the number, mint a code, and WhatsApp it.
 *
 * The code is generated and hashed inside start_phone_verification and returned here only so
 * this function can send it. It never reaches the browser, and only its bcrypt hash is stored.
 * Sending over WhatsApp rather than SMS proves in one step that the number is real, belongs to
 * this person, and is reachable on the channel we are about to start using.
 */
export async function requestPhoneCode(rawPhone: string): Promise<PhoneStepResult> {
  const parsed = normaliseUkMobile(rawPhone);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  if (!whatsappConfigured()) {
    return { ok: false, undeliverable: true, error: "We can't send verification codes right now." };
  }

  const { data: code, error } = await supabase.rpc("start_phone_verification", { p_phone: parsed.e164! });
  if (error || !code) return { ok: false, error: error?.message ?? "We couldn't send a code. Try again." };

  const sent = await sendWhatsApp({
    to: parsed.e164!,
    text: `${code} is your Stayful verification code. It expires in 10 minutes.`,
    label: "Stayful verification",
  });
  if (!sent.ok) {
    return {
      ok: false,
      undeliverable: true,
      error: "We couldn't send a WhatsApp to that number. Check it, or skip for now.",
    };
  }
  return { ok: true };
}

/** Step two: confirm the code, which is the only thing that writes profiles.phone. */
export async function confirmPhoneCode(
  rawPhone: string,
  code: string,
  whatsappOn: boolean,
  emailOn: boolean,
): Promise<PhoneStepResult> {
  const parsed = normaliseUkMobile(rawPhone);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 6) return { ok: false, error: "Enter the six-digit code we sent you." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { error } = await supabase.rpc("confirm_phone_verification", { p_phone: parsed.e164!, p_code: digits });
  if (error) return { ok: false, error: error.message };

  // Their channel choices, made on the same screen so consent is explicit rather than assumed.
  await supabase
    .from("profiles")
    .update({
      whatsapp_notifications: whatsappOn ? "instant" : "off",
      email_notifications: emailOn ? "instant" : "off",
    })
    .eq("id", user.id);

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * The escape hatch. Only offered when we could not deliver a code, because a gate nobody can
 * pass is an outage: a wrong TimelinesAI token must not lock every customer out of the app.
 */
export async function skipPhonePrompt(): Promise<PhoneStepResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { error } = await supabase
    .from("profiles")
    .update({ phone_prompt_skipped_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
