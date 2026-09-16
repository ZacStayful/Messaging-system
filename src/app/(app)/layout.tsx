import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StoreProvider, type Org, type SavedRow } from "@/components/shell/store";
import { AppShell } from "@/components/shell/AppShell";
import { PhoneGate } from "@/components/onboarding/PhoneGate";
import { shouldAskForPhone } from "@/lib/phone";
import { whatsappConfigured } from "@/lib/whatsapp/timelines";

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

  // The mobile number gate. Here rather than in src/proxy.ts because this layout is the single
  // funnel for every authenticated page and has already loaded the profile, so the check costs
  // no extra query — while the proxy holds only an anon client and runs on every request.
  // /login, /auth/* and /api/* sit outside this route group, so sign-out, the auth callback and
  // every webhook keep working while the gate is up.
  //
  // Who it applies to — and whether it applies at all when we cannot send a code — is decided by
  // shouldAskForPhone, so the rule is unit-tested rather than an inline conjunction here.
  if (shouldAskForPhone(me, whatsappConfigured())) return <PhoneGate profile={me} />;

  const isTeam = me.account_type === "team";
  const [
    { data: org },
    { data: conversations },
    { data: profiles },
    { data: activity },
    { data: threads },
    { data: saved },
  ] = await Promise.all([
    supabase.from("organisations").select("id, name, slug, settings").eq("id", me.org_id).single(),
    supabase.rpc("my_conversations"),
    supabase.from("profiles").select("*").eq("org_id", me.org_id).is("deactivated_at", null).order("display_name"),
    supabase.rpc("my_activity"),
    isTeam ? supabase.rpc("my_threads", { max_rows: 100 }) : Promise.resolve({ data: [] }),
    isTeam
      ? supabase.from("saved_items").select("*, message:messages(*)").order("saved_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as SavedRow[] }),
  ]);

  return (
    <StoreProvider
      me={me}
      org={(org ?? { id: me.org_id, name: "Stayful", slug: "stayful", settings: {} }) as Org}
      profiles={profiles ?? []}
      conversations={conversations ?? []}
      activity={activity ?? []}
      threads={threads ?? []}
      saved={(saved ?? []) as SavedRow[]}
    >
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
