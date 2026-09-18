/**
 * Reading the lead database board.
 *
 * "Stayful Lead database enquiries" (18420649520) is where people who sign up to the lead resale
 * service land. Two of its groups hold paying customers, and those are the only two this reads:
 * anything in New enquiries, Cancelled, Abandoned and the rest never reaches the importer.
 *
 * The column ids are the board's own and change only if someone rebuilds the board; they are
 * listed here in one place for the same reason CLIENT_COLUMNS is in client.ts.
 */

import { normaliseUkMobile } from "@/lib/phone";
import { LEAD_CATEGORIES, LEAD_CATEGORY_KEYS, leadCategoryForGroup, type LeadCategory } from "@/lib/leadCategories";
import { mondayQuery } from "./client";

/** The lead database board; overridable for a copy of it on a test account. */
export function leadsBoardId(): string {
  return process.env.MONDAY_LEADS_BOARD_ID?.trim() || "18420649520";
}

export const LEAD_COLUMNS = {
  /** Free text. Usually one address; one item has two, space-separated. */
  email: "text_mm50e3d7",
  /** Free text: "07828117537", "+44 7466 998011", whatever the form was given. */
  phoneText: "text_mm50hfvg",
  /** Monday's phone column: E.164 when set, but not set on every item. */
  phone: "phone_mm6c5qkc",
  website: "text_mm50y8an",
  properties: "text_mm50mt3h",
  plan: "text_mm50w01q",
  status: "color_mm5eda07",
  enquiredOn: "date_mm50brxt",
} as const;

export interface MondayLeadItem {
  id: string;
  name: string;
  groupId: string | null;
  /** Which of the two categories the item's board group feeds, or null if neither. */
  category: LeadCategory | null;
  emailRaw: string | null;
  phoneRaw: string | null;
  phoneTextRaw: string | null;
  website: string | null;
  properties: string | null;
  plan: string | null;
  status: string | null;
  enquiredOn: string | null;
}

type Unknown = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Unknown => (v && typeof v === "object" ? (v as Unknown) : {});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The address to create the account with.
 *
 * The column is free text, so it can hold two addresses, a trailing full stop, or capitals.
 * The first thing that looks like an address wins, lower-cased, because that is what the
 * account key is. A second address is not kept: profiles has one email column, and mail from
 * the other one will show up in the unmatched list where it can be dealt with by hand.
 */
export function parseLeadEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  for (const token of raw.split(/[\s,;]+/)) {
    const candidate = token
      .trim()
      .replace(/[.,;]+$/, "")
      .toLowerCase();
    if (EMAIL_RE.test(candidate)) return candidate;
  }
  return null;
}

export type LeadPhone = { ok: true; e164: string } | { ok: false; error: string } | null;

/**
 * The mobile number, in E.164, or why there is not one.
 *
 * Monday's phone column is preferred because it is already E.164, but it is empty on some
 * items whose free-text Phone column is not. Both are run through normaliseUkMobile, which is
 * the same rule the database enforces. Null means the item has no number at all, which is
 * different from a number we cannot use.
 */
export function pickLeadPhone(phoneColumn: string | null | undefined, phoneText: string | null | undefined): LeadPhone {
  const candidates = [phoneColumn, phoneText].filter((v): v is string => !!v && !!v.trim());
  if (!candidates.length) return null;
  let firstError: string | null = null;
  for (const raw of candidates) {
    const parsed = normaliseUkMobile(raw);
    if (parsed.ok && parsed.e164) return { ok: true, e164: parsed.e164 };
    firstError ??= parsed.error ?? "That is not a UK mobile number.";
  }
  return { ok: false, error: firstError ?? "That is not a UK mobile number." };
}

const MAX_TOPIC = 200;

/** What the group's topic line says: enough to place the person without opening Monday. */
export function leadTopic(item: MondayLeadItem): string {
  const parts: string[] = [];
  if (item.category) parts.push(LEAD_CATEGORIES[item.category].label.replace(/ leads$/, " lead"));
  if (item.properties) parts.push(/^\d+$/.test(item.properties) ? `${item.properties} properties` : item.properties);
  if (item.plan) parts.push(`Plan: ${item.plan}`);
  if (item.enquiredOn) parts.push(`Enquired ${item.enquiredOn.slice(0, 10)}`);
  if (item.website) parts.push(item.website);
  const topic = parts.join(" · ");
  return topic.length <= MAX_TOPIC ? topic : `${topic.slice(0, MAX_TOPIC - 1).trimEnd()}…`;
}

