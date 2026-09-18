import { withApiKey } from "@/lib/api/withApiKey";
import { ApiError, ok } from "@/lib/api/respond";
import { parseSentAt } from "@/lib/api/sentAt";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureWhatsAppMessage } from "@/lib/whatsapp/capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enough for anything a person typed; WhatsApp itself stops well short of this. */
const MAX_BODY = 50_000;

interface CaptureBody {
  message_uid?: string;
  chat_id?: string | number;
  phone?: string;
  direction?: string;
  text?: string;
  media_url?: string;
  sent_at?: string | number;
  sent_from?: string;
}

/**
 * POST /api/whatsapp/capture — an automation reading a chat's history out of TimelinesAI posts
 * each message here, and the ones with a lead-database customer land in their group, dated
 * `sent_at`, as them (inbound) or as the owner of the number it was sent from (outbound; the
 * key's own user when that number is not on file).
 *
 * Needs a team key with `messages:write`. The uid is the dedupe key, shared with the live
 * webhook, so history and live delivery of the same message are stored once.
 */
export const POST = withApiKey(
  async ({ request, ctx }) => {
    const body = (await request.json().catch(() => null)) as CaptureBody | null;
    if (!body || typeof body.message_uid !== "string" || typeof body.phone !== "string") {
      throw new ApiError("invalid_request", "`message_uid` and `phone` are required.");
    }
    if (body.direction !== "inbound" && body.direction !== "outbound") {
      throw new ApiError("invalid_request", "`direction` must be inbound or outbound.");
    }
    const sentAt = parseSentAt(body.sent_at);
    const admin = createAdminClient();
    if (!admin) throw new ApiError("not_configured", "SUPABASE_SERVICE_ROLE_KEY is not set.");

    const result = await captureWhatsAppMessage(
      admin,
      {
        messageUid: body.message_uid,
        chatId: body.chat_id === undefined || body.chat_id === null ? null : String(body.chat_id),
        phone: body.phone,
        direction: body.direction,
        text: typeof body.text === "string" ? body.text.slice(0, MAX_BODY) : null,
        mediaUrl: typeof body.media_url === "string" && body.media_url ? body.media_url.slice(0, 2000) : null,
        sentAt,
        sentFrom: typeof body.sent_from === "string" ? body.sent_from : null,
      },
      { fallbackActorId: ctx.userId },
    );
    if (!result.ok) throw new ApiError("internal", result.error ?? "The message could not be stored.");
    return ok(result);
  },
  { scopes: ["messages:write"], team: true },
);
