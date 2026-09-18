"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Device } from "@twilio/voice-sdk";
import { Icon } from "@/components/ui/Icon";
import { createDevice, placeCall, type CallHandle, type CallPhase } from "@/lib/twilio/device";
import { formatDuration } from "@/lib/twilio/summary";

/**
 * The call, while it is happening.
 *
 * Docked above the Composer rather than thrown up as a modal: the point of calling from inside
 * the thread is being able to read the thread while you talk — the last message is usually the
 * reason for the call.
 */
export interface CallTarget {
  userId: string;
  name: string;
  /** Shown, not just dialled. See below. */
  phone: string;
  callId: string;
}

const control =
  "flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[14px] font-semibold text-ink hover:bg-hover";

const PHASE_TEXT: Record<CallPhase, string> = {
  connecting: "Connecting…",
  ringing: "Ringing…",
  live: "",
  ended: "Call ended",
  failed: "Call failed",
};

export function CallBar({ target, onClose }: { target: CallTarget; onClose: () => void }) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const device = useRef<Device | null>(null);
  const handle = useRef<CallHandle | null>(null);
  /**
   * The microphone tracks, held apart from the SDK.
   *
   * The same trap Composer.tsx fell into and paid for: the thing that releases the stream is
   * reached only through an object assigned *after* `await getUserMedia`, so unmounting while
   * the permission prompt is still up leaves cleanup with nothing to stop and the browser's
   * recording indicator lit for the rest of the session.
   */
  const mediaStream = useRef<MediaStream | null>(null);
  /** Set before the await, so a second render or a double press cannot open a second call. */
  const acquiring = useRef(false);

  const releaseMicrophone = useCallback(() => {
    mediaStream.current?.getTracks().forEach((t) => t.stop());
    mediaStream.current = null;
  }, []);

  const teardown = useCallback(() => {
    handle.current?.hangUp();
    handle.current = null;
    device.current?.destroy();
    device.current = null;
    releaseMicrophone();
  }, [releaseMicrophone]);

  useEffect(() => {
    if (acquiring.current) return;
    acquiring.current = true;
    let cancelled = false;

    void (async () => {
      try {
        // Asked for explicitly, before the SDK asks, so the permission prompt appears while the
        // bar is already on screen saying who is being called — rather than out of nowhere.
        mediaStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return releaseMicrophone();

        const d = await createDevice();
        if (cancelled) return d.destroy();
        device.current = d;

        handle.current = await placeCall(d, {
          callId: target.callId,
          onPhase: (next, why) => {
            if (cancelled) return;
            setPhase(next);
            if (why) setDetail(why);
          },
        });
      } catch (e) {
        if (cancelled) return;
        setPhase("failed");
        setDetail(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Stayful needs permission to use your microphone."
            : e instanceof Error
              ? e.message
              : "Something went wrong.",
        );
        releaseMicrophone();
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
    // Mount only. A CallBar is keyed on the call id by its parent, so a new call is a new
    // component rather than this one being asked to change who it is ringing mid-conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ticks once a second, and only while there is something to count. useNow is a minute's
  // resolution, which is the wrong unit for a call that is often over inside one.
  useEffect(() => {
    if (phase !== "live") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const over = phase === "ended" || phase === "failed";

  const toggleMute = () => {
    const next = !muted;
    handle.current?.mute(next);
    setMuted(next);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t border-line bg-panel px-3 py-2"
      role="status"
      aria-live="polite"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
        <Icon name="phone" size={18} />
      </span>

      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{target.name}</span>
        {/*
          The number, shown rather than merely dialled. Contractor numbers are set by
          set_customer_phone, which leaves phone_verified_at null — the team typed it, the contact
          never proved it. A transposed digit calls a stranger from a Stayful number they can ring
          back, and putting the digits where they are read is the cheap half of that fix.
        */}
        <span className="truncate text-[13px] text-muted tabular-nums">
          {target.phone}
          {phase === "live" ? ` · ${formatDuration(seconds)}` : PHASE_TEXT[phase] ? ` · ${PHASE_TEXT[phase]}` : ""}
        </span>
      </div>

      <div className="flex-1" />

      {!over && (
        <button type="button" onClick={toggleMute} className={control} aria-pressed={muted}>
          <Icon name="mic" size={16} />
          {muted ? "Unmute" : "Mute"}
        </button>
      )}

      <button
        type="button"
        onClick={() => {
          teardown();
          onClose();
        }}
        className={`${control} border-transparent bg-new text-white hover:opacity-90`}
      >
        <Icon name={over ? "close" : "phoneOff"} size={16} />
        {over ? "Close" : "Hang up"}
      </button>

      {detail && over && <span className="w-full text-[13px] text-muted">{detail}</span>}
    </div>
  );
}
