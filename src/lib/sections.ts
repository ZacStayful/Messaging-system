import type { SidebarSection } from "@/lib/database.types";

export interface SectionBucket<T> {
  section: SidebarSection;
  conversations: T[];
}

export interface SectionBuckets<T> {
  /** Starred conversations, which stay at the top whether or not they are filed in a section. */
  starred: T[];
  /** One bucket per section, in the order given. A section with nothing in it still appears. */
  filed: SectionBucket<T>[];
  /** Everything else, for the computed sections (Customers, Leads, Channels) to divide up. */
  rest: T[];
}

/**
 * Splits the sidebar's conversations into the person's own sections and what is left.
 *
 * Three rules, and the reasons for them:
 *
 *   * Starred wins. Starring means "keep this where I can see it", so a starred conversation stays
 *     at the top and does not also appear under its section — showing it twice makes the sidebar
 *     longer, which is the opposite of what filing it was for.
 *   * A filed conversation leaves the computed section it came from, for the same reason.
 *   * A conversation filed into a section that is no longer in the list falls back to `rest`
 *     rather than disappearing. That happens for a moment after deleting a section, and it would
 *     otherwise be a conversation with no way to reach it.
 */
export function partitionBySection<T extends { id: string; starred: boolean }>(
  conversations: readonly T[],
  sections: readonly SidebarSection[],
  sectionOf: (conversationId: string) => string | null,
): SectionBuckets<T> {
  const buckets = new Map<string, T[]>(sections.map((s) => [s.id, []]));
  const starred: T[] = [];
  const rest: T[] = [];

  for (const c of conversations) {
    if (c.starred) {
      starred.push(c);
      continue;
    }
    const bucket = buckets.get(sectionOf(c.id) ?? "");
    if (bucket) bucket.push(c);
    else rest.push(c);
  }

  return {
    starred,
    filed: sections.map((section) => ({ section, conversations: buckets.get(section.id) ?? [] })),
    rest,
  };
}
