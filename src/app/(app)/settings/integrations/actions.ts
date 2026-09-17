"use server";

import { createClient } from "@/lib/supabase/server";
import { MONDAY_INTEGRATION_KEY } from "@/lib/monday/provision";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Saves the Monday integration's switch and configuration.
 *
 * Runs as the signed-in admin, so the RLS policy on `integrations` — not this function — is what
 * decides whether they are allowed to. The one thing enforced here is that the integration
 * cannot be switched on without a person for it to act as: every group it creates is created by
 * someone, and "nobody" is not an answer the database can give.
 */
export async function saveMondaySettings(formData: FormData): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const enabled = formData.get("enabled") === "on";
  const actorUserId = String(formData.get("actor_user_id") ?? "").trim();
  const standardMemberIds = formData.getAll("standard_member_ids").map(String).filter(Boolean);
  const skipGroupIds = String(formData.get("skip_group_ids") ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (enabled && !actorUserId) {
    return { ok: false, error: "Choose which team member the integration should act as before switching it on." };
  }

  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };

  const { error } = await supabase.from("integrations").upsert(
    {
      org_id: me.org_id,
      key: MONDAY_INTEGRATION_KEY,
      enabled,
      config: {
        actor_user_id: actorUserId || null,
        standard_member_ids: standardMemberIds,
        skip_group_ids: skipGroupIds,
      },
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,key" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
