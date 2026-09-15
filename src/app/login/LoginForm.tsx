"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dms";
}

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(initialError ? "error" : "idle");
  const [error, setError] = useState<string | null>(
    initialError ? "That sign-in link didn't work. Request a new one below." : null,
  );

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setStatus("sending");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: false },
    });
    if (error) {
      setStatus("error");
      setError(
        /signup|not allowed|not found/i.test(error.message)
          ? "We couldn't find an account for that email. Ask your Stayful contact for an invite."
          : error.message,
      );
      return;
    }
    setStatus("sent");
  }

  async function google() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo(), queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setStatus("error");
      setError(error.message);
    }
  }

  const inputClass =
    "h-[46px] rounded-lg border border-[#C9CEC4] bg-white px-3.5 text-[15px] font-normal text-[#1D1C1D] outline-none focus:border-[#5D8156] focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-[14px] bg-white p-7 shadow-[0_12px_40px_rgba(30,42,28,0.12)]">
      {status === "sent" ? (
        <div className="flex flex-col gap-3 text-[#1E2A1C]">
          <div className="text-[17px] font-bold">Check your email</div>
          <p className="text-[14px] text-[#3E5A3A]">
            We sent a sign-in link to <span className="font-semibold">{email.trim()}</span>. It expires in an hour.
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="h-[44px] rounded-lg border border-[#C9CEC4] bg-white text-[14px] font-medium text-[#1D1C1D] hover:bg-[#F3F6F0]"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={sendLink} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#1E2A1C]">
            Email address
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.co.uk"
              className={inputClass}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13px] text-[#8A2E22]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={status === "sending"}
            className="mt-1 h-12 rounded-lg bg-[#5D8156] text-[15px] font-semibold text-white hover:bg-[#4E6E49] disabled:opacity-60"
          >
            {status === "sending" ? "Sending link…" : "Send me a sign-in link"}
          </button>
          <div className="flex items-center gap-2.5 text-[12px] text-[#7A7F76]">
            <div className="h-px flex-1 bg-[#E2E6DE]" />
            or
            <div className="h-px flex-1 bg-[#E2E6DE]" />
          </div>
          <button
            type="button"
            onClick={google}
            className="h-[46px] rounded-lg border border-[#C9CEC4] bg-white text-[14px] font-medium text-[#1D1C1D] hover:bg-[#F3F6F0]"
          >
            Continue with Google
          </button>
        </form>
      )}
    </div>
  );
}
