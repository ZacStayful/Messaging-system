import { createHash } from "node:crypto";

/**
 * The key that makes a retried send safe.
 *
 * Derived from the outbox rows in the batch, because those are exactly what the email is made
 * of: the recipient, the conversation and every message quoted in it all come from them. So the
 * same rows always produce the same key, and a different set always produces a different one —
 * which is the property Resend needs, since reusing a key with a changed payload is an error
 * rather than a no-op.
 *
 * Sorted, because grouping order is not something to depend on: a batch is the same batch
 * however it was assembled.
 *
 * Hashed rather than listing the ids, which keeps it inside Resend's 256-character limit for a
 * batch of any size and means the key leaks nothing about volume to anyone reading a log.
 *
 * The prefix is deliberate. Keys live in Resend's own namespace for 24 hours, so anything else
 * sending through the same account must not be able to collide with a notification by accident.
 */
export function outboxIdempotencyKey(rowIds: readonly number[]): string {
  const ids = [...rowIds].sort((a, b) => a - b).join(",");
  return `stayful-outbox-${createHash("sha256").update(ids).digest("hex")}`;
}
