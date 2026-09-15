/** Date/time formatting. Everything is rendered in Europe/London so server and client agree. */
const TZ = "Europe/London";

const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: TZ });
const dayMonthFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: TZ });
const dayMonthYearFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const longDateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const ymdFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "2026-09-15" in London time; used to group messages by day. */
export function dayKey(value: string | Date): string {
  return ymdFmt.format(toDate(value));
}

function daysBetween(a: Date, b: Date): number {
  const [ay, am, ad] = dayKey(a).split("-").map(Number);
  const [by, bm, bd] = dayKey(b).split("-").map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** "7:44 AM" (Slack-style, upper-case meridiem). */
export function timeLabel(value: string | Date): string {
  return timeFmt.format(toDate(value)).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
}

/** Divider label: Today, Yesterday, Thursday, 25 August, 20 Aug 2024. */
export function dayLabel(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const diff = daysBetween(now, d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return weekdayFmt.format(d);
  return d.getFullYear() === now.getFullYear() ? dayMonthFmt.format(d) : dayMonthYearFmt.format(d);
}

/** Compact timestamp for list rows: Just now, 7:44 AM, Yesterday, Thursday, 25 August. */
export function listTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const d = toDate(value);
  const ms = now.getTime() - d.getTime();
  if (ms < 60_000) return "Just now";
  const diff = daysBetween(now, d);
  if (diff === 0) return timeLabel(d);
  return dayLabel(d, now);
}

/** A time in the future for schedules and reminders: "today at 9:00", "tomorrow at 9:00", "Monday at 9:00", "25 August at 9:00". */
export function futureTime(value: string | Date, now: Date = new Date()): string {
  const d = toDate(value);
  const diff = -daysBetween(now, d); // days ahead
  const time = timeLabel(d);
  if (diff <= 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  if (diff < 7) return `${weekdayFmt.format(d)} at ${time}`;
  return `${(d.getFullYear() === now.getFullYear() ? dayMonthFmt : dayMonthYearFmt).format(d)} at ${time}`;
}

/** "20 Aug 2024 at 1:43 PM" for pins. */
export function pinWhen(value: string | Date): string {
  const d = toDate(value);
  return `${dayMonthYearFmt.format(d)} at ${timeLabel(d)}`;
}

/** "0:07" or "12:34" for audio durations. */
export function durationLabel(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "1.2 MB", "340 KB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** "2 September 2026" */
export function longDate(value: string | Date): string {
  return longDateFmt.format(toDate(value));
}

/** "You: text" style preview for list rows. */
export function previewOf(body: string | null | undefined, max = 160): string {
  if (!body) return "";
  const flat = body
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/@\[([^\]\n]+)\]/g, "@$1")
    .replace(/^- /gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
