import { describe, expect, it } from "vitest";
import {
  dndActive,
  manualAway,
  notificationsSilenced,
  parseAwayArg,
  presenceText,
  untilFor,
  type ClearId,
  type DndId,
} from "@/lib/presence";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const now = NOW.getTime();
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();

/** Only the fields the helpers actually read, so these mirror the cron's partial select. */
const away = (presence_mode: string, away_until: string | null = null) => ({ presence_mode, away_until });

describe("manualAway", () => {
  it("is false for a profile in auto mode", () => {
    expect(manualAway(away("auto"), now)).toBe(false);
  });

  it("is true when away with no expiry (until cleared by hand)", () => {
    expect(manualAway(away("away", null), now)).toBe(true);
  });

  it("is true when the expiry is still in the future", () => {
    expect(manualAway(away("away", iso(60_000)), now)).toBe(true);
  });

  it("is false once the expiry has passed, without anything clearing the row", () => {
    expect(manualAway(away("away", iso(-60_000)), now)).toBe(false);
  });

  it("is false for a missing profile", () => {
    expect(manualAway(null, now)).toBe(false);
    expect(manualAway(undefined, now)).toBe(false);
  });
});

describe("notificationsSilenced", () => {
  const silenced = (presence_mode: string, away_until: string | null, dnd_until: string | null) =>
    notificationsSilenced({ presence_mode, away_until, dnd_until }, now);

  it("is true when away only", () => {
    expect(silenced("away", null, null)).toBe(true);
  });

  it("is true when do-not-disturb only", () => {
    expect(silenced("auto", null, iso(60_000))).toBe(true);
  });

  it("is true when both are set", () => {
    expect(silenced("away", null, iso(60_000))).toBe(true);
  });

  it("is false when neither is set", () => {
    expect(silenced("auto", null, null)).toBe(false);
  });

  it("is false when both have expired", () => {
    expect(silenced("away", iso(-1), iso(-1))).toBe(false);
  });
});

describe("presenceText", () => {
  it("reads Active for someone connected and not away", () => {
    expect(presenceText("online", away("auto"))).toBe("Active");
  });

  it("reads Away for the idle timer", () => {
    expect(presenceText("away", away("auto"))).toBe("Away");
  });

  it("reads Offline for someone untracked", () => {
    expect(presenceText("offline", away("auto"))).toBe("Offline");
  });

  it("reads Away for a manual away even when they are not connected at all", () => {
    expect(presenceText("offline", away("away"))).toBe("Away");
  });

  it("still works with no profile, for callers that only have a status", () => {
    expect(presenceText("online")).toBe("Active");
    expect(presenceText("offline")).toBe("Offline");
  });
});

describe("parseAwayArg", () => {
  it("clears away for off, back and clear", () => {
    for (const arg of ["off", "back", "clear", "OFF", " off "]) {
      expect(parseAwayArg(arg, NOW)).toEqual({ presence_mode: "auto", away_since: null, away_until: null });
    }
  });

  it("sets away with no expiry for a bare /away", () => {
    expect(parseAwayArg("", NOW)).toEqual({
      presence_mode: "away",
      away_since: NOW.toISOString(),
      away_until: null,
    });
  });

  it("sets away with an expiry for a known duration", () => {
    const r = parseAwayArg("1h", NOW);
    expect(r.presence_mode).toBe("away");
    expect(r.away_until).toBe(iso(60 * 60_000));
  });

  it("treats an unrecognised argument as away-until-cleared rather than failing", () => {
    expect(parseAwayArg("banana", NOW).away_until).toBeNull();
    expect(parseAwayArg("banana", NOW).presence_mode).toBe("away");
  });
});

describe("untilFor", () => {
  it("returns no expiry for never and off", () => {
    expect(untilFor("never", NOW)).toBeNull();
    expect(untilFor("off", NOW)).toBeNull();
  });

  it("adds the right offset for the fixed durations", () => {
    expect(untilFor("30m", NOW)).toBe(iso(30 * 60_000));
    expect(untilFor("1h", NOW)).toBe(iso(60 * 60_000));
    expect(untilFor("2h", NOW)).toBe(iso(120 * 60_000));
    expect(untilFor("4h", NOW)).toBe(iso(240 * 60_000));
  });

  it("returns a future timestamp for every option", () => {
    const ids: (ClearId | DndId)[] = ["30m", "1h", "2h", "4h", "today", "tomorrow", "week"];
    for (const id of ids) {
      const until = untilFor(id, NOW);
      expect(until, id).not.toBeNull();
      expect(new Date(until!).getTime(), id).toBeGreaterThan(now);
    }
  });
});

describe("dndActive is unchanged by the away work", () => {
  it("reads the expiry the same way manualAway does", () => {
    expect(dndActive({ dnd_until: iso(60_000) }, now)).toBe(true);
    expect(dndActive({ dnd_until: iso(-60_000) }, now)).toBe(false);
    expect(dndActive({ dnd_until: null }, now)).toBe(false);
  });
});
