import type { Profile } from "@/lib/database.types";

/** The subset of a profile the decision actually looks at. */
export interface CallCandidate {
  id: string;
  phone: string | null;
  deactivated_at?: string | null;
}

/**
 * Who can be rung from a thread.
 *
 * Membership, not `property_contacts`. A cleaner is a member of the property group, a customer is
 * a member of their own group, and both are people the team has reason to ring — while a rule
 * written against `property_contacts` would refuse to call anyone in a DM or a channel, which is
 * most of the app.
 *
 * Kept pure and here rather than inline in ConversationView because it decides whether a button
 * that dials a real telephone appears, and the cases that matter (nobody callable, myself,
 * someone with no number, a deactivated account) are all ones nobody would think to click
 * through by hand.
 */
export function callablePeople<T extends CallCandidate>(
  members: T[],
  meId: string,
  opts: { configured: boolean; isTeam: boolean },
): T[] {
  // Calling off, or a customer looking: no button at all. start_call refuses a customer anyway,
  // but a control they can see and not use is a support question waiting to happen — and one a
  // Huddle button already taught this codebase once (e0bcc91).
  if (!opts.configured || !opts.isTeam) return [];
  return members.filter((p) => p.id !== meId && !!p.phone && !p.deactivated_at);
}

/** Convenience for the component, which holds whole Profile rows. */
export function callableProfiles(members: Profile[], meId: string, configured: boolean, isTeam: boolean): Profile[] {
  return callablePeople(members, meId, { configured, isTeam });
}
