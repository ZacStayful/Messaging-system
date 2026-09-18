/**
 * The little bit of the Monday.com API this integration needs.
 *
 * A board-level webhook delivers an event, not a row: `create_item` carries the item id, the
 * board id and the item's name, and nothing else useful. The property address, the email and the
 * status all have to be fetched, which is why this exists and why `MONDAY_API_TOKEN` is
 * required for the integration to do anything.
 *
 * Deliberately not a Monday SDK: one query, one POST, and `fetch` is already how this codebase
 * talks to Resend and TimelinesAI.
 */

const API = "https://api.monday.com/v2";
// Pinned rather than floating: Monday deprecates versions on a published schedule, and a query
// that silently changes meaning under us is worse than one that fails loudly at a known date.
const API_VERSION = "2024-10";

/** The Clients board (4972230367) columns this reads. Changing one means changing it here. */
export const CLIENT_COLUMNS = {
  propertyAddress: "text_mm12z1ka",
  email: "email",
  phone: "phone",
  status: "status",
} as const;

export interface MondayClientItem {
  id: string;
  name: string;
  boardId: string | null;
  groupId: string | null;
  groupTitle: string | null;
  propertyAddress: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
}

export class MondayNotConfiguredError extends Error {
  constructor(message = "MONDAY_API_TOKEN is not set") {
    super(message);
    this.name = "MondayNotConfiguredError";
  }
}

export function mondayConfigured(): boolean {
  return Boolean(process.env.MONDAY_API_TOKEN);
}

/** The board a Clients webhook is expected to come from; anything else is ignored. */
export function clientsBoardId(): string {
  return process.env.MONDAY_CLIENTS_BOARD_ID?.trim() || "4972230367";
}

const ITEM_QUERY = `
  query ($ids: [ID!]) {
    items (ids: $ids) {
      id
      name
      board { id }
      group { id title }
      column_values (ids: ["text_mm12z1ka", "email", "phone", "status"]) {
        id
        text
      }
    }
  }
`;

type Unknown = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Runs one GraphQL query against Monday and hands back its `data`.
 *
 * Shared by the Clients webhook (one item by id) and the lead database import (a board's groups
 * by page). Monday answers 200 with an `errors` array for a bad query or a revoked token, so the
 * status code alone is not enough to know the call worked.
 */
export async function mondayQuery<T = Unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new MondayNotConfiguredError();

  const res = await fetch(process.env.MONDAY_API_BASE?.replace(/\/$/, "") || API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: token,
      "API-Version": API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await res.json().catch(() => null)) as Unknown | null;
  if (!res.ok) {
    throw new Error(`Monday API ${res.status}: ${JSON.stringify(payload ?? {}).slice(0, 300)}`);
  }
  if (Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(`Monday API error: ${JSON.stringify(payload.errors).slice(0, 300)}`);
  }
  return (payload?.data ?? {}) as T;
}

/**
 * Fetches one Clients item.
 *
 * Returns null when the item does not exist or has since been deleted — a webhook can outlive
 * its item, and that is not an error worth retrying.
 */
export async function getClientItem(itemId: string): Promise<MondayClientItem | null> {
  const data = await mondayQuery(ITEM_QUERY, { ids: [itemId] });
  const items = Array.isArray(data.items) ? (data.items as Unknown[]) : [];
  const item = items[0];
  if (!item) return null;

  const columns = new Map<string, string | null>();
  for (const c of (item.column_values as Unknown[] | undefined) ?? []) {
    columns.set(String(c.id), text(c.text));
  }
  const group = (item.group ?? {}) as Unknown;
  const board = (item.board ?? {}) as Unknown;

  return {
    id: String(item.id),
    name: text(item.name) ?? "",
    boardId: text(board.id) ?? null,
    groupId: text(group.id) ?? null,
    groupTitle: text(group.title) ?? null,
    propertyAddress: columns.get(CLIENT_COLUMNS.propertyAddress) ?? null,
    email: columns.get(CLIENT_COLUMNS.email) ?? null,
    phone: columns.get(CLIENT_COLUMNS.phone) ?? null,
    status: columns.get(CLIENT_COLUMNS.status) ?? null,
  };
}
