import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The origin the user is actually on (works for previews and production).
 *
 * This value is concatenated straight into the post-auth redirect, so the forwarded host is
 * only honoured when we recognise it. Vercel's proxy overwrites x-forwarded-host today, but
 * nothing in this code should depend on that — an unrecognised host falls back to the
 * configured site URL rather than carrying the auth outcome off-domain.
 *
 * TODO: once previews move to a stable host, replace the .vercel.app suffix with that host.
 */
function siteOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const fallback = configured || new URL(request.url).origin;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  if (!forwardedHost) return fallback;

  let configuredHost: string | null = null;
  try {
    configuredHost = configured ? new URL(configured).host : null;
  } catch {
    configuredHost = null;
  }

  const allowed =
    forwardedHost === configuredHost ||
    forwardedHost.endsWith(".vercel.app") ||
    forwardedHost === "localhost" ||
    forwardedHost.startsWith("localhost:");
  if (!allowed) return fallback;

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${forwardedHost}`;
}

/** Completes a magic-link or OAuth sign-in and lands the user in the app. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = siteOrigin(request);
  const rawNext = searchParams.get("next") ?? "/dms";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/dms";

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
