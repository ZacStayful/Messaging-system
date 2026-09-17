import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Profile } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { bearerFrom, hashApiKey, hashesMatch, type Scope } from "./keys";
import { mintUserToken } from "./jwt";

export interface ApiKeyContext {
  keyId: string;
  keyName: string;
  orgId: string;
  /** The person this key acts as. */
  userId: string;
  profile: Profile;
  scopes: string[];
}

export type ApiClient = SupabaseClient<Database>;

/**
 * Identifies the key behind a request. The service-role client is used here and *only* here:
 * looking a key up has to happen before we know who the caller is, so it cannot go through
 * RLS. Everything after this point runs through userClient() below.
 *
 * Returns null for a missing, unknown, revoked, expired or deactivated key — the caller maps
 * all of those to one 401, so a probe cannot tell them apart.
 */
export async function verifyApiKey(request: Request): Promise<ApiKeyContext | null> {
  const token = bearerFrom(request);
  if (!token) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  const { data: key } = await admin
    .from("api_keys")
    .select("id, name, org_id, user_id, key_hash, scopes, expires_at, revoked_at")
    .eq("key_hash", hashApiKey(token))
    .maybeSingle();
  if (!key) return null;

  // The lookup above already matched on the hash; this re-compares in constant time so the
  // code does not rely on the database's comparison being timing-safe.
  if (!hashesMatch(key.key_hash, hashApiKey(token))) return null;
  if (key.revoked_at) return null;
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return null;

  const { data: profile } = await admin.from("profiles").select("*").eq("id", key.user_id).maybeSingle();
  if (!profile || profile.deactivated_at) return null;

  return {
    keyId: key.id,
    keyName: key.name,
    orgId: key.org_id,
    userId: key.user_id,
    profile,
    scopes: key.scopes ?? [],
  };
}

/**
 * A Supabase client that acts as the key's user, so RLS applies exactly as it would in the
 * browser. The `accessToken` option is the supported way to hand supabase-js a token from
 * somewhere other than its own auth flow; it also makes `client.auth.*` throw, which is what
 * we want — nothing here should be signing anyone in or out.
 */
export function userClient(ctx: ApiKeyContext): ApiClient {
  return actingUserClient(ctx.userId);
}

/**
 * The same thing for a caller that has a user id but no API key behind it — today, the Monday
 * webhook, which acts as the team member named in `integrations.config.actor_user_id`.
 *
 * Deliberately not the service-role client. Every RPC the integration calls
 * (`create_channel`, `create_property_group`, `create_customer_account`) gates on `is_team()`
 * and `auth.uid()`, so reaching them with the service role would mean either bypassing those
 * checks or rewriting them in TypeScript — a second copy of the authorisation rules, which is
 * the thing this file exists to avoid. Acting as a person also gives the created groups a real
 * `created_by` and a real author on the messages they open with.
 */
export function actingUserClient(userId: string): ApiClient {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // With accessToken set, supabase-js ignores the auth options entirely and replaces
    // client.auth with a proxy that throws — which is what we want here. Nothing in an API
    // request should be signing anyone in or out.
    { accessToken: async () => mintUserToken(userId) },
  );
}

export function hasScope(ctx: ApiKeyContext, scope: Scope): boolean {
  return ctx.scopes.includes(scope);
}
