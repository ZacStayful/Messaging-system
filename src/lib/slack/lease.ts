import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

/** A wall-clock budget for one cron slice: work units check it between calls and stop early. */
export class Budget {
  private readonly deadline: number;
  constructor(ms: number, now = Date.now()) {
    this.deadline = now + ms;
  }
  remainingMs(now = Date.now()): number {
    return this.deadline - now;
  }
  /** True while at least `needMs` is left. */
  has(needMs = 8_000, now = Date.now()): boolean {
    return this.remainingMs(now) >= needMs;
  }
}

/**
 * The worker lease. Two overlapping cron runs must not both walk history for the same channel,
 * and the claim on the row handles that; the lease is for the phases that have no row to claim
 * (discovery, the user pass). Renewed by re-acquiring with the same holder.
 */
export async function acquireLease(admin: Admin, name: string, holder: string, ttlSeconds = 120): Promise<boolean> {
  const { data, error } = await admin.rpc("slack_acquire_lease", {
    p_name: name,
    p_holder: holder,
    p_ttl: `${ttlSeconds} seconds`,
  });
  if (error) return false;
  return Boolean(data);
}

export async function releaseLease(admin: Admin, name: string, holder: string): Promise<void> {
  await admin
    .from("slack_leases")
    .update({ expires_at: new Date(0).toISOString() })
    .eq("name", name)
    .eq("holder", holder);
}
