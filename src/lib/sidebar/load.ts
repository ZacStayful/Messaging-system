import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityItem,
  ConversationSummary,
  Database,
  Message,
  Profile,
  SavedItem,
  SidebarSection,
  SidebarSectionItem,
  ThreadSummary,
} from "@/lib/database.types";

/** A saved-for-later row with the message it points at (null if since deleted or hidden). */
export type SavedRow = SavedItem & { message: Message | null };

export interface SidebarState {
  conversations: ConversationSummary[];
  activity: ActivityItem[];
  threads: ThreadSummary[];
  saved: SavedRow[];
  sections: SidebarSection[];
  sectionItems: SidebarSectionItem[];
  profiles: Profile[];
  /**
   * At least one query failed, so the rest of this is incomplete rather than empty.
   *
   * It matters because PostgREST resolves `{ data: null, error }` instead of throwing, so an
   * error and "you are in nothing" are the same shape. The server component renders what it got
   * either way — a degraded shell beats an error page — but the recovery path must not: replacing
   * the sidebar with what a failed query returned would turn a blip into a wiped sidebar, which
   * is worse than the stale one recovery exists to fix.
   */
  partial: boolean;
}

/** Matches the store's own cap on the thread list. */
const THREAD_ROWS = 100;
/** Saved items are a working list, not an archive; the sidebar never paginates past this. */
const SAVED_ROWS = 200;

export interface SidebarScope {
  orgId: string;
  /**
   * Threads, saved items and sections are team-only: CustomerSidebar has no section headings for
   * them to sit between, and no threads pane. Passed in rather than derived here so the server
   * and the browser cannot disagree about it — both read `account_type === "team"`.
   */
  isTeam: boolean;
}

/**
 * Everything the app shell holds, in one place.
 *
 * The same shape as src/lib/conversation/load.ts and for the same reason: two callers that must
 * not drift. The server component renders the shell with it, and the browser re-reads it after
 * its websocket drops and reconnects. A second hand-written copy would go stale silently, because
 * the symptom is a wrong unread badge rather than an error.
 *
 * Every query here is plain PostgREST or a `security invoker` RPC under RLS — `my_conversations`,
 * `my_activity` and `my_threads` are all self-scoped through `auth.uid()` and granted only to
 * `authenticated` — so the same code is correct from either side; the caller supplies the client
 * it already has. The organisation row is deliberately not here: it has no broadcast of any kind,
 * so it was never live and cannot go stale over a dropped socket.
 */
export async function loadSidebarState(
  supabase: SupabaseClient<Database>,
  { orgId, isTeam }: SidebarScope,
): Promise<SidebarState> {
  const results = await Promise.all([
    supabase.rpc("my_conversations"),
    supabase.from("profiles").select("*").eq("org_id", orgId).is("deactivated_at", null).order("display_name"),
    supabase.rpc("my_activity"),
    isTeam
      ? supabase.rpc("my_threads", { max_rows: THREAD_ROWS })
      : Promise.resolve({ data: [] as ThreadSummary[], error: null }),
    isTeam
      ? supabase
          .from("saved_items")
          .select("*, message:messages(*)")
          .order("saved_at", { ascending: false })
          .limit(SAVED_ROWS)
      : Promise.resolve({ data: [] as SavedRow[], error: null }),
    isTeam
      ? supabase.from("sidebar_sections").select("*").order("position").order("created_at")
      : Promise.resolve({ data: [] as SidebarSection[], error: null }),
    isTeam
      ? supabase.from("sidebar_section_items").select("*")
      : Promise.resolve({ data: [] as SidebarSectionItem[], error: null }),
  ] as const);

  const [conversations, profiles, activity, threads, saved, sections, sectionItems] = results;
  return {
    conversations: conversations.data ?? [],
    activity: activity.data ?? [],
    threads: threads.data ?? [],
    saved: (saved.data ?? []) as SavedRow[],
    sections: sections.data ?? [],
    sectionItems: sectionItems.data ?? [],
    profiles: profiles.data ?? [],
    partial: results.some((r) => r.error !== null),
  };
}
