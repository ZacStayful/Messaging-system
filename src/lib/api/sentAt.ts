import { ApiError } from "./respond";

/** How far ahead of the server clock a "sent at" may sit before it is treated as a mistake. */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * A caller-supplied send time for a message being backfilled. An ISO 8601 string or an epoch
 * (seconds or milliseconds, as Gmail's internalDate and TimelinesAI's timestamps arrive). Left
 * out means "now", which is what a live capture wants; anything unparsable or in the future is
 * an error, because a wrong created_at is far harder to notice later than a rejected request.
 */
export function parseSentAt(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  let date: Date | null = null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    date = new Date(raw > 1e12 ? raw : raw * 1000);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d{9,14}$/.test(trimmed)) {
      const n = Number(trimmed);
      date = new Date(n > 1e12 ? n : n * 1000);
    } else {
      date = new Date(trimmed);
    }
  }
  if (!date || Number.isNaN(date.getTime())) {
    throw new ApiError("invalid_request", "`sent_at` must be an ISO 8601 date or an epoch timestamp.");
  }
  if (date.getTime() > Date.now() + FUTURE_SLACK_MS) {
    throw new ApiError("invalid_request", "`sent_at` is in the future.");
  }
  return date.toISOString();
}
