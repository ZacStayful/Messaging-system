import type { PresenceLook } from "@/lib/presence";

interface PresenceDotProps {
  look: PresenceLook;
  size?: number;
  /** Colour of the ring separating the dot from the avatar (matches the surface behind it). */
  border?: string;
  className?: string;
}

export function PresenceDot({ look, size = 12, border = "var(--sb)", className = "" }: PresenceDotProps) {
  return (
    <span
      className={`absolute rounded-full ${className}`}
      style={{
        right: -3,
        bottom: -3,
        width: size,
        height: size,
        border: `2px solid ${border}`,
        background: look.bg,
        boxShadow: look.ring,
      }}
      aria-hidden="true"
    />
  );
}
