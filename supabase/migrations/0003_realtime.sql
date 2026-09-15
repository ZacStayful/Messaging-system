-- 0003_realtime.sql
-- Realtime Broadcast from the database (spec 5.1): full message rows go out on
-- a per-conversation topic, and a light "activity" event goes to each member's
-- personal topic so sidebars can update unread counts without N subscriptions.

create or replace function public.broadcast_message_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec public.messages;
  member record;
  sender_name text;
begin
  rec := coalesce(new, old);

  -- 1. Full row to the conversation topic (members subscribe with private: true)
  perform realtime.broadcast_changes(
    'conversation:' || rec.conversation_id::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );

  -- 2. Light event to each member's personal topic
  if tg_op = 'INSERT' then
    select display_name into sender_name from public.profiles where id = rec.sender_id;
    for member in
      select user_id from public.conversation_members where conversation_id = rec.conversation_id
    loop
      perform realtime.send(
        jsonb_build_object(
          'message_id', rec.id,
          'conversation_id', rec.conversation_id,
          'sender_id', rec.sender_id,
          'sender_name', sender_name,
          'kind', rec.kind,
          'visibility', rec.visibility,
          'preview', left(rec.body, 160),
          'created_at', rec.created_at
        ),
        'message_created',
        'user:' || member.user_id::text,
        true
      );
    end loop;
  end if;

  return null;
end $$;

create trigger messages_broadcast
  after insert or update or delete on public.messages
  for each row execute function public.broadcast_message_changes();

-- ---------------------------------------------------------------------------
-- Authorisation for private channels (realtime.messages RLS)
-- ---------------------------------------------------------------------------
create or replace function public.topic_conversation_id(topic text)
returns uuid language sql immutable as $$
  select case
    when topic ~ '^conversation:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(topic from 14)::uuid
    else null
  end
$$;

-- Receive: message broadcasts + typing/presence on conversations I belong to
create policy "realtime: members receive conversation events"
  on realtime.messages for select to authenticated
  using (
    public.topic_conversation_id(realtime.topic()) is not null
    and public.is_member(public.topic_conversation_id(realtime.topic()))
  );

-- Send: typing indicators and presence on conversations I belong to
create policy "realtime: members send conversation events"
  on realtime.messages for insert to authenticated
  with check (
    public.topic_conversation_id(realtime.topic()) is not null
    and public.is_member(public.topic_conversation_id(realtime.topic()))
  );

-- Personal topic: only the user themselves
create policy "realtime: own user topic"
  on realtime.messages for select to authenticated
  using (realtime.topic() = 'user:' || auth.uid()::text);

-- Org presence topic: everyone in the org can track and read presence
create policy "realtime: org presence receive"
  on realtime.messages for select to authenticated
  using (realtime.topic() = 'org:' || public.auth_org_id()::text);

create policy "realtime: org presence send"
  on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'org:' || public.auth_org_id()::text);
