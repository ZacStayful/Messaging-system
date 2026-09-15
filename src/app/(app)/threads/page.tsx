import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ThreadsView } from "./ThreadsView";

export const metadata: Metadata = { title: "Threads" };

/** Slack's Threads view: every thread I follow, unread first. Team only. */
export default async function ThreadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle();
  if (me?.account_type !== "team") notFound();
  return <ThreadsView />;
}
