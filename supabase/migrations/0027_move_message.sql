-- 0027_move_message.sql
-- Filing a message into a thread after the fact.
--
-- messages.parent_id has been immutable since 0011: messages_guard_update raises on any change
-- to it, which is the right default — a reply silently becoming a reply to something else would
-- rewrite a conversation's meaning underneath the people in it.
--
-- But the maintenance strand needs it. A contractor's WhatsApp arrives with no way to tell which
-- of the six properties they look after it concerns, so it lands in the central maintenance
-- channel and a team member files it. Without this that filing is impossible and the holding pen
-- is a dead end.
--
-- The guard is narrowed rather than dropped. parent_id may move only inside move_message below,
-- which is team-only, refuses to cross conversations, and refuses to orphan replies. Everything
-- else about the guard — conversation_id, org_id, sender_id, created_at, kind, un-deleting — is
-- left exactly as it was.
--
-- The flag is the same mechanism 0018 uses for phone writes, and for the same reason: the
-- trigger has no way to know which statement it is running inside. It is transaction-local, set
-- only within the function below, and PostgREST neither exposes set_config nor reuses a
-- transaction between requests, so a client cannot raise it and then update.
create or replace function public.messages_guard_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.conversation_id <> old.conversation_id or new.org_id <> old.org_id
     or new.sender_id is distinct from old.sender_id
     or new.created_at <> old.created_at or new.kind <> old.kind then
    raise exception 'that part of a message cannot be changed';
  end if;
  if new.parent_id is distinct from old.parent_id
     and coalesce(current_setting('app.move_message', true), '') <> 'on' then
    raise exception 'that part of a message cannot be changed';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'deleted messages cannot be restored';
  end if;
  return new;
end $$;
revoke execute on function public.messages_guard_update() from public, anon, authenticated;
-- The trigger itself (0011) is unchanged.