function parseItem(raw: Unknown): MondayLeadItem | null {
  const id = text(raw.id) ?? (typeof raw.id === "number" ? String(raw.id) : null);
  if (!id) return null;
  const columns = new Map<string, string | null>();
  for (const c of Array.isArray(raw.column_values) ? (raw.column_values as Unknown[]) : []) {
    columns.set(String(c.id), text(c.text));
  }
  const groupId = text(obj(raw.group).id);
  return {
    id,
    name: text(raw.name) ?? "",
    groupId,
    category: leadCategoryForGroup(groupId),
    emailRaw: columns.get(LEAD_COLUMNS.email) ?? null,
    phoneRaw: columns.get(LEAD_COLUMNS.phone) ?? null,
    phoneTextRaw: columns.get(LEAD_COLUMNS.phoneText) ?? null,
    website: columns.get(LEAD_COLUMNS.website) ?? null,
    properties: columns.get(LEAD_COLUMNS.properties) ?? null,
    plan: columns.get(LEAD_COLUMNS.plan) ?? null,
    status: columns.get(LEAD_COLUMNS.status) ?? null,
    enquiredOn: columns.get(LEAD_COLUMNS.enquiredOn) ?? null,
  };
}

/** One `items_page` (or `next_items_page`) as Monday returns it. */
export function parseItemsPage(page: unknown): { items: MondayLeadItem[]; cursor: string | null } {
  const p = obj(page);
  const items = (Array.isArray(p.items) ? (p.items as Unknown[]) : [])
    .map(parseItem)
    .filter((x): x is MondayLeadItem => x !== null);
  return { items, cursor: text(p.cursor) };
}

/** The `boards[0].groups[]` of the first query: each group with its first page. */
export function parseBoardGroups(data: unknown): { groupId: string; page: unknown }[] {
  const boards = Array.isArray(obj(data).boards) ? (obj(data).boards as Unknown[]) : [];
  const groups = Array.isArray(obj(boards[0]).groups) ? (obj(boards[0]).groups as Unknown[]) : [];
  return groups.map((g) => ({ groupId: text(g.id) ?? "", page: g.items_page })).filter((g) => g.groupId !== "");
}

const ITEM_FIELDS = `
  id
  name
  group { id }
  column_values (ids: ${JSON.stringify(Object.values(LEAD_COLUMNS))}) { id text }
`;

const FIRST_PAGE_QUERY = `
  query ($board: [ID!], $groups: [String!]) {
    boards (ids: $board) {
      groups (ids: $groups) {
        id
        items_page (limit: 100) {
          cursor
          items { ${ITEM_FIELDS} }
        }
      }
    }
  }
`;

const NEXT_PAGE_QUERY = `
  query ($cursor: String!) {
    next_items_page (cursor: $cursor, limit: 100) {
      cursor
      items { ${ITEM_FIELDS} }
    }
  }
`;

/**
 * Every item in the two customer groups, in board order.
 *
 * A first query asks for both groups' first pages; each group is then paged with Monday's
 * `next_items_page` until its cursor runs out. Sixteen items today, so this is one round trip,
 * but the board will grow.
 */
export async function listLeadItems(): Promise<MondayLeadItem[]> {
  const groupIds = LEAD_CATEGORY_KEYS.map((k) => LEAD_CATEGORIES[k].mondayGroupId);
  const first = await mondayQuery(FIRST_PAGE_QUERY, { board: [leadsBoardId()], groups: groupIds });
  const out: MondayLeadItem[] = [];
  for (const group of parseBoardGroups(first)) {
    let { items, cursor } = parseItemsPage(group.page);
    out.push(...items);
    while (cursor) {
      const next = await mondayQuery(NEXT_PAGE_QUERY, { cursor });
      ({ items, cursor } = parseItemsPage(obj(next).next_items_page));
      out.push(...items);
    }
  }
  return out;
}
