import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StoreProvider, type Org } from "@/components/shell/store";
import { loadSidebarState } from "@/lib/sidebar/load";
import { AppShell } from "@/components/shell/AppShell";
import { PhoneGate } from "@/components/onboarding/PhoneGate";
import { shouldAskForPhone } from "@/lib/phone";
import { whatsappConfigured } from "@/lib/whatsapp/timelines";
import { callsConfigured } from "@/lib/twilio/config";

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

  // The same loader the store calls after a reconnect, so what the shell is rendered with and
  // what it recovers to cannot drift apart. The organisation row is not part of it — it has no
  // broadcast, so it cannot go stale while the socket is away.
  const [{ data: org }, sidebar] = await Promise.all([
    supabase.from("organisations").select("id, name, slug, settings").eq("id", me.org_id).single(),
    loadSidebarState(supabase, { orgId: me.org_id, isTeam: me.account_type === "team" }),
  ]);

  return (
    <StoreProvider
      me={me}
      org={(org ?? { id: me.org_id, name: "Stayful", slug: "stayful", settings: {} }) as Org}
      callsEnabled={callsConfigured()}
      profiles={sidebar.profiles}
      conversations={sidebar.conversations}
      activity={sidebar.activity}
      threads={sidebar.threads}
      saved={sidebar.saved}
      sections={sidebar.sections}
      sectionItems={sidebar.sectionItems}
    >
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
