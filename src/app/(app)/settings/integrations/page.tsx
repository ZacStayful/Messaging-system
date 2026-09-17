import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientsBoardId, mondayConfigured } from "@/lib/monday/client";
import { MONDAY_INTEGRATION_KEY } from "@/lib/monday/provision";
import { siteUrl } from "@/lib/site";
import { MondayIntegration } from "./MondayIntegration";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  // Team routes 404 for everyone else in this app; the integration is admin-only on top.
  if (profile.account_type !== "team" || profile.role !== "admin") notFound();

  const [{ data: integration }, { data: team }, { data: events }] = await Promise.all([
    supabase.from("integrations").select("enabled, config, updated_at").eq("key", MONDAY_INTEGRATION_KEY).maybeSingle(),
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("account_type", "team")
      .is("deactivated_at", null)
      .order("display_name"),
    supabase
      .from("monday_events")
      .select("id, event_id, item_id, event_type, outcome, error, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const config = (integration?.config ?? {}) as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  return (
    <MondayIntegration
      enabled={Boolean(integration?.enabled)}
      actorUserId={typeof config.actor_user_id === "string" ? config.actor_user_id : ""}
      standardMemberIds={ids(config.standard_member_ids)}
      skipGroupIds={ids(config.skip_group_ids)}
      team={team ?? []}
      events={events ?? []}
      boardId={clientsBoardId()}
      // The path only; the secret is never rendered, so an admin copies the prefix and pastes
      // the token in from wherever it is kept rather than reading it off a screen.
      webhookBase={`${siteUrl()}/api/monday/webhook/`}
      tokenSet={Boolean(process.env.MONDAY_WEBHOOK_TOKEN)}
      apiTokenSet={mondayConfigured()}
    />
  );
}
