/**
 * The newest timestamp this client can prove the server assigned.
 *
 * Used to bound the catch-up query after a dropped socket: everything after this is fetched, so
 * getting it wrong in the *forward* direction means messages are never fetched at all.
 *
 * Optimistic rows have to be excluded, and that is the whole point of this function. A message
 * being sent carries `created_at: new Date().toISOString()` — the browser's clock — and is
 * appended last. A **failed** send is never removed from the list, so on a device whose clock
 * runs fast the high-water mark stays pinned minutes into the future for the life of the
 * component, `gt(created_at, since)` matches nothing real, and the conversation silently stops
 * updating. No error, no empty state, nothing logged: it just quietly ends.
 *
 * The thread-reply path already filtered these out; the main timeline did not.
 *
 * The maximum rather than the last element, because rows arrive by upsert as well as by append
 * and sortedness is an assumption this does not need to make.
 */
export function serverHighWaterMark(rows: readonly { created_at: string; _status?: unknown }[]): string | undefined {
  let newest: string | undefined;
  for (const row of rows) {
    // `_status` is only ever set on a row the server has not acknowledged.
    if (row._status) continue;
    if (!row.created_at) continue;
    if (newest === undefined || row.created_at > newest) newest = row.created_at;
  }
  return newest;
}
