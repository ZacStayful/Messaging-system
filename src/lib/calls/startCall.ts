"use server";

import { createClient } from "@/lib/supabase/server";
import type { Call } from "@/lib/database.types";

export interface StartCallResult {
  ok: boolean;
  error?: string;
  call?: Call;
}

/**
 * Creates the `calls` row the browser then dials against.
 *
 * Deliberately thin. `start_call` (0032) already refuses a customer, a conversation the caller is
 * not a member of, another organisation's conversation, a contact with no mobile, a deactivated
 * account, and an organisation with no `voice_numbers` row — and it raises each with a sentence
 * written to be read by a person, which is why they are passed through rather than replaced.
 *
 * Doing the check here instead would mean a second copy of the rules that could drift from the
 * one RLS actually enforces. Same reasoning as `serviceContactActions.ts`: the RPC is the
 * authority, the action is the call site.
 */
export async function startCall(
  conversationId: string,
  toUserId: string,
  parentMessageId: string | null = null,
): Promise<StartCallResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to sign in again." };

  const { data, error } = await supabase.rpc("start_call", {
    p_conversation_id: conversationId,
    p_to_user_id: toUserId,
    p_parent_message_id: parentMessageId,
  });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That call could not be started." };
  // Postgres returns a `returns public.calls` function as the row itself, but PostgREST has been
  // known to wrap a composite in an array; take either rather than depending on which.
  const call = (Array.isArray(data) ? data[0] : data) as Call | undefined;
  if (!call) return { ok: false, error: "That call could not be started." };
  return { ok: true, call };
}
