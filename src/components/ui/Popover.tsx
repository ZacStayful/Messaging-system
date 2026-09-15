"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface PopoverProps {
  onClose: () => void;
  children: ReactNode;
  /** Anchor side. Popovers open above their trigger by default (the composer sits at the bottom). */
  align?: "left" | "right";
  /** Open below the trigger instead of above. */
  below?: boolean;
  className?: string;
  label: string;
}

/** Small anchored panel that closes on Escape, outside click, or scroll of an ancestor list. */
export function Popover({ onClose, children, align = "left", below = false, className = "", label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    // Defer so the click that opened the popover doesn't close it.
    const id = window.setTimeout(() => {
      window.addEventListener("keydown", onKey);
      window.addEventListener("mousedown", onDown);
      window.addEventListener("touchstart", onDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`absolute z-30 rounded-xl border border-line bg-panel text-ink shadow-[0_12px_40px_rgba(0,0,0,.25)] ${below ? "top-full mt-2" : "bottom-full mb-2"} ${align === "right" ? "right-0" : "left-0"} ${className}`}
    >
      {children}
    </div>
  );
}
