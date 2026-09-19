import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, ConversationBookmark, Database, Message, Reaction } from "@/lib/database.types";

/** A pin with its message joined; null-message rows are filtered out before this shape. */
export interface PinWithMessage {
  pinned_at: string;
  pinned_by: string | null;
  message: Message;
}

export interface ConversationState {
  messages: Message[];
  pins: PinWithMessage[];
  attachments: Attachment[];
  bookmarks: ConversationBookmark[];
  reactions: Reaction[];
}

/** The newest N messages are what a conversation opens on, and what recovery re-reads. */
export const MESSAGE_WINDOW = 300;

/**
 * Everything a conversation view holds, in one place.
 *
 * Written to be called from two very different callers: the server component that renders the
 * page, and the browser after its websocket drops and reconnects. Both need the identical set,
 * and the whole point of it living here is that a second hand-written copy would drift — silently,
 * because the symptom is stale state on a client nobody is looking at.
 *
 * Every query is plain PostgREST under RLS with no service-role anything, so the same code is
 * correct from either side; the caller supplies the client it already has.
 */
export async function loadConversationState(
  supabase: SupabaseClient<Database>,
  conversationId: string,
): Promise<ConversationState> {
  const [{ data: messages }, { data: pins }, { data: attachments }, { data: bookmarks }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .is("parent_id", null)
      .order("created_at", { ascending: true })
      .limit(MESSAGE_WINDOW),
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
    // Loaded here so the bookmark bar paints with the first render, not after a flash.
    supabase
      .from("conversation_bookmarks")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  // Reactions are keyed on message_id and have no conversation-scoped index, so they are read
  // for the window we just loaded rather than for the conversation. That also keeps the two
  // consistent: a reaction on a message outside the window has nothing to attach to.
  const ids = (messages ?? []).map((m) => m.id);
  const { data: reactions } = ids.length
    ? await supabase.from("reactions").select("*").in("message_id", ids)
    : { data: [] as Reaction[] };

  return {
    messages: messages ?? [],
    pins: (pins ?? []).filter((p): p is PinWithMessage => p.message !== null) as unknown as PinWithMessage[],
    attachments: attachments ?? [],
    bookmarks: bookmarks ?? [],
    reactions: reactions ?? [],
  };
}
