import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteCustomerForm } from "./InviteCustomerForm";

export const metadata: Metadata = { title: "Invite customer" };

export default async function NewCustomerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("account_type").eq("id", user.id).single();
  if (me?.account_type !== "team") notFound();

  const { data: groups } = await supabase
    .from("conversations")
    .select("id, name, topic, type")
    .in("type", ["owner", "internal"])
    .is("archived_at", null)
    .order("name");

  return <InviteCustomerForm groups={groups ?? []} />;
}
