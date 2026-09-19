import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isNav } from "@/lib/nav";
import { loadConversationState } from "@/lib/conversation/load";
import { ConversationView } from "@/components/conversation/ConversationView";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ nav: string; conversationId: string }>;
}) {
  const { nav, conversationId } = await params;
  if (!isNav(nav) || !UUID_RE.test(conversationId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // The conversation's contents come from loadConversationState, which the client calls too after
  // a dropped socket. One definition, so the first paint and the recovery cannot disagree.
  const [{ data: conversation }, { data: membership }, state] = await Promise.all([
    supabase.from("conversations").select("id, created_at, topic, description").eq("id", conversationId).maybeSingle(),
    supabase
      .from("conversation_members")
      .select("last_read_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle(),
    loadConversationState(supabase, conversationId),
  ]);

  if (!conversation) notFound();

  return (
    <ConversationView
      key={conversationId}
      conversationId={conversationId}
      createdAt={conversation.created_at}
      description={conversation.description}
      initialMessages={state.messages}
      pins={state.pins}
      attachments={state.attachments}
      bookmarks={state.bookmarks}
      reactions={state.reactions}
      lastReadAt={membership?.last_read_at ?? null}
    />
  );
}
