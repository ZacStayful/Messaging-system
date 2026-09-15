import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StoreProvider, type Org } from "@/components/shell/store";
import { AppShell } from "@/components/shell/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!me) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-frame p-6 text-ink">
        <div className="max-w-md rounded-[14px] border border-line bg-panel p-7 shadow-[0_12px_40px_rgba(0,0,0,0.35)]">
          <h1 className="text-[20px] font-bold">Your account isn&apos;t set up yet</h1>
          <p className="mt-2 text-[15px] text-muted">
            We couldn&apos;t find a Stayful profile for {user.email}. Ask your Stayful contact to invite you.
          </p>
          <form action="/auth/signout" method="post" className="mt-5">
            <button className="h-11 rounded-lg bg-brand px-4 text-[15px] font-semibold text-white">Sign out</button>
          </form>
        </div>
      </main>
    );
  }

  const [{ data: org }, { data: conversations }, { data: profiles }, { data: activity }] = await Promise.all([
    supabase.from("organisations").select("id, name, slug, settings").eq("id", me.org_id).single(),
    supabase.rpc("my_conversations"),
    supabase.from("profiles").select("*").eq("org_id", me.org_id).is("deactivated_at", null).order("display_name"),
    supabase.rpc("my_activity"),
  ]);

  return (
    <StoreProvider
      me={me}
      org={(org ?? { id: me.org_id, name: "Stayful", slug: "stayful", settings: {} }) as Org}
      profiles={profiles ?? []}
      conversations={conversations ?? []}
      activity={activity ?? []}
    >
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
