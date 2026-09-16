import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { jwtConfigured } from "@/lib/api/jwt";
import { ApiKeys } from "./ApiKeys";

export const metadata: Metadata = { title: "API and integrations" };

export default async function ApiSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  // Team routes 404 for everyone else in this app; keys are admin-only on top of that.
  if (profile.account_type !== "team" || profile.role !== "admin") notFound();

  const [{ data: keys }, { data: team }] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, key_prefix, scopes, user_id, last_used_at, expires_at, revoked_at, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("account_type", "team")
      .is("deactivated_at", null)
      .order("display_name"),
  ]);

  return <ApiKeys keys={keys ?? []} team={team ?? []} meId={user.id} jwtReady={jwtConfigured()} />;
}
