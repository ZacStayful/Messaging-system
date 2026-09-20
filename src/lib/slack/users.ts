/**
 * Slack members → people here.
 *
 * `decideUser` is pure and answers one question per Slack member: link, invite, create dormant,
 * or skip. `applyUserDecision` carries it out. The rules, agreed with the owner:
 *
 *   guest (is_restricted / is_ultra_restricted)   a customer, dormant — nobody is emailed
 *   full member with an account here already      linked by email, nothing else touched
 *   full member, team domain, not deleted          a real team invite, login details by email
 *   full member, other domain, not deleted         a dormant team account, held for review
 *   deleted member                                 dormant and deactivated, so their posts keep a name
 *   bot / app                                      a deactivated "team" profile named after the app
 *   Slackbot                                       nothing
 *
 * Display names are de-duplicated because @mentions in this app resolve by display name
 * (src/lib/richtext.ts): two "Sam"s would share every mention between them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAccountAndInvite } from "@/lib/api/invite";
import { fetchWithTimeout } from "@/lib/net/withTimeout";
import { type SlackUser } from "./client";

type Admin = SupabaseClient<Database>;

export type UserDecision = "link" | "invite_team" | "create_customer" | "create_team" | "create_bot" | "skip";

export interface ExistingProfile {
  id: string;
  email: string | null;
  slackUserId: string | null;
  displayName: string;
}

export interface DecideUserContext {
  teamDomains: string[];
  profilesByEmail: Map<string, ExistingProfile>;
  profilesBySlackId: Map<string, ExistingProfile>;
  /** Lower-cased display names already in use, by anyone; grows as decisions are made. */
  takenDisplayNames: Set<string>;
}

export interface DecidedUser {
  slackUserId: string;
  decision: UserDecision;
  reason: string;
  email: string | null;
  fullName: string;
  displayName: string;
  accountType: "team" | "customer";
  role: "owner" | "staff";
  timezone: string | null;
  imageUrl: string | null;
  deactivated: boolean;
  isBot: boolean;
  /** For a `link`, the profile it links to. */
  profileId: string | null;
}

function domainOf(email: string | null): string {
  return (email ?? "").split("@")[1]?.toLowerCase() ?? "";
}

/** Slack's `name` handle is the last resort; nobody wants to be "u061h4eftnj". */
function baseNames(u: SlackUser): { full: string; display: string } {
  const real = (u.real_name ?? u.profile?.real_name ?? "").trim();
  const display = (u.profile?.display_name ?? "").trim();
  const handle = (u.name ?? "").trim();
  const full = real || display || handle || u.id;
  return { full, display: display || real.split(" ")[0] || handle || u.id };
}

/** "Sam" taken → "Sam W." → "Sam Walters" → "Sam (handle)". */
export function uniqueDisplayName(preferred: string, fullName: string, handle: string, taken: Set<string>): string {
  const candidates = [preferred];
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    candidates.push(`${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`);
    candidates.push(fullName);
  }
  if (handle) candidates.push(handle, `${preferred} (${handle})`);
  for (const c of candidates) {
    const key = c.trim().toLowerCase();
    if (key && !taken.has(key)) return c.trim();
  }
  let n = 2;
  while (taken.has(`${preferred} ${n}`.toLowerCase())) n += 1;
  return `${preferred} ${n}`;
}

export function decideUser(u: SlackUser, ctx: DecideUserContext): DecidedUser {
  const email = u.profile?.email?.trim().toLowerCase() || null;
  const names = baseNames(u);
  const isBot = Boolean(u.is_bot || u.is_app_user || u.profile?.bot_id) || u.id === "USLACKBOT";
  const guest = Boolean(u.is_restricted || u.is_ultra_restricted);
  const deleted = Boolean(u.deleted);
  const base: Omit<DecidedUser, "decision" | "reason" | "accountType" | "role" | "profileId" | "displayName"> = {
    slackUserId: u.id,
    email,
    fullName: names.full,
    timezone: u.tz ?? null,
    imageUrl: u.profile?.image_512 ?? u.profile?.image_192 ?? null,
    deactivated: deleted,
    isBot,
  };

  if (u.id === "USLACKBOT") {
    return { ...base, decision: "skip", reason: "slackbot", accountType: "team", role: "staff", profileId: null, displayName: names.display };
  }

  const linked = ctx.profilesBySlackId.get(u.id) ?? (email ? ctx.profilesByEmail.get(email) : undefined);
  if (linked) {
    return {
      ...base,
      decision: "link",
      reason: ctx.profilesBySlackId.has(u.id) ? "already_linked" : "email_match",
      accountType: "team",
      role: "staff",
      profileId: linked.id,
      displayName: linked.displayName,
    };
  }

  const displayName = uniqueDisplayName(names.display, names.full, u.name ?? "", ctx.takenDisplayNames);
  ctx.takenDisplayNames.add(displayName.toLowerCase());

  if (isBot) {
    return {
      ...base,
      decision: "create_bot",
      reason: "bot",
      accountType: "team",
      role: "staff",
      profileId: null,
      displayName: `${displayName} (Slack app)`.replace(/\s+\(Slack app\)\s+\(Slack app\)$/, " (Slack app)"),
      fullName: `${names.full} (Slack app)`,
      deactivated: true,
    };
  }
  if (guest) {
    return { ...base, decision: "create_customer", reason: deleted ? "guest_deleted" : "guest", accountType: "customer", role: "owner", profileId: null, displayName };
  }
  if (!email) {
    return { ...base, decision: "skip", reason: "no_email", accountType: "team", role: "staff", profileId: null, displayName };
  }
  if (deleted) {
    return { ...base, decision: "create_team", reason: "deleted", accountType: "team", role: "staff", profileId: null, displayName };
  }
  if (!ctx.teamDomains.includes(domainOf(email))) {
    return { ...base, decision: "create_team", reason: "domain_review", accountType: "team", role: "staff", profileId: null, displayName };
  }
  return { ...base, decision: "invite_team", reason: "team_member", accountType: "team", role: "staff", profileId: null, displayName };
}

