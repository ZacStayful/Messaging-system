"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/Icon";

type Mode = "password" | "link";
type Status = "idle" | "busy" | "sent" | "error";

function safeNext(next?: string) {
  // "/\\evil.com" is normalised to a same-host path by the URL parser, so this was never a
  // live open redirect, but rejecting the backslash forms outright costs nothing.
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dms";
}

const inputClass =
  "h-[46px] w-full rounded-lg border border-input-border bg-input px-3.5 text-[16px] font-normal text-ink outline-none focus:border-brand focus:shadow-[0_0_0_3px_rgba(93,129,86,0.35)]";
const primaryBtn = "h-12 rounded-lg bg-brand text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-60";
const secondaryBtn =
  "h-[46px] rounded-lg border border-input-border bg-input text-[15px] font-medium text-ink hover:bg-hover";

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
    <div className="flex w-full flex-col gap-3.5 rounded-[14px] border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
      {status === "sent" ? (
        <div className="flex flex-col gap-3 text-ink">
          <div className="text-[17px] font-bold">Check your email</div>
          <p className="text-[15px] text-muted">
            We sent a sign-in link to <span className="font-semibold">{email.trim()}</span>. It expires in an hour.
          </p>
          <button type="button" onClick={() => switchMode("password")} className={secondaryBtn}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={mode === "password" ? signInWithPassword : sendLink} className="flex flex-col gap-3.5">
          {/* Google first. The team signs in with Workspace accounts, and a password typed here
              is a password that can be reused from somewhere else — which is what sets off
              Chrome's "you entered your password into a deceptive site" warning. */}
          <button type="button" onClick={google} className={primaryBtn}>
            Continue with Google
          </button>
          <div className="flex items-center gap-2.5 text-[13px] text-muted">
            <div className="h-px flex-1 bg-line" />
            or
            <div className="h-px flex-1 bg-line" />
          </div>
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
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
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-ink">
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
                  className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-hover"
                >
                  <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
                </button>
              </span>
            </label>
          )}

          {error && (
            <p role="alert" className="alert-error">
              {error}
            </p>
          )}

          <button type="submit" disabled={status === "busy"} className={`mt-1 ${secondaryBtn}`}>
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
              className="text-[14px] font-medium text-link hover:underline"
            >
              Forgotten your password? Email me a sign-in link
            </button>
          ) : (
            <button
              type="button"
              onClick={() => switchMode("password")}
              className="text-[14px] font-medium text-link hover:underline"
            >
              Sign in with a password instead
            </button>
          )}
        </form>
      )}
    </div>
  );
}
