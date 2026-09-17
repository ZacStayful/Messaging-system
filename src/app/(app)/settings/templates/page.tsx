import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Templates } from "./Templates";

export const metadata: Metadata = { title: "Message templates" };

export default async function TemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (profile.account_type !== "team" || profile.role !== "admin") notFound();

  const { data: templates } = await supabase
    .from("message_templates")
    .select("key, title, description, body, active, updated_at")
    .order("key");

  return <Templates templates={templates ?? []} />;
}
