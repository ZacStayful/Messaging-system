import { createHmac } from "node:crypto";

/**
 * The short-lived token the browser holds to place a call.
 *
 * Hand-rolled for the same reason src/lib/api/jwt.ts is: it is an HMAC over two base64url
 * segments, and pulling in a server SDK to produce one would be a large dependency for a
 * small, stable format.
 *
 * Three details the Voice SDK will reject a token for, none of them obvious:
 *
 *   - `cty: "twilio-fpa;v=1"` in the *header*. Without it the token parses as an ordinary JWT
 *     and the SDK refuses it.
 *   - Signed with the **API key secret**, and `iss` is the API key SID. The auth token cannot
 *     sign one of these; it is only good for verifying webhooks.
 *   - `sub` is the account SID, not the user. The user goes in `grants.identity`.
 *
 * Minted per call and short-lived, so there is nothing cached to leak and a captured token is
 * worthless by the time anyone reads the log it was in.
 */

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export class TwilioNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Twilio is not configured: ${missing.join(", ")}`);
    this.name = "TwilioNotConfiguredError";
  }
}

export interface AccessTokenInput {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  /** Who the browser is. We use the profile id, so a call can be attributed to a person. */
  identity: string;
  ttlSeconds?: number;
}

/**
 * An hour is Twilio's own default and the SDK refreshes on its own, but a call that outlives
 * the token it started with keeps running — the grant is checked when the call is placed.
 */
export function voiceAccessToken(input: AccessTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 3600;

  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${input.apiKeySid}-${now}`,
    iss: input.apiKeySid,
    sub: input.accountSid,
    nbf: now,
    exp: now + ttl,
    grants: {
      identity: input.identity,
      voice: {
        // Outgoing only. Inbound calls to the Stayful number are answered by TwiML that takes a
        // voicemail, not routed to whoever happens to have a browser tab open.
        outgoing: { application_sid: input.twimlAppSid },
      },
    },
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = b64url(createHmac("sha256", input.apiKeySecret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

/** Reads the environment, or says exactly which variable is missing. Never returns a value. */
export function accessTokenInputFromEnv(identity: string): AccessTokenInput {
  const env = {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    apiKeySid: process.env.TWILIO_API_KEY_SID,
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET,
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => `TWILIO_${k.replace(/([A-Z])/g, "_$1").toUpperCase()}`);
  if (missing.length) throw new TwilioNotConfiguredError(missing);
  return { ...(env as { [K in keyof typeof env]: string }), identity };
}
