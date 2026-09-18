/**
 * The lead database, and how it is filed.
 *
 * Customers who signed up to Stayful's lead resale service live on the Monday board "Stayful
 * Lead database enquiries" (18420649520), in one board group per product. In the messaging
 * system they sit under "Lead database customers", split the same way. This file is the one
 * place that mapping lives, and it is deliberately free of `process.env` so the sidebar can
 * import it without dragging server code into the client bundle.
 *
 * The keys are what `profiles.lead_category` stores; the CHECK constraint in 0034 lists the
 * same two values. Add one here, add it there.
 */

export const LEAD_CATEGORIES = {
  airbnb_management: { label: "Airbnb management leads", mondayGroupId: "group_mm5f9by1" },
  r2r: { label: "R2R leads", mondayGroupId: "group_mm64kqtg" },
} as const;

export type LeadCategory = keyof typeof LEAD_CATEGORIES;

export const LEAD_CATEGORY_KEYS = Object.keys(LEAD_CATEGORIES) as LeadCategory[];

export function isLeadCategory(value: unknown): value is LeadCategory {
  return typeof value === "string" && value in LEAD_CATEGORIES;
}

/** Which category a Monday board group feeds, or null for a group the import does not read. */
export function leadCategoryForGroup(groupId: string | null | undefined): LeadCategory | null {
  if (!groupId) return null;
  for (const key of LEAD_CATEGORY_KEYS) {
    if (LEAD_CATEGORIES[key].mondayGroupId === groupId) return key;
  }
  return null;
}

export function leadCategoryLabel(category: string | null | undefined): string | null {
  return isLeadCategory(category) ? LEAD_CATEGORIES[category].label : null;
}
