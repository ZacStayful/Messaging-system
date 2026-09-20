/**
 * Slack channels → conversations here.
 *
 * `decideConversation` is pure: archived and test channels are skipped, a channel with a guest in
 * it is a customer group, a channel whose name is an address is a property group (the shape
 * Monday creates: a `properties` row plus the Cleaning and Maintenance threads), everything else
 * is an internal channel; and a name that an existing group already holds is linked to it so the
 * Slack history lands where the team already works. `materialise` carries the decision out.
 *
 * Conversations are inserted directly rather than through create_channel so they carry Slack's
 * creation date and do not open with a "created this group" line dated today. The 0021 and 0022
 * triggers still fire on the insert (mandatory bookmarks, WhatsApp number).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { SlackConversation } from "./client";

type Admin = SupabaseClient<Database>;

export type TargetKind = "owner" | "internal" | "property";

export interface ExistingConversation {
  id: string;
  type: string;
  propertyId: string | null;
  archivedAt: string | null;
  /** Already the target of another Slack channel. */
  slackLinked: boolean;
}

export interface CustomerAddress {
  /** The customer channel whose topic carried the address. */
  channelId: string;
  address: string;
  slug: string;
}

export interface DecideConversationContext {
  /** Slack member id → is a guest (customer). */
  isGuest: (slackUserId: string) => boolean;
  isBot: (slackUserId: string) => boolean;
  existingBySlug: Map<string, ExistingConversation>;
  customerAddresses: CustomerAddress[];
  skipNamePatterns: string[];
}

export interface ConversationDecision {
  decision: "create" | "link" | "skip";
  skipReason: string | null;
  targetKind: TargetKind | null;
  targetConversationId: string | null;
  slug: string;
  propertyAddress: string | null;
  addressGuessed: boolean;
  customerChannelId: string | null;
}

/** The rule create_channel and next_available_slug apply. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** "6-trent-street-stockton-on-tees" → "6 Trent Street Stockton On Tees". */
export function deslugify(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

const POSTCODE = /(^|-)[a-z]{1,2}\d[a-z\d]?-?\d[a-z]{2}$/;

/** Lines of a topic that could be an address: one per line, the odd comma left alone. */
export function addressesFromTopic(channelId: string, topic: string | null | undefined): CustomerAddress[] {
  return (topic ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[.;]+$/, ""))
    .filter((line) => line.length >= 6 && /\d/.test(line))
    .map((address) => ({ channelId, address, slug: slugify(address) }));
}

export function looksLikeAddress(slug: string): boolean {
  return /^\d/.test(slug) || /^(flat|apartment|apt|unit|room|house|the)-/.test(slug) || POSTCODE.test(slug);
}

function matchAddress(slug: string, addresses: CustomerAddress[]): CustomerAddress | null {
  const exact = addresses.find((a) => a.slug === slug);
  if (exact) return exact;
  // "6-trent-street-stockton-on-tees" vs a topic of "6 Trent St, Stockton": share the house number
  // and first street word, and one is a prefix of the other for at least eight characters.
  return (
    addresses.find((a) => {
      const shorter = a.slug.length < slug.length ? a.slug : slug;
      const longer = shorter === slug ? a.slug : slug;
      return shorter.length >= 8 && longer.startsWith(shorter);
    }) ?? null
  );
}

