/**
 * Replacing local state with what the server just said, without losing what is still in flight.
 *
 * The recovery path re-reads a conversation wholesale, and the merge it feeds has to *remove*
 * things — which is exactly what the previous one could not do. `loadExtras` kept every prior
 * reaction not present in the new set and only appended unseen attachments, so a reaction or an
 * attachment deleted while the socket was down survived for ever. Additive merging cannot express
 * a deletion, and no amount of fetching more rows fixes that.
 *
 * So: what came back from the server is the truth, plus anything local the server could not have
 * known about yet.
 */

/** A row still being written: it has no server identity, so the server's silence means nothing. */
export interface Pending {
  _status?: unknown;
}

/**
 * Server rows replace local ones entirely, except that locally pending rows are kept.
 *
 * Order follows the server's, with pending rows appended — they are by definition the newest
 * thing this client knows about, and they are what the person just did.
 */
export function reconcile<T>(previous: readonly T[], fetched: readonly T[], keyOf: (row: T) => string): T[] {
  const pending = previous.filter((row) => Boolean((row as Pending)._status));
  // A pending row whose server copy has now arrived is no longer pending; dropping the local
  // one avoids showing the message twice for the instant before the optimistic row is reconciled
  // by id elsewhere.
  const landed = new Set(fetched.map(keyOf));
  return [...fetched, ...pending.filter((row) => !landed.has(keyOf(row)))];
}

/** Reactions have no id of their own: the primary key is the three columns together. */
export function reactionKey(r: { message_id: string; user_id: string; emoji: string }): string {
  return `${r.message_id}\u0000${r.user_id}\u0000${r.emoji}`;
}

/** Pins are keyed by the message they are on — one pin per message per conversation. */
export function pinKey(p: { message: { id: string } }): string {
  return p.message.id;
}
