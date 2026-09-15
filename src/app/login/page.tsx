import type { Metadata } from "next";
import Image from "next/image";
import { LoginForm } from "./LoginForm";
import { HashError } from "./HashError";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-sage p-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-5">
        <Image
          src="/brand/stayful-logo.png"
          alt="Stayful"
          width={88}
          height={88}
          priority
          className="h-[88px] w-[88px] rounded-full shadow-[0_8px_24px_rgba(30,42,28,0.15)]"
        />
        <div className="text-center">
          <h1 className="font-display text-[28px] leading-[1.2] font-bold text-[#1E2A1C]">Sign in to Stayful</h1>
          <div className="mt-1.5 text-[#3E5A3A]">chat.stayful.co.uk</div>
        </div>
        <HashError />
        <LoginForm next={next} initialError={error} />
        <p className="text-center text-[14px] text-[#3E5A3A]">
          New to Stayful? Your onboarding contact will send you an invite link.
        </p>
      </div>
    </main>
  );
}
