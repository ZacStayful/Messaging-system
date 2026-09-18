import { Call, Device } from "@twilio/voice-sdk";

/**
 * The Voice SDK, kept behind one door.
 *
 * Components deal in "ring this person and tell me when it changes"; nothing above this file
 * imports @twilio/voice-sdk or knows that a Device has a lifecycle. That matters more than usual
 * here because the SDK holds a WebSocket and a microphone, and a React component that forgets to
 * destroy it leaves both open — which on a laptop means the tab keeps the mic light on.
 */

/** Everything a CallBar needs to draw itself, derived from the SDK's own events. */
export type CallPhase = "connecting" | "ringing" | "live" | "ended" | "failed";

export interface CallHandle {
  mute(on: boolean): void;
  isMuted(): boolean;
  hangUp(): void;
}

export interface PlaceCallOptions {
  /** The `calls` row start_call() created. The only parameter the TwiML route trusts from us. */
  callId: string;
  onPhase(phase: CallPhase, detail?: string): void;
}

/**
 * Twilio's nearest public edge to the UK.
 *
 * The public edges are sydney, sao-paulo, dublin, frankfurt, tokyo, singapore, ashburn, umatilla
 * and roaming. There is no public London edge — `london-ix` is a private Interconnect, not
 * something an ordinary account can select.
 *
 * The default, `roaming`, uses Global Low Latency routing and would usually land on Dublin for a
 * browser in Britain. "Usually" is the problem: a VPN or a bad geolocation silently anchors the
 * media in Ashburn instead, which is an extra 150ms each way and sounds like the other person
 * keeps interrupting. Pinning it costs nothing and makes a latency complaint something that can
 * be reasoned about rather than guessed at.
 */
const EDGE = "dublin";

/** Mints a short-lived access token. Separate so a token refresh reuses the same path. */
async function fetchToken(): Promise<string> {
  const res = await fetch("/api/twilio/token", { method: "POST" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Calling is unavailable.");
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

/**
 * Builds a Device, ready to dial.
 *
 * Not registered for incoming calls: the access token grants outgoing only, and a cleaner ringing
 * the Stayful number back is answered by voicemail TwiML rather than by whoever has a tab open.
 */
export async function createDevice(): Promise<Device> {
  const device = new Device(await fetchToken(), {
    edge: EDGE,
    // The SDK's default is ["pcmu", "opus"]. Opus first is audibly better on a laptop mic, which
    // is the only kind of microphone any of these calls will ever be made from.
    codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    // A half-finished conversation with a contractor is worth one "are you sure" dialog.
    closeProtection: "You are on a call. Leaving this page will end it.",
    logLevel: "error",
  });

  // Tokens last ten minutes and the SDK fires this ten seconds before expiry. A call already in
  // progress survives its token — the grant is checked when the call is placed — but the next
  // one would fail, so this keeps a long shift from having to reload the page.
  device.on("tokenWillExpire", () => {
    void fetchToken()
      .then((token) => device.updateToken(token))
      .catch(() => {
        // Nothing to do here but leave the old token in place. The next call attempt surfaces
        // the real error to the person pressing the button, where it can be acted on.
      });
  });

  return device;
}

/**
 * Places the call and reports what happens to it.
 *
 * Only `CallId` is sent. The number dialled and the caller ID shown live on the `calls` row and
 * are read there by the TwiML route, because a `To` chosen by the browser would be a way to
 * place a call anywhere in the world on Stayful's account.
 */
export async function placeCall(device: Device, opts: PlaceCallOptions): Promise<CallHandle> {
  opts.onPhase("connecting");
  const call = await device.connect({ params: { CallId: opts.callId } });

  call.on("ringing", () => opts.onPhase("ringing"));
  call.on("accept", () => opts.onPhase("live"));
  call.on("disconnect", () => opts.onPhase("ended"));
  call.on("cancel", () => opts.onPhase("ended"));
  call.on("reject", () => opts.onPhase("ended"));
  call.on("error", (e: { message?: string }) => opts.onPhase("failed", e?.message));

  return {
    mute: (on) => call.mute(on),
    isMuted: () => call.isMuted(),
    hangUp: () => call.disconnect(),
  };
}
