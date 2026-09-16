import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { actingUserClient } from "@/lib/api/auth";
import { renderTemplate } from "@/lib/templates/render";
import { clientsBoardId, getClientItem, type MondayClientItem } from "./client";

/**
 * Turning a new row on Monday's Clients board into the two groups Stayful works out of.
 *
 * 1. a **customer group** (`owner`) named after the client, topic set to the property address,
 *    opening with the welcome message from `message_templates`
 * 2. a **property group** (`internal`) named after the address, carrying the Cleaning and
 *    Maintenance threads
 *
 * Everything here is idempotent. Monday retries deliveries, a recipe can be re-fired by hand,
 * and a replayed payload arrives with a fresh event id — so "have we already done this item?"
 * is answered by `monday_links`, not by hoping the webhook is called once.
 */

type Admin = SupabaseClient<Database>;

/** Why a delivery did or did not produce anything. Stored on `monday_events.outcome`. */
export type Outcome =
  | "created"
  | "duplicate"
  | "skipped_disabled"
  | "skipped_board"
  | "skipped_group"
  | "skipped_event"
  | "no_address"
  | "not_configured"
  | "error";

export interface ProvisionResult {
  outcome: Outcome;
  error?: string;
  customerConversationId?: string;
  propertyConversationId?: string;
  detail?: string;
}

export interface IntegrationSettings {
  enabled: boolean;
  orgId: string;
  actorUserId: string | null;
  standardMemberIds: string[];
  /** Board groups that should NOT provision. Defaults to anything that looks like "Dropped". */
  skipGroupIds: string[];
}

export const MONDAY_INTEGRATION_KEY = "monday_clients";

/** Reads the switch and its configuration. Uses the service role: there is no caller yet. */
export async function readIntegration(admin: Admin): Promise<IntegrationSettings | null> {
  const { data } = await admin
    .from("integrations")
    .select("org_id, enabled, config")
    .eq("key", MONDAY_INTEGRATION_KEY)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    enabled: Boolean(data.enabled),
    orgId: data.org_id,
    actorUserId: typeof config.actor_user_id === "string" ? config.actor_user_id : null,
    standardMemberIds: ids(config.standard_member_ids),
    skipGroupIds: ids(config.skip_group_ids),
  };
}

/**
 * The name a group gets. `create_channel` slugifies whatever it is handed and refuses a slug a
 * live group already holds — right for a person typing a name, wrong for a sync, where two
 * clients sharing a surname would leave the second with no group at all. `next_available_slug`
 * (0024) picks the next free suffix, and truncates, so the sidebar does not fill with
 * seventy-character addresses.
 */
async function availableName(client: Admin, orgId: string, base: string): Promise<string | null> {
  const { data, error } = await client.rpc("next_available_slug", { p_org: orgId, p_base: base });
  if (error || !data) return null;
  return data;
}

/**
 * A Monday item, provisioned. Returns without doing anything when the switch is off, the board
 * is not the Clients board, the event is not a creation, or the item has been done already.
 */
export async function provisionClientItem(
  admin: Admin,
  settings: IntegrationSettings,
  itemId: string,
  boardId: string | null,
  groupId: string | null,
): Promise<ProvisionResult> {
  if (!settings.enabled) return { outcome: "skipped_disabled" };
  if (boardId && boardId !== clientsBoardId()) return { outcome: "skipped_board", detail: boardId };
  if (!settings.actorUserId) {
    return { outcome: "not_configured", error: "no team member is set for the integration to act as" };
  }
  if (groupId && settings.skipGroupIds.includes(groupId)) {
    return { outcome: "skipped_group", detail: groupId };
  }

  // Already done? Asked before the Monday fetch so a redelivery costs nothing.
  const { data: existing } = await admin
    .from("monday_links")
    .select("customer_conversation_id, property_conversation_id")
    .eq("org_id", settings.orgId)
    .eq("monday_item_id", itemId)
    .maybeSingle();
  if (existing) {
    return {
      outcome: "duplicate",
      customerConversationId: existing.customer_conversation_id ?? undefined,
      propertyConversationId: existing.property_conversation_id ?? undefined,
    };
  }

  const item = await getClientItem(itemId);
  if (!item) return { outcome: "error", error: `Monday item ${itemId} not found` };
  if (item.boardId && item.boardId !== clientsBoardId()) {
    return { outcome: "skipped_board", detail: item.boardId };
  }
  // The board group is only on the event for some event shapes, so re-check it from the item.
  if (item.groupId && settings.skipGroupIds.includes(item.groupId)) {
    return { outcome: "skipped_group", detail: item.groupId };
  }

  return createGroupsFor(admin, settings, item);
}

