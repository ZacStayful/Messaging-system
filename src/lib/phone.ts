/**
 * UK mobile numbers, in one place.
 *
 * A number reaches the database from three directions — the first-login gate, the account
 * settings field, and the team's "set a customer's number" action — and inbound WhatsApp
 * resolves a number back to exactly one profile. If any of those disagreed about what
 * "07957 516879" means, a customer's replies would land nowhere.
 *
 * ACCEPT_RE is deliberately the same rule as the profiles_phone_uk_mobile_ck constraint, so a
 * value that passes here can never be rejected by Postgres and vice versa. Change one, change
 * both.
 */

/** E.164 UK mobile: +44 7 then nine more digits. Mirrors profiles_phone_uk_mobile_ck. */
export const ACCEPT_RE = /^\+447\d{9}$/;

export interface PhoneResult {
  ok: boolean;
  /** Present when ok: the number in E.164, e.g. "+447957516879". */
  e164?: string;
  /** Present when not ok: a sentence to show the person, not a code to branch on. */
  error?: string;
}

const NOT_A_MOBILE = "That is not a mobile number. We need a UK mobile starting 07.";

/**
 * Ranges inside 07 that are not mobiles: 070 is personal numbering (a forwarding service that
 * looks like a mobile and bills like a premium line) and 076 is paging — except 07624, which is
 * Isle of Man mobile and does receive WhatsApp.
 */
function isRealMobile(national: string): boolean {
  if (national.startsWith("70")) return false;
  if (national.startsWith("76")) return national.startsWith("7624");
  return true;
}

/** Everything people actually type: spaces, non-breaking spaces, brackets, dashes, dots. */
function strip(raw: string): string {
  return raw.replace(/[\s ()\-.‐-―]/g, "");
}

/**
 * Turns anything a person might type into a +447XXXXXXXXX, or explains why it cannot.
 *
 * Accepts 07957516879, 7957516879, 447957516879, +447957516879, 00447957516879 and
 * +44 (0)7957 516879, in any spacing.
 */
export function normaliseUkMobile(raw: string): PhoneResult {
  const cleaned = strip(raw ?? "");
  if (!cleaned) return { ok: false, error: "Enter your mobile number." };
  if (!/^\+?\d+$/.test(cleaned)) return { ok: false, error: "That does not look like a phone number." };

  // 00 is the old way of writing +, and some phones still store it that way.
  let rest = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;

  if (rest.startsWith("+")) {
    if (!rest.startsWith("+44")) return { ok: false, error: "We can only take UK mobile numbers at the moment." };
    rest = rest.slice(3);
  } else if (rest.startsWith("44") && rest.length > 10) {
    rest = rest.slice(2);
  }

  // "+44 (0)7957..." loses its brackets above and arrives here as "07957...". A national trunk
  // 0 is never part of the international number.
  if (rest.startsWith("0")) rest = rest.slice(1);

  if (!rest) return { ok: false, error: "Enter your mobile number." };

  if (/^[123]/.test(rest)) return { ok: false, error: "That looks like a landline. We need a UK mobile starting 07." };
  if (!rest.startsWith("7")) return { ok: false, error: NOT_A_MOBILE };
  if (rest.length < 10) return { ok: false, error: "That number is too short — a UK mobile has 11 digits." };
  if (rest.length > 10) return { ok: false, error: "That number is too long — a UK mobile has 11 digits." };
  if (!isRealMobile(rest)) return { ok: false, error: NOT_A_MOBILE };

  const e164 = `+44${rest}`;
  // Belt and braces: the branches above should make this unreachable, but this is the exact
  // rule the database enforces, and a mismatch here is a 500 at the point of saving.
  if (!ACCEPT_RE.test(e164)) return { ok: false, error: NOT_A_MOBILE };
  return { ok: true, e164 };
}

/** "+447957516879" -> "+44 7957 516879". Display only; never store the spaced form. */
export function formatUkMobile(e164: string): string {
  if (!ACCEPT_RE.test(e164)) return e164;
  return `+44 ${e164.slice(3, 7)} ${e164.slice(7)}`;
}

/** The fields `shouldAskForPhone` needs. A subset of Profile, so tests need no fixture. */
export interface PhoneGateProfile {
  account_type: string;
  phone: string | null;
  phone_prompt_skipped_at: string | null;
  deactivated_at: string | null;
}

/**
 * Whether to stand the first-login gate in front of this person.
 *
 * `whatsappReady` matters as much as the profile: the gate exists to collect a number we can
 * verify by sending a code over WhatsApp, so with no way to send there is nothing to ask for
 * and no reason to block anyone. It switches itself on the moment a token is configured.
 *
 * Customers only — the gate exists so Stayful can reach customers, and shutting staff out of
 * their own workspace is a support incident.
 */
export function shouldAskForPhone(p: PhoneGateProfile, whatsappReady: boolean): boolean {
  if (!whatsappReady) return false;
  return p.account_type === "customer" && !p.phone && !p.phone_prompt_skipped_at && !p.deactivated_at;
}
