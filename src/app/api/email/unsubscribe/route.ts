import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head>
<body style="margin:0;background:#CFD5B9;font-family:Poppins,Segoe UI,Helvetica,Arial,sans-serif;color:#1E2A1C;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px">
<div style="background:#fff;border-radius:14px;padding:28px;max-width:420px;box-shadow:0 12px 40px rgba(30,42,28,.12)"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#3E5A3A;font-size:14px;line-height:1.5">${body}</p></div>
</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** One-click unsubscribe from message emails (spec D8). Signed link, no login required. */
export async function GET(request: NextRequest) {
  const u = request.nextUrl.searchParams.get("u") ?? "";
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (!u || !verifyUnsubscribeToken(u, t)) {
    return page(
      "This link isn't valid",
      "It may have expired. You can change email notifications any time from You → Account in the Stayful app.",
      400,
    );
  }
  const admin = createAdminClient();
  if (!admin)
    return page(
      "Not available right now",
      "Please change email notifications from You → Account in the Stayful app.",
      503,
    );
  const { error } = await admin.from("profiles").update({ email_notifications: "off" }).eq("id", u);
  if (error)
    return page(
      "Something went wrong",
      "Please try again later or change email notifications from You → Account in the app.",
      500,
    );
  return page(
    "Email notifications are off",
    "We won't email you about new messages. Your account and messages are unchanged, and you can turn emails back on from You → Account in the Stayful app.",
  );
}

// RFC 8058 one-click unsubscribe (mail clients POST to the same URL)
export const POST = GET;