const AVATAR_HOSTS = /(^|\.)slack-edge\.com$|(^|\.)gravatar\.com$|(^|\.)slack\.com$/;

/** Copies a Slack profile photo into the public avatars bucket. Best effort: null on any failure. */
export async function copyAvatar(admin: Admin, userId: string, imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const u = new URL(imageUrl);
    if (u.protocol !== "https:" || !AVATAR_HOSTS.test(u.hostname)) return null;
    const res = await fetchWithTimeout(imageUrl, {}, 10_000);
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!type.startsWith("image/")) return null;
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > 5 * 1024 * 1024) return null;
    const ext = type === "image/png" ? "png" : type === "image/gif" ? "gif" : type === "image/webp" ? "webp" : "jpg";
    const path = `${userId}/slack.${ext}`;
    const { error } = await admin.storage.from("avatars").upload(path, body, { contentType: type, upsert: true });
    if (error) return null;
    const { data } = admin.storage.from("avatars").getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  } catch {
    return null;
  }
}

export interface ApplyUserResult {
  outcome: "linked" | "invited" | "created" | "updated" | "skipped" | "error";
  profileId: string | null;
  error?: string;
}

/**
 * Carries out one decision. `actor` is the admin's own client (actingUserClient) so the account
 * RPCs' gates apply to a person; `admin` is the service role for the link itself and the photo.
 */
export async function applyUserDecision(
  admin: Admin,
  actor: Admin,
  actorId: string,
  d: DecidedUser,
): Promise<ApplyUserResult> {
  try {
    if (d.decision === "skip") return { outcome: "skipped", profileId: null };

    if (d.decision === "link") {
      if (!d.profileId) return { outcome: "error", profileId: null, error: "nothing to link to" };
      const { error } = await admin.from("profiles").update({ slack_user_id: d.slackUserId }).eq("id", d.profileId);
      if (error) return { outcome: "error", profileId: d.profileId, error: error.message };
      return { outcome: "linked", profileId: d.profileId };
    }

    if (d.decision === "invite_team") {
      if (!d.email) return { outcome: "error", profileId: null, error: "no email" };
      const { data: existing } = await admin.from("profiles").select("id").ilike("email", d.email).maybeSingle();
      if (existing) {
        await admin.from("profiles").update({ slack_user_id: d.slackUserId }).eq("id", existing.id);
        return { outcome: "linked", profileId: existing.id };
      }
      const invited = await createAccountAndInvite(actor, actorId, {
        email: d.email,
        fullName: d.fullName,
        displayName: d.displayName,
        role: "staff",
      });
      const avatar = await copyAvatar(admin, invited.userId, d.imageUrl);
      await admin
        .from("profiles")
        .update({
          slack_user_id: d.slackUserId,
          ...(d.timezone ? { timezone: d.timezone } : {}),
          ...(avatar ? { avatar_url: avatar } : {}),
        })
        .eq("id", invited.userId);
      return {
        outcome: "invited",
        profileId: invited.userId,
        error: invited.emailStatus === "sent" ? undefined : `invite email ${invited.emailStatus}${invited.emailError ? `: ${invited.emailError}` : ""}`,
      };
    }

    // create_customer / create_team / create_bot: dormant, through the RPC.
    const { data: before } = await admin
      .from("profiles")
      .select("id")
      .eq("slack_user_id", d.slackUserId)
      .maybeSingle();
    const { data: userId, error } = await actor.rpc("import_slack_account", {
      p_slack_user_id: d.slackUserId,
      p_email: d.email ?? undefined,
      p_full_name: d.fullName,
      p_display_name: d.displayName,
      p_account_type: d.accountType,
      p_role: d.role,
      p_timezone: d.timezone ?? undefined,
      p_deactivated: d.deactivated,
      p_is_bot: d.isBot,
    });
    if (error || !userId) return { outcome: "error", profileId: null, error: error?.message ?? "no id returned" };
    if (!before) {
      const avatar = await copyAvatar(admin, userId, d.imageUrl);
      if (avatar) await admin.from("profiles").update({ avatar_url: avatar }).eq("id", userId);
    }
    return { outcome: before ? "updated" : "created", profileId: userId };
  } catch (e) {
    return { outcome: "error", profileId: null, error: e instanceof Error ? e.message : String(e) };
  }
}
