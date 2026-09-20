/**
 * The maps every phase needs: Slack ids → people here, and their display names for @mentions.
 * Built once per slice from slack_users and profiles; bots that post under a bot_id nobody
 * listed are added on first sight (see ensureBotProfile in apply.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

export interface Person {
  profileId: string;
  displayName: string;
  accountType: "team" | "customer";
  isBot: boolean;
  isGuest: boolean;
  deactivated: boolean;
}

export class Directory {
  private readonly bySlackId = new Map<string, Person>();
  /** Slack user id → name even when nobody was created (skipped, no email…), for mention text. */
  private readonly namesBySlackId = new Map<string, string>();
  readonly channelNames = new Map<string, string>();

  add(slackId: string, person: Person): void {
    this.bySlackId.set(slackId, person);
    this.namesBySlackId.set(slackId, person.displayName);
  }
  addName(slackId: string, name: string): void {
    if (!this.namesBySlackId.has(slackId)) this.namesBySlackId.set(slackId, name);
  }
  person(slackId: string): Person | null {
    return this.bySlackId.get(slackId) ?? null;
  }
  profileId(slackId: string): string | null {
    return this.bySlackId.get(slackId)?.profileId ?? null;
  }
  userName(slackId: string): string | null {
    return this.namesBySlackId.get(slackId) ?? null;
  }
  channelName(id: string): string | null {
    return this.channelNames.get(id) ?? null;
  }
  isGuest(slackId: string): boolean {
    return this.bySlackId.get(slackId)?.isGuest ?? false;
  }
  isBot(slackId: string): boolean {
    return this.bySlackId.get(slackId)?.isBot ?? false;
  }
}

export async function loadDirectory(admin: Admin, orgId: string): Promise<Directory> {
  const dir = new Directory();
  const [{ data: users }, { data: profiles }, { data: channels }] = await Promise.all([
    admin
      .from("slack_users")
      .select("slack_user_id, profile_id, resolved_display, display_name, real_name, name, is_bot, is_app_user, is_restricted, is_ultra_restricted, raw")
      .eq("org_id", orgId),
    admin.from("profiles").select("id, display_name, account_type, deactivated_at, slack_user_id").eq("org_id", orgId),
    admin.from("slack_conversations").select("slack_channel_id, name").eq("org_id", orgId),
  ]);
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  for (const u of users ?? []) {
    const fallback = u.resolved_display || u.display_name || u.real_name || u.name || u.slack_user_id;
    dir.addName(u.slack_user_id, fallback);
    const botId = ((u.raw as { profile?: { bot_id?: string } } | null)?.profile?.bot_id ?? "").trim();
    if (botId) dir.addName(botId, fallback);
    const p = u.profile_id ? profileById.get(u.profile_id) : undefined;
    if (!p) continue;
    const person: Person = {
      profileId: p.id,
      displayName: p.display_name,
      accountType: p.account_type,
      isBot: Boolean(u.is_bot || u.is_app_user),
      isGuest: Boolean(u.is_restricted || u.is_ultra_restricted),
      deactivated: Boolean(p.deactivated_at),
    };
    dir.add(u.slack_user_id, person);
    if (botId) dir.add(botId, person);
  }
  // Profiles linked by hand (slack_user_id set) without a slack_users row still resolve.
  for (const p of profiles ?? []) {
    if (p.slack_user_id && !dir.person(p.slack_user_id)) {
      dir.add(p.slack_user_id, {
        profileId: p.id,
        displayName: p.display_name,
        accountType: p.account_type,
        isBot: false,
        isGuest: p.account_type === "customer",
        deactivated: Boolean(p.deactivated_at),
      });
    }
  }
  for (const c of channels ?? []) if (c.name) dir.channelNames.set(c.slack_channel_id, c.name);
  return dir;
}
