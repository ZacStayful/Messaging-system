import type { createAdminClient } from "@/lib/supabase/admin";
import type { ContactRegistration, RecentThread, RouteInput } from "@/lib/whatsapp/routing";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Everything the routing decision needs, read in one place.
 *
 * `property_contacts` is joined to `property_threads` so a registration arrives with the thread
 * anchor already attached — the decision has no business issuing queries.
 *
 * Lifted out of the WhatsApp webhook when voicemail needed the same answer. Both channels ask
 * the identical question — this number reached us, which thread does it belong to — so they ask
 * it through one function rather than two that drift. It is keyed on a profile id and knows
 * nothing about how the message arrived.
 */
export async function gather(admin: Admin, userId: string, orgId: string): Promise<RouteInput> {
  const [{ data: contactRows }, { data: threadRows }] = await Promise.all([
    admin
      .from("property_contacts")
      .select("conversation_id, kind, conversations!inner(archived_at)")
      .eq("user_id", userId),
    admin.from("whatsapp_threads").select("conversation_id, parent_message_id, last_outbound_at").eq("user_id", userId),
  ]);

  const anchors = new Map<string, string>();
  const conversationIds = [...new Set((contactRows ?? []).map((c) => c.conversation_id))];
  if (conversationIds.length) {
    const { data: threads } = await admin
      .from("property_threads")
      .select("conversation_id, kind, root_message_id")
      .in("conversation_id", conversationIds);
    for (const t of threads ?? []) anchors.set(`${t.conversation_id}:${t.kind}`, t.root_message_id);
  }

  const contacts: ContactRegistration[] = [];
  for (const c of contactRows ?? []) {
    const root = anchors.get(`${c.conversation_id}:${c.kind}`);
    // A registration whose thread has gone is not a routable destination.
    if (!root) continue;
    const conversation = c.conversations as unknown as { archived_at: string | null } | null;
    contacts.push({
      conversationId: c.conversation_id,
      kind: c.kind === "maintenance" ? "maintenance" : "cleaning",
      rootMessageId: root,
      archived: Boolean(conversation?.archived_at),
    });
  }

  const recentThreads: RecentThread[] = (threadRows ?? []).map((t) => ({
    conversationId: t.conversation_id,
    parentMessageId: t.parent_message_id ?? null,
    lastOutboundAt: t.last_outbound_at ?? null,
  }));

  // Their customer group, for the unchanged customer path.
  const { data: membership } = await admin
    .from("conversation_members")
    .select("conversation_id, conversations!inner(type, archived_at)")
    .eq("user_id", userId)
    .eq("member_side", "external")
    .eq("conversations.type", "owner")
    .is("conversations.archived_at", null)
    .limit(1)
    .maybeSingle();

  // Only resolved when there is a maintenance contact to need it — ensure_maintenance_channel
  // creates the channel on first use, and a customer's reply should not conjure one.
  let maintenanceChannelId: string | null = null;
  if (contacts.some((c) => !c.archived && c.kind === "maintenance")) {
    const { data } = await admin.rpc("ensure_maintenance_channel", { p_org: orgId });
    maintenanceChannelId = data ?? null;
  }

  return { contacts, recentThreads, ownerGroupId: membership?.conversation_id ?? null, maintenanceChannelId };
}
