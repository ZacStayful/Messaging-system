import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isNav } from "@/lib/nav";
import { ConversationView, type PinWithMessage } from "@/components/conversation/ConversationView";

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

  const [{ data: conversation }, { data: membership }, { data: messages }, { data: pins }, { data: attachments }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, created_at, topic, description")
        .eq("id", conversationId)
        .maybeSingle(),
      supabase
        .from("conversation_members")
        .select("last_read_at")
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(300),
      supabase
        .from("pins")
        .select("pinned_at, pinned_by, message:messages(*)")
        .eq("conversation_id", conversationId)
        .order("pinned_at", { ascending: false }),
      supabase
        .from("attachments")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false }),
    ]);

  if (!conversation) notFound();

  return (
    <ConversationView
      key={conversationId}
      conversationId={conversationId}
      createdAt={conversation.created_at}
      description={conversation.description}
      initialMessages={messages ?? []}
      pins={(pins ?? []).filter((p): p is PinWithMessage => p.message !== null) as PinWithMessage[]}
      attachments={attachments ?? []}
      lastReadAt={membership?.last_read_at ?? null}
    />
  );
}
