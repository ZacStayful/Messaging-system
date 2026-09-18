import { withApiKey } from "@/lib/api/withApiKey";
import { ApiError, ok } from "@/lib/api/respond";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureEmail, loadCaptureDirectory, type CaptureDirection } from "@/lib/email/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/email/capture — the addresses a POST here would match: every lead-database customer's
 * email. An automation reading a mailbox uses this to ask Gmail only for mail to or from these
 * people, rather than posting everything and filling inbound_messages_unmatched with the rest.
 */
export const GET = withApiKey(
  async () => {
    const admin = createAdminClient();
    if (!admin) throw new ApiError("not_configured", "SUPABASE_SERVICE_ROLE_KEY is not set.");
    const directory = await loadCaptureDirectory(admin, null);
    const addresses: string[] = [];
    directory.leadsByEmail.forEach((_lead, email) => addresses.push(email));
    addresses.sort();
    return ok({ addresses });
  },
  { scopes: ["users:read"], team: true },
);

/** Enough for any email a person wrote; a newsletter's HTML is not worth storing. */
const MAX_BODY = 50_000;

interface CaptureBody {
  message_id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  direction?: CaptureDirection;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * POST /api/email/capture — an automation that reads a mailbox posts each email here, and the
 * ones to or from a lead-database customer land in their group.
 *
 * Needs a team key with `messages:write`. `direction` is what the mailbox knows (an item from
 * the Sent folder is outbound); left out, a From that belongs to a team member is outbound.
 * The key's own user is who an outbound message is attributed to when its From is not a team
 * member's address.
 */
export const POST = withApiKey(
  async ({ request, ctx }) => {
    const body = (await request.json().catch(() => null)) as CaptureBody | null;
    if (!body || typeof body.from !== "string" || !Array.isArray(body.to)) {
      throw new ApiError("invalid_request", "`from` and `to[]` are required.");
    }
    if (body.direction !== undefined && body.direction !== "inbound" && body.direction !== "outbound") {
      throw new ApiError("invalid_request", "`direction` must be inbound or outbound.");
    }
    const admin = createAdminClient();
    if (!admin) throw new ApiError("not_configured", "SUPABASE_SERVICE_ROLE_KEY is not set.");

    const result = await captureEmail(
      admin,
      {
        messageId: typeof body.message_id === "string" ? body.message_id : null,
        from: body.from,
        to: strings(body.to),
        cc: strings(body.cc),
        subject: typeof body.subject === "string" ? body.subject.slice(0, 500) : null,
        text: typeof body.text === "string" ? body.text.slice(0, MAX_BODY) : null,
        html: typeof body.html === "string" ? body.html.slice(0, MAX_BODY) : null,
        direction: body.direction ?? null,
      },
      { fallbackActorId: ctx.userId },
    );
    if (!result.ok) throw new ApiError("internal", result.error ?? "The email could not be stored.");
    return ok(result);
  },
  { scopes: ["messages:write"], team: true },
);
