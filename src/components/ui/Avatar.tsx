import Image from "next/image";
import type { Profile } from "@/lib/database.types";

type AvatarProfile = Pick<Profile, "display_name" | "avatar_url" | "avatar_color"> | null | undefined;

interface AvatarProps {
  profile: AvatarProfile;
  size?: number;
  radius?: number;
  className?: string;
}

/** Initial-on-colour avatar; a photo when available; the Stayful logo for system messages (no profile). */
export function Avatar({ profile, size = 38, radius = 8, className = "" }: AvatarProps) {
  const style = { width: size, height: size, borderRadius: radius };
  if (!profile || profile.avatar_url) {
    return (
      <Image
        src={profile?.avatar_url ?? "/brand/stayful-logo.png"}
        alt=""
        width={size}
        height={size}
        className={`block shrink-0 object-cover ${className}`}
        style={style}
        unoptimized={!!profile?.avatar_url && !profile.avatar_url.startsWith("/")}
      />
    );
  }
  const initial = (profile.display_name?.trim()[0] ?? "?").toUpperCase();
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-bold text-white ${className}`}
      style={{ ...style, background: profile.avatar_color, fontSize: Math.round(size * 0.45) }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}
