-- 0030_tenant_and_audit_fixes.sql
-- The rest of the audit: three cross-tenant reads, one missing org check, and a column the
-- message guard forgot, which together let an edit erase the evidence it happened.

-- ---------------------------------------------------------------------------
-- 1. The link-preview cache was readable by everyone, in every organisation
-- ---------------------------------------------------------------------------
-- `link_previews: signed-in read` was `using (true)` on a table keyed only on url, so any
-- signed-in account could read every preview any organisation had ever fetched — which is a
-- list of the links they post, with titles. A Google Doc's title is often the whole story.
--
-- Scoped rather than emptied: the cache is worth keeping, it just belongs to one tenant at a
-- time. Existing rows have no owner and cannot be attributed after the fact, so they go; the
-- cache refills on its own and holds nothing that is not re-fetchable.
alter table public.link_previews add column if not exists org_id uuid references public.organisations (id) on delete cascade;
delete from public.link_previews where org_id is null;
alter table public.link_previews alter column org_id set not null;

-- The primary key was `url` alone, which would have made one org's cached copy the other's.
alter table public.link_previews drop constraint if exists link_previews_pkey;
alter table public.link_previews add primary key (org_id, url);

drop policy if exists "link_previews: signed-in read" on public.link_previews;
create policy "link_previews: members of the org read"
  on public.link_previews for select to authenticated
  using (org_id = (select public.auth_org_id()));

-- ---------------------------------------------------------------------------
-- 2. remove_member trusted an admin about a conversation in another organisation
-- ---------------------------------------------------------------------------
-- The guard reads `is_team() and (is_member(c.id) or is_admin())`. The is_member arm implies
-- the same organisation; the is_admin arm does not, and this is SECURITY DEFINER, so the org
-- predicate on the table policy never runs. An admin of org A who knew a conversation id in
-- org B could delete a membership there, drop that person's thread follows, post a system
-- message into B's conversation and write an audit row under B's org_id with an A actor.
--
-- Same shape as the three 0028 closed, found in the same sweep. Only the guard changes; the
-- rest of the function is as it was.
create or replace function public.remove_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; my_name text; their_name text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'not found'; end if;
  -- Whatever else is true, the conversation has to be in the caller's own organisation.
  if c.org_id is distinct from (select public.auth_org_id()) then raise exception 'not found'; end if;
  if p_user_id = me then
    -- leaving
    if not public.is_member(c.id) then raise exception 'not a member'; end if;
    if c.type = 'dm' then raise exception 'direct messages cannot be left'; end if;
    if not public.is_team() then raise exception 'ask the Stayful team to remove you from this group'; end if;
  else
    if not public.is_team() or not (public.is_member(c.id) or public.is_admin()) then raise exception 'not allowed'; end if;
    if c.type in ('dm', 'group_dm') then raise exception 'people cannot be removed from direct messages'; end if;
  end if;
  select display_name into my_name from public.profiles where id = me;
  select coalesce(full_name, display_name) into their_name from public.profiles where id = p_user_id;
  delete from public.conversation_members where conversation_id = c.id and user_id = p_user_id;
  delete from public.thread_follows f using public.messages m where f.message_id = m.id and m.conversation_id = c.id and f.user_id = p_user_id;
  if p_user_id = me then
    perform public.channel_system_message(c.id, format('%s left the conversation.', my_name), 'member_left', jsonb_build_object('user_id', me::text));
  else
    perform public.channel_system_message(c.id, format('%s was removed by %s.', their_name, my_name), 'member_removed',
                                          jsonb_build_object('user_id', p_user_id::text, 'by', me::text));
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, me, case when p_user_id = me then 'conversation.left' else 'member.removed' end,
          'conversation', c.id::text, jsonb_build_object('user_id', p_user_id::text));