async function createGroupsFor(
  admin: Admin,
  settings: IntegrationSettings,
  item: MondayClientItem,
): Promise<ProvisionResult> {
  const client = actingUserClient(settings.actorUserId!);
  const customerName = item.name.trim();
  if (!customerName) return { outcome: "error", error: `Monday item ${item.id} has no name` };
  const address = item.propertyAddress?.trim() || null;

  // --- the customer group -------------------------------------------------
  const customerSlug = await availableName(client, settings.orgId, customerName);
  if (!customerSlug) return { outcome: "error", error: `could not derive a group name from "${customerName}"` };

  const { data: customerId, error: customerError } = await client.rpc("create_channel", {
    p_name: customerSlug,
    p_type: "owner",
    p_member_ids: settings.standardMemberIds,
    p_topic: address,
  });
  if (customerError || !customerId) {
    return { outcome: "error", error: customerError?.message ?? "the customer group could not be created" };
  }

  await postWelcome(client, settings, customerId, customerName, address);

  // --- the property group -------------------------------------------------
  // No address, no property group. The customer group is still worth having, and `no_address`
  // on the event row is how the team finds the rows that need a second pass — far better than
  // a group called "-2" or a silent half-failure.
  let propertyConversationId: string | undefined;
  let propertyId: string | undefined;
  if (address) {
    const { data: property } = await client
      .from("properties")
      .upsert(
        {
          org_id: settings.orgId,
          address,
          monday_item_id: item.id,
          client_monday_item_id: item.id,
        },
        { onConflict: "org_id,monday_item_id" },
      )
      .select("id")
      .maybeSingle();
    propertyId = property?.id;

    const propertySlug = await availableName(client, settings.orgId, address);
    if (propertySlug) {
      const { data: pgId, error: pgError } = await client.rpc("create_property_group", {
        p_name: propertySlug,
        p_topic: customerName,
        p_property_id: propertyId ?? undefined,
        p_member_ids: settings.standardMemberIds,
      });
      if (pgError) {
        // The customer group exists and the welcome message has been posted; losing that to a
        // property-group failure would be worse than recording it and moving on.
        await recordLink(admin, settings.orgId, item, customerId, undefined, propertyId);
        return {
          outcome: "error",
          error: `customer group created, property group failed: ${pgError.message}`,
          customerConversationId: customerId,
        };
      }
      propertyConversationId = pgId ?? undefined;
    }
  }

  await recordLink(admin, settings.orgId, item, customerId, propertyConversationId, propertyId);

  return {
    outcome: address ? "created" : "no_address",
    customerConversationId: customerId,
    propertyConversationId,
  };
}

/**
 * The welcome message, rendered from `message_templates` and posted as the acting team member.
 *
 * A missing or deactivated template is not silently skipped: the group would open empty and
 * nothing would say why. It posts an internal note instead, which the customer never sees
 * (`visibility = 'internal'` is filtered out for customer accounts everywhere) and the team
 * does.
 */
async function postWelcome(
  client: Admin,
  settings: IntegrationSettings,
  conversationId: string,
  customerName: string,
  address: string | null,
): Promise<void> {
  const { data: template } = await client
    .from("message_templates")
    .select("body")
    .eq("org_id", settings.orgId)
    .eq("key", "customer_welcome")
    .eq("active", true)
    .maybeSingle();

  const { data: actor } = await client
    .from("profiles")
    .select("display_name")
    .eq("id", settings.actorUserId!)
    .maybeSingle();

  if (!template?.body) {
    await client.from("messages").insert({
      org_id: settings.orgId,
      conversation_id: conversationId,
      sender_id: settings.actorUserId!,
      body: "This group was created from Monday, but the `customer_welcome` template is missing or switched off, so no welcome message was posted. Add it under Settings → Templates and paste it in here.",
      kind: "text",
      visibility: "internal",
      sent_via: "api",
    });
    return;
  }

  const body = renderTemplate(template.body, {
    customer_name: customerName,
    first_name: customerName.split(/\s+/)[0] ?? customerName,
    property_address: address ?? "",
    account_manager: actor?.display_name ?? "Stayful",
  });

  await client.from("messages").insert({
    org_id: settings.orgId,
    conversation_id: conversationId,
    sender_id: settings.actorUserId!,
    body,
    kind: "text",
    visibility: "public",
    sent_via: "api",
    meta: { template: "customer_welcome", monday_item_id: null },
  });
}

/** Written with the service role: this is the idempotency record and must not depend on RLS. */
async function recordLink(
  admin: Admin,
  orgId: string,
  item: MondayClientItem,
  customerConversationId: string,
  propertyConversationId?: string,
  propertyId?: string,
): Promise<void> {
  await admin.from("monday_links").upsert(
    {
      org_id: orgId,
      monday_item_id: item.id,
      board_id: item.boardId,
      customer_conversation_id: customerConversationId,
      property_conversation_id: propertyConversationId ?? null,
      property_id: propertyId ?? null,
    },
    { onConflict: "org_id,monday_item_id" },
  );
}
