import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function siteOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && process.env.NODE_ENV === "production") return configured.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return forwardedHost ? `${proto}://${forwardedHost}` : new URL(request.url).origin;
}

/** Completes a magic-link or OAuth sign-in and lands the user in the app. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = siteOrigin(request);
  const rawNext = searchParams.get("next") ?? "/dms";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dms";

  const supabase = await createClient();

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
