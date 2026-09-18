"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mondayConfigured } from "@/lib/monday/client";
import { MONDAY_INTEGRATION_KEY, readIntegration } from "@/lib/monday/provision";
import { listLeadItems } from "@/lib/monday/leads";
import { importLeadCustomers, type LeadImportResult } from "@/lib/monday/importLeads";

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

export interface LeadImportResponse {
  ok: boolean;
  error?: string;
  results?: LeadImportResult[];
}

/**
 * Pulls the two customer groups off the lead database board and puts every person in them on
 * file: a group each, an account that cannot sign in, nothing sent. Admin-only, like the page.
 *
 * Runs as the signed-in admin for the group and the account, so the RPC gates and RLS apply to
 * them; the service role is used only for the bookkeeping tables the team can read but not write.
 */
export async function importLeadDatabase(): Promise<LeadImportResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { data: me } = await supabase.from("profiles").select("org_id, account_type, role").eq("id", user.id).single();
  if (!me) return { ok: false, error: "Your profile could not be loaded." };
  if (me.account_type !== "team" || me.role !== "admin") return { ok: false, error: "Only an admin can import." };

  if (!mondayConfigured()) return { ok: false, error: "MONDAY_API_TOKEN is not set, so the board cannot be read." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  // The switch is about the Clients webhook; only the "always add" list is borrowed here.
  const settings = await readIntegration(admin);

  let items;
  try {
    items = await listLeadItems();
  } catch (e) {
    return { ok: false, error: `Monday could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }

  const { results } = await importLeadCustomers(
    admin,
    { db: supabase, userId: user.id, orgId: me.org_id, standardMemberIds: settings?.standardMemberIds ?? [] },
    items,
  );
  revalidatePath("/settings/integrations");
  return { ok: true, results };
}
