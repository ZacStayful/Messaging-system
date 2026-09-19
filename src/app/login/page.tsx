import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { LoginForm } from "./LoginForm";
import { HashError } from "./HashError";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  // Name the host we are actually served from, never a hardcoded one. A sign-in page that
  // claims a domain it is not on is the defining shape of a spoofed login page, and Chrome's
  // phishing classifier weights that mismatch heavily — which is what preview deployments on
  // *.vercel.app were doing while this line read "chat.stayful.co.uk".
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0].trim() || requestHeaders.get("host") || "";
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-frame p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5">
        <Image
          src="/brand/stayful-logo.png"
          alt="Stayful"
          width={88}
          height={88}
          priority
          className="h-[88px] w-[88px] rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        />
        <div className="text-center">
          <h1 className="font-display text-[28px] leading-[1.2] font-bold text-ink">Sign in to Stayful</h1>
          {host && <div className="mt-1.5 text-muted">{host}</div>}
        </div>
        <HashError />
        <LoginForm next={next} initialError={error} />
        <p className="text-center text-[14px] text-muted">
          New to Stayful? Your onboarding contact will send you an invite link.
        </p>
      </div>
    </main>
  );
}
