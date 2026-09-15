"use client";

import { useSyncExternalStore } from "react";

/**
 * Supabase reports link failures in the URL fragment, e.g.
 * #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired
 * which never reaches the server. Read it on the client and show a plain explanation.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return "";
  const p = new URLSearchParams(hash);
  const code = p.get("error_code") ?? p.get("error") ?? "";
  if (!code) return "";
  if (code === "otp_expired") {
    return "That sign-in link has already been used or has expired. Links work once and last an hour: request a new one below and open only the newest email.";
  }
  return p.get("error_description") ?? "That sign-in link didn't work. Request a new one below.";
}

export function HashError() {
  const message = useSyncExternalStore(subscribe, readHash, () => "");
  if (!message) return null;
  return (
    <p role="alert" className="alert-error w-full">
      {message}
    </p>
  );
}
