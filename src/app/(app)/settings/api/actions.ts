"use server";

import { createClient } from "@/lib/supabase/server";
import { generateApiKey, isScope } from "@/lib/api/keys";
import { jwtConfigured } from "@/lib/api/jwt";

export interface CreateKeyResult {
  ok: boolean;
  error?: string;
  /** Shown once, immediately after creation, and then never retrievable. */
  plaintext?: string;
  warning?: string;
}

/**
 * Mints a key and stores only its hash. Runs as the signed-in admin, so the RLS policy on
 * api_keys — not this function — is what decides whether they are allowed to.
 */
export async function createApiKey(formData: FormData): Promise<CreateKeyResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const name = String(formData.get("name") ?? "").trim();
  const actsAs = String(formData.get("user_id") ?? "").trim();
  const scopes = formData.getAll("scopes").map(String).filter(isScope);
  const expiresDays = Number(formData.get("expires_days") ?? 0);

  if (!name) return { ok: false, error: "Give the key a name so you can recognise it later." };
  if (!actsAs) return { ok: false, error: "Choose which person the key should act as." };
  if (!scopes.length) return { ok: false, error: "Choose at least one thing the key may do." };

  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  const key = generateApiKey();
  const { error } = await supabase.from("api_keys").insert({
    org_id: me.org_id,
    user_id: actsAs,
    name,
    key_hash: key.hash,
    key_prefix: key.prefix,
    scopes,
    created_by: user.id,
    expires_at: expiresDays > 0 ? new Date(Date.now() + expiresDays * 86_400_000).toISOString() : null,
  });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    plaintext: key.plaintext,
    // Worth saying at the moment someone creates their first key, rather than letting them
    // discover it through a 503 later.
    warning: jwtConfigured()
      ? undefined
      : "SUPABASE_JWT_SECRET is not set on this deployment, so the API and MCP server will answer 503 until it is.",
  };
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };
  const { error } = await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
