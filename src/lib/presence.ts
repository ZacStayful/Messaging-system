import type { Profile } from "@/lib/database.types";

export type PresenceStatus = "online" | "away" | "offline";
export type PresenceLook = { bg: string; ring: string };

/** Slack's rule: away after this long without input. */
export const AWAY_AFTER_MS = 10 * 60_000;

/** Visual rules from the design: online = solid green, away = sage ring, offline = grey ring. */
export function presenceLook(status: PresenceStatus): PresenceLook {
  if (status === "online") return { bg: "#2BAC76", ring: "none" };
  if (status === "away") return { bg: "transparent", ring: "inset 0 0 0 2px #CFD5B9" };
  return { bg: "transparent", ring: "inset 0 0 0 2px #9AA69A" };
}

export function presenceText(status: PresenceStatus): string {
  return status === "online" ? "Active" : "Away";
}

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  staff: "Stayful team",
  owner: "Owner",
  delegate: "Delegate",
  contractor: "Contractor",
  cleaner: "Cleaner",
};

type StatusFields = Pick<Profile, "status_text" | "status_emoji" | "status_expires_at">;

/** The custom status if it has not expired. */
export function activeStatus(p: StatusFields | null | undefined, now = Date.now()) {
  if (!p) return null;
  if (!p.status_text && !p.status_emoji) return null;
  if (p.status_expires_at && new Date(p.status_expires_at).getTime() <= now) return null;
  return { text: p.status_text ?? "", emoji: p.status_emoji ?? "" };
}

export function dndActive(p: Pick<Profile, "dnd_until"> | null | undefined, now = Date.now()): boolean {
  return !!p?.dnd_until && new Date(p.dnd_until).getTime() > now;
}

/** "3:42 PM local time" for a profile's timezone; empty when the zone is unknown. */
export function localTime(timezone: string | null | undefined, now = new Date()): string {
  if (!timezone) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(now);
  } catch {
    return "";
  }
}

/** The browser's IANA timezone. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  } catch {
    return "Europe/London";
  }
}
