/**
 * Turning the lead database into customers on file.
 *
 * For each item in the two customer groups: a customer group named after them, then an account
 * that cannot sign in, with the notification switches set so that a reply typed in the app
 * reaches them as a plain WhatsApp and nothing ever emails them. Nothing here sends anything —
 * no welcome email, no verification code, no template — because these people are not being
 * invited yet; they are being kept a record of.
 *
 * Idempotent on the Monday item id: `monday_links` remembers the group, `profiles.monday_person_id`
 * remembers the person, and a second run refreshes name, email and number rather than making
 * duplicates. The one thing a re-run cannot do is move someone between categories once they are
 * in a group, since the group is the same either way; it simply updates the label.
 *
 * Runs as the signed-in admin for everything a person could do by hand (the group, the account)
 * and as the service role only for the two bookkeeping tables the team can read but not write.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { LEAD_CATEGORIES, type LeadCategory } from "@/lib/leadCategories";
import { leadsBoardId, leadTopic, parseLeadEmail, pickLeadPhone, type MondayLeadItem } from "./leads";

type Admin = SupabaseClient<Database>;

export type LeadOutcome =
  | "created"
  | "updated"
  | "skipped_no_email"
  | "skipped_no_category"
  | "bad_phone"
  | "phone_conflict"
  | "email_conflict"
  | "error";

export interface LeadImportResult {
  itemId: string;
  name: string;
  category: LeadCategory | null;
  outcome: LeadOutcome;
  error?: string;
  conversationId?: string;
  userId?: string;
}

export interface LeadImportActor {
  /** The admin's own client: RLS and the RPC gates apply to them, as they should. */
  db: Admin;
  userId: string;
  orgId: string;
  /** Team members added to every lead group, from the Monday integration's settings. */
  standardMemberIds: string[];
}

/** The event_type on monday_events rows this writes, so the settings page can list them apart. */
export const LEAD_IMPORT_EVENT = "lead_import";

/** Plain English for each outcome, shared by the settings page. */
export const LEAD_OUTCOMES: Record<LeadOutcome, string> = {
  created: "Imported",
  updated: "Already imported — details refreshed",
  skipped_no_email: "No email on the item — skipped",
  skipped_no_category: "Not in a customer group — skipped",
  bad_phone: "Imported without a usable mobile",
  phone_conflict: "Mobile already on another account",
  email_conflict: "Email already on another account",
  error: "Failed",
};

/** The RPC raises with a prefix for the cases the importer should name rather than call "error". */
export function outcomeFromRpcError(message: string | null | undefined): LeadOutcome {
  const text = message ?? "";
  if (/phone_conflict:/.test(text)) return "phone_conflict";
  if (/email_conflict:/.test(text)) return "email_conflict";
  if (/bad_phone:/.test(text)) return "bad_phone";
  return "error";
}

async function ensureGroup(
  admin: Admin,
  actor: LeadImportActor,
  item: MondayLeadItem,
): Promise<{ conversationId: string } | { error: string }> {
  const { data: link } = await admin
    .from("monday_links")
    .select("customer_conversation_id")
    .eq("org_id", actor.orgId)
    .eq("monday_item_id", item.id)
    .maybeSingle();
  if (link?.customer_conversation_id) return { conversationId: link.customer_conversation_id };

  const { data: slug, error: slugError } = await actor.db.rpc("next_available_slug", {
    p_org: actor.orgId,
    p_base: item.name,
  });
  if (slugError || !slug) return { error: slugError?.message ?? `could not derive a group name from "${item.name}"` };

  const { data: conversationId, error: channelError } = await actor.db.rpc("create_channel", {
    p_name: slug,
    p_type: "owner",
    p_member_ids: actor.standardMemberIds,
    p_topic: leadTopic(item),
  });
  if (channelError || !conversationId) {
    return { error: channelError?.message ?? "the customer group could not be created" };
  }

  // Recorded before the account is created, so a failure further down never makes a second
  // group on the next run. Written with the service role: this is the idempotency record.
  const { error: linkError } = await admin.from("monday_links").upsert(
    {
      org_id: actor.orgId,
      monday_item_id: item.id,
      board_id: leadsBoardId(),
      customer_conversation_id: conversationId,
    },
    { onConflict: "org_id,monday_item_id" },
  );
  if (linkError) return { error: `group created but could not be recorded: ${linkError.message}` };
  return { conversationId };
}

async function importOne(admin: Admin, actor: LeadImportActor, item: MondayLeadItem): Promise<LeadImportResult> {
  const base = { itemId: item.id, name: item.name, category: item.category };
  if (!item.category) return { ...base, outcome: "skipped_no_category" };
  if (!item.name.trim()) return { ...base, outcome: "error", error: "the item has no name" };

  const email = parseLeadEmail(item.emailRaw);
  if (!email) return { ...base, outcome: "skipped_no_email" };

  // A number we cannot use is not a reason to leave the person out: the account is created
  // without one and the outcome says so, so the team can fix the number rather than the import.
  const phone = pickLeadPhone(item.phoneRaw, item.phoneTextRaw);
  const phoneError = phone && !phone.ok ? phone.error : null;

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("org_id", actor.orgId)
    .eq("monday_person_id", item.id)
    .maybeSingle();

  const group = await ensureGroup(admin, actor, item);
  if ("error" in group) return { ...base, outcome: "error", error: group.error };

  const { data: userId, error } = await actor.db.rpc("import_lead_customer", {
    p_conversation_id: group.conversationId,
    p_email: email,
    p_full_name: item.name.trim(),
    p_lead_category: item.category,
    p_monday_item_id: item.id,
    p_phone: phone?.ok ? phone.e164 : null,
  });
  if (error || !userId) {
    return {
      ...base,
      outcome: outcomeFromRpcError(error?.message),
      error: error?.message ?? "the account could not be created",
      conversationId: group.conversationId,
    };
  }

  return {
    ...base,
    outcome: phoneError ? "bad_phone" : existing ? "updated" : "created",
    error: phoneError ?? undefined,
    conversationId: group.conversationId,
    userId,
  };
}

/**
 * Imports every item, one at a time — sixteen today, and `next_available_slug` should not be
 * asked the same question twice at once. Every item gets a monday_events row, which is the
 * audit trail the settings page reads back.
 */
export async function importLeadCustomers(
  admin: Admin,
  actor: LeadImportActor,
  items: MondayLeadItem[],
): Promise<{ runId: string; results: LeadImportResult[] }> {
  const runId = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const results: LeadImportResult[] = [];
  for (const item of items) {
    let result: LeadImportResult;
    try {
      result = await importOne(admin, actor, item);
    } catch (e) {
      result = {
        itemId: item.id,
        name: item.name,
        category: item.category,
        outcome: "error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
    results.push(result);
    await admin.from("monday_events").insert({
      event_id: `${LEAD_IMPORT_EVENT}:${runId}:${item.id}`,
      board_id: leadsBoardId(),
      item_id: item.id,
      event_type: LEAD_IMPORT_EVENT,
      payload: {
        name: item.name,
        category: item.category,
        category_label: item.category ? LEAD_CATEGORIES[item.category].label : null,
        conversation_id: result.conversationId ?? null,
      },
      outcome: result.outcome,
      error: result.error ?? null,
    });
  }
  return { runId, results };
}
