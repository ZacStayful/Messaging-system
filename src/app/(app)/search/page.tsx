import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SearchResults, type FileHit } from "./SearchResults";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: me } = await supabase.from("profiles").select("account_type").eq("id", user.id).maybeSingle();
  if (me?.account_type !== "team") notFound();

  if (!query) return <SearchResults query="" messages={[]} people={[]} files={[]} />;

  const like = `%${query.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const [{ data: messages }, { data: people }, { data: files }] = await Promise.all([
    supabase.rpc("search_messages", { q: query, max_rows: 60 }),
    supabase
      .from("profiles")
      .select("*")
      .is("deactivated_at", null)
      .or(`display_name.ilike.${like},full_name.ilike.${like},email.ilike.${like}`)
      .order("display_name")
      .limit(20),
    supabase
      .from("attachments")
      .select(
        "id, file_name, mime, size_bytes, created_at, conversation_id, message_id, storage_path, message:messages(sender_id)",
      )
      .ilike("file_name", like)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const fileHits: FileHit[] = (files ?? []).map((f) => ({
    id: f.id,
    file_name: f.file_name,
    mime: f.mime,
    size_bytes: f.size_bytes,
    created_at: f.created_at,
    conversation_id: f.conversation_id,
    message_id: f.message_id,
    storage_path: f.storage_path,
    sender_id: (f.message as { sender_id: string | null } | null)?.sender_id ?? null,
  }));

  return <SearchResults query={query} messages={messages ?? []} people={people ?? []} files={fileHits} />;
}
