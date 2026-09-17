/**
 * Where an inbound WhatsApp belongs.
 *
 * Until now this was one line: a number identified a person, 0018 guaranteed that person was in
 * exactly one customer group, and the message went there. Cleaners and contractors break that
 * assumption — one number, many properties — so the decision is now big enough to be worth
 * separating from the fetching, and worth testing exhaustively without a database.
 *
 * This function is pure. Everything it needs has already been read; everything it returns is a
 * decision, not a write.
 */

export type ContactKind = "cleaning" | "maintenance";

/** A property strand this person is registered on (`property_contacts` + `property_threads`). */
export interface ContactRegistration {
  conversationId: string;
  kind: ContactKind;
  /** The thread anchor replies are filed under. */
  rootMessageId: string;
  archived: boolean;
}

/** A row of `whatsapp_threads`: somewhere we have messaged this person from. */
export interface RecentThread {
  conversationId: string;
  parentMessageId: string | null;
  lastOutboundAt: string | null;
}

export interface RouteInput {
  contacts: ContactRegistration[];
  recentThreads: RecentThread[];
  /** Their customer group, if they are a customer. */
  ownerGroupId: string | null;
  /** The central maintenance channel, if it could be resolved. */
  maintenanceChannelId: string | null;
}

export type RouteDecision =
  | {
      kind: "route";
      conversationId: string;
      parentMessageId: string | null;
      /** Why, so the reason can be recorded and argued with later. */
      via: "single_cleaning" | "recent_cleaning" | "maintenance_inbox" | "recent_customer" | "customer_group";
    }
  | { kind: "unmatched"; reason: string };

const newestFirst = (a: RecentThread, b: RecentThread) =>
  (b.lastOutboundAt ?? "").localeCompare(a.lastOutboundAt ?? "");

/**
 * The decision, in the order the cases were agreed:
 *
 * 1. **A cleaner registered on exactly one property** → that property's Cleaning thread. The
 *    common case, and completely unambiguous.
 * 2. **A cleaner registered on several** → whichever Cleaning thread we last messaged them from.
 *    That is the honest answer: the conversation they are replying to is the one we started.
 * 3. **Neither**, because we have registered them on several and never messaged any → parked.
 *    Guessing here would file a real job against the wrong address, which is worse than a row in
 *    `inbound_messages_unmatched` for someone to look at.
 * 4. **A maintenance contact** → the central maintenance channel, top level, deliberately not
 *    per-property. A contractor juggles several jobs at once and "who did we last message" is
 *    not good enough evidence to file one; a team member moves it with `move_message` (0027).
 * 5. **Anyone else** → the customer path, unchanged: the thread we last used, else their one
 *    customer group.
 *
 * Archived groups are filtered out before any of this, so a cleaner whose only property was
 * archived falls through to the customer path rather than routing into a dead group.
 */
export function chooseRoute(input: RouteInput): RouteDecision {
  const live = input.contacts.filter((c) => !c.archived);
  const cleaning = live.filter((c) => c.kind === "cleaning");

  if (cleaning.length === 1) {
    return {
      kind: "route",
      conversationId: cleaning[0].conversationId,
      parentMessageId: cleaning[0].rootMessageId,
      via: "single_cleaning",
    };
  }

  if (cleaning.length > 1) {
    const ids = new Set(cleaning.map((c) => c.conversationId));
    const recent = input.recentThreads
      .filter((t) => ids.has(t.conversationId) && t.lastOutboundAt)
      .sort(newestFirst)[0];
    if (recent) {
      const registration = cleaning.find((c) => c.conversationId === recent.conversationId)!;
      return {
        kind: "route",
        conversationId: recent.conversationId,
        // Prefer the strand we actually last wrote in; fall back to the Cleaning anchor.
        parentMessageId: recent.parentMessageId ?? registration.rootMessageId,
        via: "recent_cleaning",
      };
    }
    return { kind: "unmatched", reason: "ambiguous_cleaner" };
  }

  if (live.some((c) => c.kind === "maintenance")) {
    if (!input.maintenanceChannelId) return { kind: "unmatched", reason: "no_maintenance_channel" };
    return {
      kind: "route",
      conversationId: input.maintenanceChannelId,
      parentMessageId: null,
      via: "maintenance_inbox",
    };
  }

  const recent = input.recentThreads.filter((t) => t.lastOutboundAt).sort(newestFirst)[0] ?? input.recentThreads[0];
  if (recent) {
    return {
      kind: "route",
      conversationId: recent.conversationId,
      parentMessageId: recent.parentMessageId,
      via: "recent_customer",
    };
  }
  if (input.ownerGroupId) {
    return { kind: "route", conversationId: input.ownerGroupId, parentMessageId: null, via: "customer_group" };
  }
  return { kind: "unmatched", reason: "no_group" };
}
