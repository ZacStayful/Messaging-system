"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/Icon";

type Mode = "password" | "link";
type Status = "idle" | "busy" | "sent" | "error";

function safeNext(next?: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dms";
}

const inputClass =
  "h-[46px] w-full rounded-lg border border-[#C9CEC4] bg-white px-3.5 text-[15px] font-normal text-[#1D1C1D] outline-none focus:border-[#5D8156] focus:shadow-[0_0_0_3px_rgba(93,129,86,0.2)]";
const primaryBtn =
  "h-12 rounded-lg bg-[#5D8156] text-[15px] font-semibold text-white hover:bg-[#4E6E49] disabled:opacity-60";
const secondaryBtn =
  "h-[46px] rounded-lg border border-[#C9CEC4] bg-white text-[14px] font-medium text-[#1D1C1D] hover:bg-[#F3F6F0]";

/**
 * Email + password is the primary sign-in (customers receive their password by email when the
 * team creates their account). The magic link doubles as "forgot password". Sessions are kept
 * in long-lived cookies, and the autocomplete hints let browsers remember the login.
 */
export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<Status>(initialError ? "error" : "idle");
  const [error, setError] = useState<string | null>(
    initialError ? "That sign-in link didn't work. Request a new one below." : null,
  );

  const redirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) return;
    setStatus("busy");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
    if (error) {
      setStatus("error");
      setError(
        /invalid login credentials/i.test(error.message)
          ? "That email and password don't match. Check them and try again, or email yourself a sign-in link."
          : error.message,
      );
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setStatus("busy");
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

  const switchMode = (m: Mode) => {
    setMode(m);
    setStatus("idle");
    setError(null);
  };

  return (
    <div className="flex w-full flex-col gap-3.5 rounded-[14px] bg-white p-7 shadow-[0_12px_40px_rgba(30,42,28,0.12)]">
      {status === "sent" ? (
        <div className="flex flex-col gap-3 text-[#1E2A1C]">
          <div className="text-[17px] font-bold">Check your email</div>
          <p className="text-[14px] text-[#3E5A3A]">
            We sent a sign-in link to <span className="font-semibold">{email.trim()}</span>. It expires in an hour.
          </p>
          <button type="button" onClick={() => switchMode("password")} className={secondaryBtn}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={mode === "password" ? signInWithPassword : sendLink} className="flex flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#1E2A1C]">
            Email address
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.co.uk"
              className={inputClass}
            />
          </label>

          {mode === "password" && (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#1E2A1C]">
              Password
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={`${inputClass} pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-[#616061] hover:bg-[#F3F6F0]"
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
                </button>
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13px] text-[#8A2E22]">
              {error}
            </p>
          )}

          <button type="submit" disabled={status === "busy"} className={`mt-1 ${primaryBtn}`}>
            {mode === "password"
              ? status === "busy"
                ? "Signing in…"
                : "Sign in"
              : status === "busy"
                ? "Sending link…"
                : "Email me a sign-in link"}
          </button>

          {mode === "password" ? (
            <button
              type="button"
              onClick={() => switchMode("link")}
              className="text-[13px] font-medium text-[#3E6E3A] hover:underline"
            >
              Forgotten your password? Email me a sign-in link
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("password")}
              className="text-[13px] font-medium text-[#3E6E3A] hover:underline"
            >
              Sign in with a password instead
            </button>
          )}

          <div className="flex items-center gap-2.5 text-[12px] text-[#7A7F76]">
            <div className="h-px flex-1 bg-[#E2E6DE]" />
            or
            <div className="h-px flex-1 bg-[#E2E6DE]" />
          </div>
          <button type="button" onClick={google} className={secondaryBtn}>
            Continue with Google
          </button>
        </form>
      )}
    </div>
  );
}
