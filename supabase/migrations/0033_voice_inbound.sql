-- 0033_voice_inbound.sql
-- A ring-back becomes a voicemail in the thread.
--
-- Ofcom has required since May 2023 that a caller ID be valid, dialable and uniquely
-- identifying, so the number Stayful calls from has to answer when it is rung back — and it
-- will be, by cleaners returning a missed call as much as by cold callers. A number that looks
-- like a real line and behaves like a disconnected one is worse than not publishing one.

-- ---------------------------------------------------------------------------
-- inbound_messages_unmatched now takes voice
-- ---------------------------------------------------------------------------
-- A voicemail from a number we cannot place goes exactly where an unroutable WhatsApp goes.
-- That is the whole change here: the column is plain text behind a CHECK (0020), and the CHECK
-- knows only the two channels that existed when it was written.
--
-- Worth stating why a stranger's voicemail is stored at all rather than refused at the door: a
-- cleaner ringing from a partner's handset, or a contractor from the office landline, is
-- indistinguishable at this point from a wrong number. `profiles.phone` is `+447…` only, so a
-- landline can never resolve to a person no matter who is holding it — turning those away would
-- mean turning away real contacts to avoid storing spam.
alter table public.inbound_messages_unmatched
  drop constraint if exists inbound_messages_unmatched_channel_check;
alter table public.inbound_messages_unmatched
  add constraint inbound_messages_unmatched_channel_check
  check (channel in ('whatsapp', 'email', 'voice'));

-- ---------------------------------------------------------------------------
-- One voicemail per recording
-- ---------------------------------------------------------------------------
-- The third of these, after email (0007) and WhatsApp (0020), and deliberately identical in
-- shape: Twilio retries a callback it thinks failed, and a redelivered recording must be one
-- message in the thread rather than two. The RecordingSid goes in external_ref.
create unique index if not exists messages_external_ref_voice_idx
  on public.messages (external_ref) where sent_via = 'voice' and external_ref is not null;

-- ---------------------------------------------------------------------------
-- A mutable search_path, tidied in passing
-- ---------------------------------------------------------------------------
-- Flagged by the Supabase linter since 0029. Nothing is exploitable through it — the body is a
-- regex and a substring over the topic string, touching no table — but it is read inside an RLS
-- policy on realtime.messages, and a function that decides access has no business resolving its
-- own operators against whatever search_path the caller happens to have set.
create or replace function public.topic_internal_conversation_id(topic text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when topic ~ '^conversation-internal:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(topic from 23)::uuid
    else null
  end
$$;
revoke all on function public.topic_internal_conversation_id(text) from public, anon;
grant execute on function public.topic_internal_conversation_id(text) to authenticated;
