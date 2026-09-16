import { describe, expect, it } from "vitest";
import { chooseRoute, type ContactRegistration, type RecentThread, type RouteInput } from "@/lib/whatsapp/routing";

const cleaning = (conversationId: string, archived = false): ContactRegistration => ({
  conversationId,
  kind: "cleaning",
  rootMessageId: `${conversationId}-cleaning-anchor`,
  archived,
});
const maintenance = (conversationId: string): ContactRegistration => ({
  conversationId,
  kind: "maintenance",
  rootMessageId: `${conversationId}-maintenance-anchor`,
  archived: false,
});
const sentFrom = (conversationId: string, at: string, parentMessageId: string | null = null): RecentThread => ({
  conversationId,
  parentMessageId,
  lastOutboundAt: at,
});
const input = (over: Partial<RouteInput> = {}): RouteInput => ({
  contacts: [],
  recentThreads: [],
  ownerGroupId: null,
  maintenanceChannelId: null,
  ...over,
});

describe("chooseRoute", () => {
  describe("a customer", () => {
    it("goes to the group we last messaged them from", () => {
      expect(
        chooseRoute(input({ recentThreads: [sentFrom("group-1", "2026-09-01T10:00:00Z")], ownerGroupId: "group-1" })),
      ).toEqual({ kind: "route", conversationId: "group-1", parentMessageId: null, via: "recent_customer" });
    });

    it("falls back to their customer group when we have never messaged them", () => {
      expect(chooseRoute(input({ ownerGroupId: "group-1" }))).toEqual({
        kind: "route",
        conversationId: "group-1",
        parentMessageId: null,
        via: "customer_group",
      });
    });

    it("is parked when they are in no group at all", () => {
      expect(chooseRoute(input())).toEqual({ kind: "unmatched", reason: "no_group" });
    });
  });

  describe("a cleaner", () => {
    it("on one property goes straight to its Cleaning thread", () => {
      expect(chooseRoute(input({ contacts: [cleaning("prop-a")] }))).toEqual({
        kind: "route",
        conversationId: "prop-a",
        parentMessageId: "prop-a-cleaning-anchor",
        via: "single_cleaning",
      });
    });

    it("on several goes to whichever we messaged most recently", () => {
      expect(
        chooseRoute(
          input({
            contacts: [cleaning("prop-a"), cleaning("prop-b")],
            recentThreads: [
              sentFrom("prop-a", "2026-09-01T10:00:00Z", "prop-a-cleaning-anchor"),
              sentFrom("prop-b", "2026-09-05T10:00:00Z", "prop-b-cleaning-anchor"),
            ],
          }),
        ),
      ).toEqual({
        kind: "route",
        conversationId: "prop-b",
        parentMessageId: "prop-b-cleaning-anchor",
        via: "recent_cleaning",
      });
    });

    it("ignores recent threads for properties they are not registered on", () => {
      // They might be a customer as well as a cleaner; their own group is not where a cleaning
      // message about someone else's property belongs.
      expect(
        chooseRoute(
          input({
            contacts: [cleaning("prop-a"), cleaning("prop-b")],
            recentThreads: [sentFrom("their-own-group", "2026-09-09T10:00:00Z")],
          }),
        ),
      ).toEqual({ kind: "unmatched", reason: "ambiguous_cleaner" });
    });

    it("is parked rather than guessed when we have never messaged any of them", () => {
      expect(chooseRoute(input({ contacts: [cleaning("prop-a"), cleaning("prop-b")] }))).toEqual({
        kind: "unmatched",
        reason: "ambiguous_cleaner",
      });
    });

    it("falls back to the Cleaning anchor when the recent row has no thread", () => {
      expect(
        chooseRoute(
          input({
            contacts: [cleaning("prop-a"), cleaning("prop-b")],
            recentThreads: [sentFrom("prop-a", "2026-09-01T10:00:00Z", null)],
          }),
        ),
      ).toMatchObject({ conversationId: "prop-a", parentMessageId: "prop-a-cleaning-anchor" });
    });

    it("whose only property is archived falls through to the customer path", () => {
      expect(chooseRoute(input({ contacts: [cleaning("prop-a", true)], ownerGroupId: "group-1" }))).toMatchObject({
        conversationId: "group-1",
        via: "customer_group",
      });
    });
  });

  describe("a maintenance contractor", () => {
    it("goes to the central inbox, not a property", () => {
      // Deliberate, and the reason the filing action exists: a contractor juggles several jobs
      // at once, so "who did we last message" is not evidence enough to file one.
      expect(chooseRoute(input({ contacts: [maintenance("prop-a")], maintenanceChannelId: "maintenance" }))).toEqual({
        kind: "route",
        conversationId: "maintenance",
        parentMessageId: null,
        via: "maintenance_inbox",
      });
    });

    it("is parked when the inbox cannot be resolved", () => {
      expect(chooseRoute(input({ contacts: [maintenance("prop-a")] }))).toEqual({
        kind: "unmatched",
        reason: "no_maintenance_channel",
      });
    });

    it("who also cleans one property is treated as the cleaner", () => {
      // Cleaning is per-property and unambiguous here; maintenance is the catch-all.
      expect(
        chooseRoute(
          input({
            contacts: [cleaning("prop-a"), maintenance("prop-b")],
            maintenanceChannelId: "maintenance",
          }),
        ),
      ).toMatchObject({ conversationId: "prop-a", via: "single_cleaning" });
    });
  });
});
