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

export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  staff: "Stayful team",
  owner: "Owner",
  delegate: "Delegate",
  contractor: "Contractor",
  cleaner: "Cleaner",
};

// ---------------------------------------------------------------------------
// Expiry options, shared by custom status, do-not-disturb and away
// ---------------------------------------------------------------------------

export const CLEAR_OPTIONS = [
  { id: "never", label: "Don't clear" },
  { id: "30m", label: "30 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "4h", label: "4 hours" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
] as const;

export const DND_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "30m", label: "30 minutes" },
  { id: "1h", label: "1 hour" },
  { id: "2h", label: "2 hours" },
  { id: "tomorrow", label: "Until tomorrow" },
  { id: "week", label: "Until next week" },
] as const;

export type ClearId = (typeof CLEAR_OPTIONS)[number]["id"];
export type DndId = (typeof DND_OPTIONS)[number]["id"];

/**
 * Turns one of the option ids above into an expiry timestamp. "never" and "off" mean no
 * expiry at all. Lives here rather than in the status dialog because the away helpers below,
 * the `/away` and `/dnd` slash commands and the API's set_my_status all need it.
 */
export function untilFor(id: ClearId | DndId, now = new Date()): string | null {
  const d = new Date(now);
  switch (id) {
    case "never":
    case "off":
      return null;
    case "30m":
      return new Date(d.getTime() + 30 * 60_000).toISOString();
    case "1h":
      return new Date(d.getTime() + 60 * 60_000).toISOString();
    case "2h":
      return new Date(d.getTime() + 120 * 60_000).toISOString();
    case "4h":
      return new Date(d.getTime() + 240 * 60_000).toISOString();
    case "today":
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    case "tomorrow":
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    case "week": {
      const day = d.getDay(); // 0 = Sunday
      d.setDate(d.getDate() + ((8 - (day || 7)) % 7 || 7));
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
}

// ---------------------------------------------------------------------------
// Custom status, do-not-disturb, manual away
// ---------------------------------------------------------------------------

type StatusFields = Pick<Profile, "status_text" | "status_emoji" | "status_expires_at">;
/** Pick<> rather than Profile so these also work on the cron worker's partial select. */
type AwayFields = Pick<Profile, "presence_mode" | "away_until">;
type SilenceFields = AwayFields & Pick<Profile, "dnd_until">;

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

/**
 * True when the person deliberately set themselves away and it has not expired.
 * `away_until` null means away until they clear it by hand; expiry is evaluated here at read
 * time rather than by a cron, exactly like `dnd_until` and `status_expires_at`.
 */
export function manualAway(p: AwayFields | null | undefined, now = Date.now()): boolean {
  if (!p || p.presence_mode !== "away") return false;
  return !p.away_until || new Date(p.away_until).getTime() > now;
}

/**
 * "Send this person nothing." Away implies do-not-disturb, so one predicate covers both, and
 * it mirrors the WHERE clause in enqueue_message_notifications (0014_manual_away.sql).
 */
export function notificationsSilenced(p: SilenceFields | null | undefined, now = Date.now()): boolean {
  return manualAway(p, now) || dndActive(p, now);
}

/** The patch `/away`, `/away 1h` and `/away off` apply to the signed-in profile. */
export function parseAwayArg(
  args: string,
  now = new Date(),
): Pick<Profile, "presence_mode" | "away_since" | "away_until"> {
  const a = args.trim().toLowerCase();
  if (a === "off" || a === "back" || a === "clear") {
    return { presence_mode: "auto", away_since: null, away_until: null };
  }
  const known = [...CLEAR_OPTIONS, ...DND_OPTIONS].map((o) => o.id as string);
  const until = known.includes(a) ? untilFor(a as ClearId | DndId, now) : null;
  return { presence_mode: "away", away_since: now.toISOString(), away_until: until };
}

/**
 * The label under a name. Manual away reads "Away" whether or not the person is connected,
 * because they told us. A genuinely disconnected person now reads "Offline" — this used to
 * say "Away" for anyone whose tab was simply shut, which was never true.
 */
export function presenceText(status: PresenceStatus, p?: AwayFields | null): string {
  if (manualAway(p)) return "Away";
  if (status === "online") return "Active";
  if (status === "away") return "Away";
  return "Offline";
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
