-- 0011_thread_fixes.sql
-- A reply may only be added to a parent the sender can actually read: not deleted, and not an
-- internal note when the sender is a customer. The check trigger is SECURITY DEFINER, so it has
-- to enforce this itself rather than relying on RLS.
create or replace function public.messages_check_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare pc uuid; pp uuid; pv public.message_visibility; pd timestamptz;
begin
  if new.parent_id is null then return new; end if;
  select conversation_id, parent_id, visibility, deleted_at into pc, pp, pv, pd
    from public.messages where id = new.parent_id;
  if pc is null or pc <> new.conversation_id then
    raise exception 'a reply must belong to the same conversation as its parent';
  end if;
  if pd is not null then
    raise exception 'that message has been deleted';
  end if;
  if pv = 'internal' then
    if not public.is_team() then
      raise exception 'you cannot reply to that message';
    end if;
    new.visibility := 'internal'; -- a thread on an internal note stays internal
  end if;
  if pp is not null then
    new.parent_id := pp; -- no nested threads: replies to a reply join the top-level thread
  end if;
  return new;
end $$;
revoke execute on function public.messages_check_parent() from public, anon, authenticated;

-- The update policy's WITH CHECK used to look the row up in messages itself, which Postgres
-- rejects as "infinite recursion detected in policy" once triggers touch the table again.
-- Guard the immutable columns in a trigger instead.
alter policy "messages: edit own (customers within 15 minutes)" on public.messages
  with check (
    org_id = (select public.auth_org_id())
    and sender_id = (select auth.uid())
    and public.is_member(conversation_id)
  );

create or replace function public.messages_guard_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.conversation_id <> old.conversation_id or new.org_id <> old.org_id
     or new.sender_id is distinct from old.sender_id or new.parent_id is distinct from old.parent_id
     or new.created_at <> old.created_at or new.kind <> old.kind then
    raise exception 'that part of a message cannot be changed';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'deleted messages cannot be restored';
  end if;
  return new;
end $$;
revoke execute on function public.messages_guard_update() from public, anon, authenticated;
drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update
  before update on public.messages
  for each row execute function public.messages_guard_update();
