import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PeopleDirectory } from "./PeopleDirectory";

export const metadata: Metadata = { title: "People" };

/** Directory of everyone in the workspace. Team only. */
export default async function PeoplePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle();
  if (me?.account_type !== "team") notFound();
  return <PeopleDirectory />;
}
