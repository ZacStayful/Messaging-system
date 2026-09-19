import type { NextConfig } from "next";

/**
 * Security headers. The app had none at all.
 *
 * The load-bearing one is frame-ancestors / X-Frame-Options: a framable sign-in form is how a
 * clean domain ends up embedded inside someone else's phishing page and gets blocklisted for
 * it. Nothing here frames itself (Google sign-in is a full-page redirect, Twilio Voice is
 * WebRTC), so DENY is safe.
 *
 * A full Content-Security-Policy is deliberately NOT enforced yet. This app talks to Supabase
 * REST and Realtime (wss://*.supabase.co), the Twilio Voice SDK and Resend, and ships Next.js
 * inline bootstrap scripts plus Tailwind v4 inline styles — an enforcing policy written blind
 * would break calls or realtime. Add `Content-Security-Policy-Report-Only` with the full
 * policy, collect violations from a real session (sign in, send a message, record a voice
 * note, place a call, open a link preview), then promote it to enforcing.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // camera and microphone stay on: the composer records voice notes and Twilio Voice needs
  // the mic. Only geolocation is switched off outright.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