-- ---------------------------------------------------------------------------
-- move_message
-- ---------------------------------------------------------------------------
-- p_parent_id null moves a message back out to the top level, so a mis-filing is as reversible
-- as the filing was.
--
-- reply_count and last_reply_at are recomputed here for both the old and the new parent:
-- messages_thread_bookkeeping (0010) fires on insert and on deleted_at, not on a parent change,
-- so nothing else would notice. The realtime broadcast does fire — its trigger (0003) is
-- `after insert or update or delete` — so open clients see the move without a reload.
create or replace function public.move_message(p_message_id uuid, p_parent_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare m public.messages%rowtype; p public.messages%rowtype; v_old uuid;
begin
  if not public.is_team() then raise exception 'only Stayful team members can move a message'; end if;
  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.org_id <> public.auth_org_id() or not public.is_member(m.conversation_id) then
    raise exception 'not allowed';
  end if;
  if m.deleted_at is not null then raise exception 'that message has been deleted'; end if;
  -- Moving a message that is itself the top of a thread would leave its replies hanging off a
  -- message that is now somewhere else. Refuse rather than quietly drag them along.
  if exists (select 1 from public.messages r where r.parent_id = m.id and r.deleted_at is null) then
    raise exception 'that message has replies of its own; move those first';
  end if;

  if p_parent_id is not null then
    select * into p from public.messages where id = p_parent_id;
    if p.id is null or p.deleted_at is not null then raise exception 'that thread no longer exists'; end if;
    if p.conversation_id <> m.conversation_id then
      raise exception 'a message can only be moved into a thread in the same conversation';
    end if;
    if p.id = m.id then raise exception 'a message cannot be a reply to itself'; end if;
    -- No nested threads, matching messages_check_parent (0011).
    if p.parent_id is not null then raise exception 'pick the top of the thread, not a reply'; end if;
    -- A thread on an internal note stays internal; the reverse would expose it to the customer.
    if p.visibility = 'internal' and m.visibility <> 'internal' then
      raise exception 'that thread is an internal note; the message would become visible to the customer';
    end if;
  end if;

  v_old := m.parent_id;
  if v_old is not distinct from p_parent_id then return; end if;

  perform set_config('app.move_message', 'on', true);
  update public.messages set parent_id = p_parent_id where id = p_message_id;
  perform set_config('app.move_message', '', true);

  -- Both ends of the move, because either may now have a different number of replies.
  update public.messages t
     set reply_count = (select count(*) from public.messages r where r.parent_id = t.id and r.deleted_at is null),
         last_reply_at = (select max(r.created_at) from public.messages r where r.parent_id = t.id and r.deleted_at is null)
   where t.id in (v_old, p_parent_id);

  -- Whoever filed it is following it, so they see what comes back.
  if p_parent_id is not null then
    insert into public.thread_follows (message_id, user_id, org_id, last_read_at)
    values (p_parent_id, auth.uid(), m.org_id, now())
    on conflict (message_id, user_id) do update set last_read_at = excluded.last_read_at;
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (m.org_id, auth.uid(), 'message.moved', 'message', p_message_id::text,
          jsonb_build_object('from', v_old, 'to', p_parent_id, 'conversation_id', m.conversation_id::text));
end $$;
revoke all on function public.move_message(uuid, uuid) from public, anon;
grant execute on function public.move_message(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- file_message_to_property
-- ---------------------------------------------------------------------------
-- move_message deliberately refuses to cross conversations: parent_id means "a reply to", and
-- messages_check_parent (0011) has always required a reply to live in the same conversation as
-- its parent. Relaxing that would let a thread span two groups, which nothing in the app — RLS,
-- unread counts, realtime topics — is built to survive.
--
-- But crossing conversations is exactly what filing the central maintenance inbox means: the
-- message arrived in #maintenance and belongs in some property's Maintenance thread. So it is a
-- copy, not a move, and it says so on both ends:
--   * the copy keeps the original sender, so the thread still shows who actually said it, and
--     carries `filed_from` back to the original
--   * the original is marked `filed_to`, so the inbox can show what has been dealt with and
--     nobody files the same message twice
--
-- The original is left in place rather than deleted. It is the record of what a contractor
-- actually sent us and when, and a filing mistake should be correctable by filing again.
create or replace function public.file_message_to_property(
  p_message_id uuid,
  p_conversation_id uuid,
  p_kind text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.messages%rowtype; c public.conversations%rowtype; v_root uuid; v_new uuid;
begin
  if not public.is_team() then raise exception 'only Stayful team members can file a message'; end if;
  if p_kind not in ('cleaning', 'maintenance') then raise exception 'file it under cleaning or maintenance'; end if;

  select * into m from public.messages where id = p_message_id;
  if m.id is null or m.org_id <> public.auth_org_id() or not public.is_member(m.conversation_id) then
    raise exception 'not allowed';
  end if;
  if m.deleted_at is not null then raise exception 'that message has been deleted'; end if;

  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or c.org_id <> m.org_id or not public.is_member(c.id) then
    raise exception 'not allowed';
  end if;
  if c.archived_at is not null then raise exception 'that property group is archived'; end if;

  select root_message_id into v_root from public.property_threads
   where conversation_id = p_conversation_id and kind = p_kind;
  if v_root is null then raise exception 'that group has no % thread', p_kind; end if;

  -- Same conversation? Then it is a move, not a copy, and move_message is the right tool —
  -- routed here rather than refused, because from the outside they are one action.
  if m.conversation_id = p_conversation_id then
    perform public.move_message(p_message_id, v_root);
    return p_message_id;
  end if;

  insert into public.messages (org_id, conversation_id, sender_id, body, kind, visibility, parent_id, sent_via, meta)
  values (m.org_id, p_conversation_id, m.sender_id, m.body, 'text', m.visibility, v_root, m.sent_via,
          coalesce(m.meta, '{}'::jsonb) || jsonb_build_object(
            'filed_from', p_message_id::text,
            'filed_from_conversation', m.conversation_id::text,
            'filed_by', auth.uid()::text,
            'originally_sent_at', m.created_at))
  returning id into v_new;

  update public.messages
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
           'filed_to', v_new::text, 'filed_to_conversation', p_conversation_id::text)
   where id = p_message_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (m.org_id, auth.uid(), 'message.filed', 'message', p_message_id::text,
          jsonb_build_object('to_conversation', p_conversation_id::text, 'kind', p_kind, 'copy', v_new::text));
  return v_new;
end $$;
revoke all on function public.file_message_to_property(uuid, uuid, text) from public, anon;
grant execute on function public.file_message_to_property(uuid, uuid, text) to authenticated;
