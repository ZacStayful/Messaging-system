import { notFound } from "next/navigation";
import { isNav } from "@/lib/nav";
import { EmptyPane } from "@/components/conversation/EmptyPane";
import { createClient } from "@/lib/supabase/server";

const CUSTOMER_NAVS = ["home", "dms", "you"];

export default async function NavPage({ params }: { params: Promise<{ nav: string }> }) {
  const { nav } = await params;
  if (!isNav(nav)) notFound();
  if (!CUSTOMER_NAVS.includes(nav)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: me } = user
      ? await supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle()
      : { data: null };
    if (me?.account_type === "customer") notFound();
  }
  return <EmptyPane nav={nav} />;
}