export function decideConversation(
  conv: SlackConversation,
  members: string[],
  ctx: DecideConversationContext,
): ConversationDecision {
  const name = conv.name ?? conv.id;
  const slug = slugify(name);
  const none: ConversationDecision = {
    decision: "skip",
    skipReason: null,
    targetKind: null,
    targetConversationId: null,
    slug,
    propertyAddress: null,
    addressGuessed: false,
    customerChannelId: null,
  };
  if (conv.is_archived) return { ...none, skipReason: "archived" };
  if (ctx.skipNamePatterns.some((p) => p.trim().toLowerCase() === slug)) return { ...none, skipReason: "test" };
  if (conv.is_private && conv.is_member === false) return { ...none, skipReason: "not_visible" };

  const humans = members.filter((m) => !ctx.isBot(m));
  const hasGuest = humans.some((m) => ctx.isGuest(m));

  let targetKind: TargetKind = "internal";
  let propertyAddress: string | null = null;
  let addressGuessed = false;
  let customerChannelId: string | null = null;
  if (hasGuest) {
    targetKind = "owner";
  } else {
    const match = matchAddress(slug, ctx.customerAddresses);
    if (match) {
      targetKind = "property";
      propertyAddress = match.address;
      customerChannelId = match.channelId;
    } else if (looksLikeAddress(slug)) {
      targetKind = "property";
      propertyAddress = deslugify(slug);
      addressGuessed = true;
    }
  }

  const existing = ctx.existingBySlug.get(slug);
  if (existing && !existing.slackLinked && !existing.archivedAt) {
    // An existing customer group stays one whatever Slack says; an internal one takes the kind
    // Slack implies, which is what makes #maintenance the maintenance inbox and a property channel
    // a property group.
    const kind: TargetKind = existing.type === "owner" ? "owner" : existing.propertyId ? "property" : targetKind === "owner" ? "internal" : targetKind;
    return {
      decision: "link",
      skipReason: null,
      targetKind: kind,
      targetConversationId: existing.id,
      slug,
      propertyAddress: kind === "property" ? propertyAddress : null,
      addressGuessed: kind === "property" && addressGuessed,
      customerChannelId,
    };
  }
  return {
    decision: "create",
    skipReason: null,
    targetKind,
    targetConversationId: null,
    slug,
    propertyAddress,
    addressGuessed,
    customerChannelId,
  };
}

export interface SlackLinkRow {
  org_id: string;
  slack_channel_id: string;
  name: string | null;
  topic: string | null;
  purpose: string | null;
  created_ts: string | null;
  decision: string;
  target_kind: string | null;
  conversation_id: string | null;
  property_id: string | null;
  property_address: string | null;
}

/**
 * Makes (or finds) the conversation for a decided row. Returns the conversation id and, for a
 * property, the property id. `actor` is the admin's client for next_available_slug; the insert
 * itself is service-role so created_at and created_by can be set.
 */
export async function materialiseConversation(
  admin: Admin,
  actor: Admin,
  actorId: string,
  link: SlackLinkRow,
): Promise<{ conversationId: string; propertyId: string | null } | { error: string }> {
  let conversationId = link.conversation_id;
  const createdAt = link.created_ts ? new Date(Number(link.created_ts) * 1000).toISOString() : new Date().toISOString();

  if (!conversationId) {
    const base = link.name ?? link.slack_channel_id;
    const { data: slug, error: slugError } = await actor.rpc("next_available_slug", { p_org: link.org_id, p_base: base });
    if (slugError || !slug) return { error: slugError?.message ?? `no slug for ${base}` };
    let chosen = slug;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await admin
        .from("conversations")
        .insert({
          org_id: link.org_id,
          type: link.target_kind === "owner" ? "owner" : "internal",
          name: chosen,
          slug: chosen,
          topic: link.topic?.trim() || null,
          description: link.purpose?.trim() || null,
          is_private: true,
          created_by: actorId,
          created_at: createdAt,
        })
        .select("id")
        .single();
      if (!error && data) {
        conversationId = data.id;
        break;
      }
      if (error?.code !== "23505") return { error: error?.message ?? "insert failed" };
      chosen = `${slug}-${attempt + 2}`;
    }
    if (!conversationId) return { error: `could not find a free name for ${base}` };
  }

  let propertyId = link.property_id;
  if (link.target_kind === "property") {
    const address = (link.property_address ?? deslugify(slugify(link.name ?? ""))).trim();
    if (!propertyId) {
      const { data: convo } = await admin.from("conversations").select("property_id").eq("id", conversationId).maybeSingle();
      propertyId = convo?.property_id ?? null;
    }
    if (!propertyId) {
      const { data: found } = await admin
        .from("properties")
        .select("id")
        .eq("org_id", link.org_id)
        .eq("slack_channel_id", link.slack_channel_id)
        .maybeSingle();
      propertyId = found?.id ?? null;
    }
    if (!propertyId) {
      const { data: created, error } = await admin
        .from("properties")
        .insert({ org_id: link.org_id, address: address || link.slack_channel_id, slack_channel_id: link.slack_channel_id })
        .select("id")
        .single();
      if (error || !created) return { error: error?.message ?? "property insert failed" };
      propertyId = created.id;
    }
    await admin.from("conversations").update({ property_id: propertyId }).eq("id", conversationId).is("property_id", null);
    const { error: anchorError } = await admin.rpc("add_property_anchors", {
      p_conversation_id: conversationId,
      p_actor: actorId,
      p_created_at: createdAt,
    });
    if (anchorError) return { error: `anchors: ${anchorError.message}` };
  }

  return { conversationId, propertyId };
}
