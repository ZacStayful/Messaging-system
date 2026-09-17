/**
 * Whether calling is switched on.
 *
 * Mirrors whatsappConfigured() in src/lib/whatsapp/timelines.ts: the UI asks before it draws a
 * Call button, so an unconfigured deployment shows no control rather than one that throws when
 * pressed. e0bcc91 removed a Huddle button for being exactly that.
 *
 * Six variables and all of them required. The auth token and the API key are not alternatives:
 * the auth token is the only thing that verifies a webhook came from Twilio, and an API key is
 * the only thing that can sign a browser access token.
 */
export function callsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_API_KEY_SID &&
    process.env.TWILIO_API_KEY_SECRET &&
    process.env.TWILIO_TWIML_APP_SID &&
    process.env.TWILIO_WEBHOOK_TOKEN
  );
}

/** "1" means compose everything and place no call. The TIMELINES_DRY_RUN idea, for voice. */
export function callsDryRun(): boolean {
  return process.env.TWILIO_DRY_RUN === "1";
}

/**
 * Which env var is missing, for an operator staring at a hidden button.
 * Never returns values — only names.
 */
export function missingCallEnv(): string[] {
  return [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_TWIML_APP_SID",
    "TWILIO_WEBHOOK_TOKEN",
  ].filter((name) => !process.env[name]);
}
