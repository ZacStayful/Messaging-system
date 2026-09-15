import type { Profile } from "@/lib/database.types";

export type PresenceLook = { bg: string; ring: string };

/** Visual rules from the design: online = solid green, away = sage ring, offline = grey ring. */
export function presenceLook(profile: Pick<Profile, "presence"> | null | undefined, online: boolean): PresenceLook {
  if (online || profile?.presence === "online") return { bg: "#2BAC76", ring: "none" };
  if (profile?.presence === "away") return { bg: "transparent", ring: "inset 0 0 0 2px #CFD5B9" };
  return { bg: "transparent", ring: "inset 0 0 0 2px #9AA69A" };
}

export function presenceText(profile: Pick<Profile, "presence"> | null | undefined, online: boolean): string {
  if (online || profile?.presence === "online") return "Active";
  return "Away";
}