end $$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. "(edited)" could be erased, and a message re-labelled as having come from WhatsApp
-- ---------------------------------------------------------------------------
-- messages_guard_update lists the columns a client may not change. edited_at was not on it, and
-- the trigger that stamps edited_at only fires when body actually changes. Two requests —
-- one to edit, one to write edited_at back to null — left a rewritten message looking original.
-- Team members have no edit window at all, so this was the one audit trail on what was said to
-- a customer.
--
-- sent_via and external_ref join it: both describe where a message came from, and a message
-- that can be re-labelled 'whatsapp' is a message that can be blamed on the customer. Nothing
-- updates either after insert, so they are simply frozen.
--
-- edited_at cannot be frozen the same way, because something does write it. Postgres fires
-- BEFORE ROW triggers in alphabetical order by name, so messages_before_update (0001) runs
-- first and stamps edited_at, and this guard then sees a value that has already changed.
-- Freezing it outright would reject every legitimate edit.
--
-- The rule that separates the two is what the stamping trigger keys on: edited_at may move only
-- when the body moved with it. The attack was an update that changed *nothing else* and wrote
-- edited_at back to null — body unchanged, so the stamping trigger never fired and the null
-- passed straight through. Changing the body and nulling edited_at in one request was already
-- harmless: the stamping trigger runs first and overwrites the null with now().
--
-- reply_count and last_reply_at are deliberately NOT guarded: messages_thread_bookkeeping (0010)
-- updates them on the parent row from inside the replier's own transaction, where auth.uid() is
-- the replier, so guarding them would break replying.
create or replace function public.messages_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     and coalesce(current_setting('app.move_message', true), '') <> 'on' then
    raise exception 'a message cannot be moved between conversations';
  end if;
  if new.parent_id is distinct from old.parent_id
     and coalesce(current_setting('app.move_message', true), '') <> 'on' then
    raise exception 'a message cannot be re-parented';
  end if;
  if new.org_id is distinct from old.org_id
     or new.sender_id is distinct from old.sender_id
     or new.created_at is distinct from old.created_at
     or new.kind is distinct from old.kind then
    raise exception 'that field cannot be changed';
  end if;
  if auth.uid() is not null
     and (new.sent_via is distinct from old.sent_via or new.external_ref is distinct from old.external_ref) then
    raise exception 'where a message came from cannot be changed';
  end if;
  if auth.uid() is not null
     and new.edited_at is distinct from old.edited_at
     and new.body is not distinct from old.body
     and new.body_json is not distinct from old.body_json then
    raise exception 'the edited marker cannot be changed on its own';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Two tables of tenant data with no tenant predicate
-- ---------------------------------------------------------------------------
-- monday_events.payload holds the raw Monday item — client names, property addresses — and
-- inbound_messages_unmatched holds the body and phone number of every inbound WhatsApp or email
-- that failed to route. Neither table had an org_id, and both policies asked only "are you
-- team?" / "are you an admin?", which is true of staff in every organisation.
--
-- Latent while one organisation exists, which is why it reads as a style point and is not one:
-- the second tenant turns both into a cross-tenant read with no code change.
alter table public.monday_events add column if not exists org_id uuid references public.organisations (id) on delete cascade;
alter table public.inbound_messages_unmatched add column if not exists org_id uuid references public.organisations (id) on delete cascade;

-- Which organisation a row belongs to when nothing says. Both tables are written by webhooks,
-- and inbound_messages_unmatched is written precisely when the sender could NOT be identified —
-- so at that moment there is often no org to attribute it to. A null would satisfy the column
-- and hide the row from every policy below, which defeats the point of the table: it exists so
-- somebody finds out. The default org is where a human can actually see it.
--
-- Left as a default rather than threaded through the call sites because the call sites genuinely
-- do not know. When a second organisation exists this needs revisiting: an unroutable message
-- should be attributed by the number or address it arrived on, not by a fallback.
create or replace function public.default_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.organisations where coalesce((settings->>'default')::boolean, false) order by created_at limit 1),
    (select id from public.organisations order by created_at limit 1)
  )
$$;
revoke all on function public.default_org_id() from public, anon, authenticated;
-- The webhooks insert as the service role, and these two tables evaluate this as a column
-- default, so that role has to be able to run it. Nobody signed in needs it.
grant execute on function public.default_org_id() to service_role;

-- Existing rows predate the column, and there is one organisation today.
update public.monday_events set org_id = public.default_org_id() where org_id is null;
update public.inbound_messages_unmatched set org_id = public.default_org_id() where org_id is null;

alter table public.monday_events alter column org_id set default public.default_org_id();
alter table public.inbound_messages_unmatched alter column org_id set default public.default_org_id();

create index if not exists monday_events_org_idx on public.monday_events (org_id);
create index if not exists inbound_unmatched_org_idx on public.inbound_messages_unmatched (org_id);

drop policy if exists "monday events: team reads" on public.monday_events;
create policy "monday events: team reads"
  on public.monday_events for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

drop policy if exists "inbound unmatched: admins read" on public.inbound_messages_unmatched;
create policy "inbound unmatched: admins read"
  on public.inbound_messages_unmatched for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()));
