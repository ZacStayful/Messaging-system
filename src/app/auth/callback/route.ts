import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** The origin the user is actually on (works for previews and production); NEXT_PUBLIC_SITE_URL is the fallback. */
function siteOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost.split(",")[0].trim()}`;
  }
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && process.env.NODE_ENV === "production") return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
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
