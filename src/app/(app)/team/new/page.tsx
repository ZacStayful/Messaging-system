import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteTeamForm } from "./InviteTeamForm";

export const metadata: Metadata = { title: "Add team member" };

export default async function NewTeamMemberPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("account_type, role").eq("id", user.id).single();
  if (me?.account_type !== "team" || me.role !== "admin") notFound();
  return <InviteTeamForm />;
}
