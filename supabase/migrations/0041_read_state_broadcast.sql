-- Read state across devices.
--
-- Everything else a person does already reaches their other sessions: new messages, membership
-- changes, presence, reactions, pins. Read state did not. Marking a conversation read on a phone
-- left the badge lit on the laptop until that tab was reloaded, or until its socket dropped and
-- recovery re-ran my_conversations -- which derives its counts from last_read_at and so was
-- always right, just never prompted.
--
-- So this is only the push. No new source of truth, no new column: three trigger functions that
-- tell the reader's own private topic that one of their three read markers moved.
--
-- Why triggers rather than a `perform realtime.send` at the end of mark_read(): there is not one
-- writer, there are three. messages_after_insert (0010) moves the mark when you send a top-level
-- message, and the UPDATE policy "members: update own read state" (0029) carries no column list,
-- so a client can PATCH last_read_at directly -- tests/rls.test.ts asserts exactly that, for a
-- customer. A broadcast bolted to the RPC would have been silently blind to both. Hanging it off
-- the table catches every path into the column by construction, including ones added later.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_read_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_last_message_at timestamptz;
begin
  -- Whether anything is still unread is decided here rather than on the client, for two reasons.
  -- Both sides are timestamptz out of one snapshot, where the client would have been comparing
  -- ISO *strings* -- and jsonb_build_object renders timestamptz in the session's TimeZone, so a
  -- payload built by a PostgREST request and one built by the service-role worker need not share
  -- an offset, and "…+01:00" < "…+00:00" lexicographically whatever the instants say. The client
  -- would also have been comparing against whatever its last message_created left in local state.
  --
  -- This can only be conservatively true: last_message_at moves for an internal note a customer
  -- cannot see, and ignores notify_level, both of which my_conversations already reports as a
  -- count of 0. The effect is that we decline to clear a zero. It leaves a badge up until the
  -- next event; it never invents one.
  select c.last_message_at into v_last_message_at
    from public.conversations c where c.id = new.conversation_id;

  perform realtime.send(
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'last_read_at',    new.last_read_at,
      'has_unread',      coalesce(v_last_message_at > new.last_read_at, false)),
    'read_state', 'user:' || new.user_id::text, true);
  return null;
end $$;
revoke execute on function public.broadcast_read_state() from public, anon, authenticated;

-- `after update OF last_read_at` is not decoration: the column must appear in the UPDATE's target
-- list before the WHEN clause is even evaluated, so updateMember()'s {starred|muted|notify_level}
-- PATCH never reaches the function at all.
drop trigger if exists conversation_members_read_broadcast on public.conversation_members;
create trigger conversation_members_read_broadcast
  after update of last_read_at on public.conversation_members
  for each row
  when (old.last_read_at is distinct from new.last_read_at and new.last_read_at is not null)
  execute function public.broadcast_read_state();

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_thread_read_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_last_reply_at timestamptz;
begin
  select m.last_reply_at into v_last_reply_at from public.messages m where m.id = new.message_id;

  perform realtime.send(
    jsonb_build_object(
      'message_id',   new.message_id,
      'last_read_at', new.last_read_at,
      'has_unread',   coalesce(v_last_reply_at > new.last_read_at, false)),
    'thread_read_state', 'user:' || new.user_id::text, true);
  return null;
end $$;
revoke execute on function public.broadcast_thread_read_state() from public, anon, authenticated;

-- Two triggers rather than one `after insert or update`: Postgres refuses a WHEN clause that
-- references OLD on any trigger whose event list includes INSERT, so that shape would not apply
-- at all. The insert arm is not hypothetical either -- mark_thread_read upserts, and reading a
-- thread you were not already following creates the row.
--
-- `new.last_read_at is not null` is what keeps this to reads. messages_thread_bookkeeping (0010)
-- follows the parent's author on every reply with a null mark when they are not the replier, and
-- add_property_contact (0024) inserts a follow with no mark at all. Neither is someone reading
-- anything, and without the guard both would broadcast last_read_at: null -- which the client
-- would dutifully apply, un-reading a thread.
drop trigger if exists thread_follows_read_broadcast_insert on public.thread_follows;
create trigger thread_follows_read_broadcast_insert
  after insert on public.thread_follows
  for each row when (new.last_read_at is not null)
  execute function public.broadcast_thread_read_state();

drop trigger if exists thread_follows_read_broadcast_update on public.thread_follows;
create trigger thread_follows_read_broadcast_update
  after update of last_read_at on public.thread_follows
  for each row
  when (old.last_read_at is distinct from new.last_read_at and new.last_read_at is not null)
  execute function public.broadcast_thread_read_state();

-- ---------------------------------------------------------------------------
-- Activity feed
-- ---------------------------------------------------------------------------
-- Deliberately not a fourteenth branch inside broadcast_profile_changes(): that one publishes to
-- org:<id>, where the whole organisation reads it, and when someone last looked at their own
-- activity feed is nobody else's business. It is also how activity_seen_at came to be missing
-- from that column guard in the first place -- 0012 and 0014 each rewrote the body wholesale, and
-- a third copy is a third chance to drop a line.
create or replace function public.broadcast_activity_seen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('activity_seen_at', new.activity_seen_at),
    'activity_seen', 'user:' || new.id::text, true);
  return null;
end $$;
revoke execute on function public.broadcast_activity_seen() from public, anon, authenticated;

drop trigger if exists profiles_activity_seen_broadcast on public.profiles;
create trigger profiles_activity_seen_broadcast
  after update of activity_seen_at on public.profiles
  for each row
  when (old.activity_seen_at is distinct from new.activity_seen_at
        and new.activity_seen_at is not null)
  execute function public.broadcast_activity_seen();
