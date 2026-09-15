-- 0010_slack_parity.sql
-- Threads, saved items, channel management, notification levels, presence/status fields,
-- team invites, scheduled messages, link previews, avatars bucket, realtime for
-- conversation/membership changes.

-- ---------------------------------------------------------------------------
-- Profiles: status, do-not-disturb, activity read marker, timezone
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists status_emoji text,
  add column if not exists status_expires_at timestamptz,
  add column if not exists dnd_until timestamptz,
  add column if not exists activity_seen_at timestamptz,
  add column if not exists timezone text not null default 'Europe/London';

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_count int not null default 0,
  add column if not exists last_reply_at timestamptz;

create table if not exists public.thread_follows (
  message_id   uuid not null references public.messages (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  org_id       uuid not null references public.organisations (id) on delete cascade,
  last_read_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists thread_follows_user_idx on public.thread_follows (user_id);
create index if not exists thread_follows_org_idx on public.thread_follows (org_id);
alter table public.thread_follows enable row level security;

create policy "thread_follows: own rows"
  on public.thread_follows for select to authenticated
  using (user_id = (select auth.uid()));
create policy "thread_follows: follow visible threads"
  on public.thread_follows for insert to authenticated
  with check (
    user_id = (select auth.uid()) and org_id = (select public.auth_org_id())
    and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id))
  );
create policy "thread_follows: update own"
  on public.thread_follows for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "thread_follows: unfollow"
  on public.thread_follows for delete to authenticated
  using (user_id = (select auth.uid()));

-- Keep reply_count / last_reply_at on the parent and auto-follow author + repliers.
create or replace function public.messages_thread_bookkeeping()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  parent public.messages%rowtype;
begin
  if new.parent_id is null then return null; end if;
  update public.messages p
     set reply_count = (select count(*) from public.messages r where r.parent_id = p.id and r.deleted_at is null),
         last_reply_at = (select max(r.created_at) from public.messages r where r.parent_id = p.id and r.deleted_at is null)
   where p.id = new.parent_id
   returning * into parent;
  if tg_op = 'INSERT' and new.deleted_at is null then
    if parent.sender_id is not null then
      insert into public.thread_follows (message_id, user_id, org_id, last_read_at)
      values (new.parent_id, parent.sender_id, new.org_id, case when parent.sender_id = new.sender_id then new.created_at else null end)
      on conflict do nothing;
    end if;
    if new.sender_id is not null then
      insert into public.thread_follows (message_id, user_id, org_id, last_read_at)
      values (new.parent_id, new.sender_id, new.org_id, new.created_at)
      on conflict (message_id, user_id) do update set last_read_at = excluded.last_read_at;
    end if;
    -- the parent conversation should not count replies as unread in the main timeline;
    -- last_message_at still moves so the conversation floats up (as in Slack's "also send to channel" it does not,
    -- so we deliberately leave last_message_at alone here).
  end if;
  return null;
end $$;
revoke execute on function public.messages_thread_bookkeeping() from public, anon, authenticated;
drop trigger if exists messages_thread_bookkeeping on public.messages;
create trigger messages_thread_bookkeeping
  after insert or update of deleted_at on public.messages
  for each row execute function public.messages_thread_bookkeeping();

-- Replies must stay inside the parent's conversation.
create or replace function public.messages_check_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare pc uuid; pp uuid;
begin
  if new.parent_id is null then return new; end if;
  select conversation_id, parent_id into pc, pp from public.messages where id = new.parent_id;
  if pc is null or pc <> new.conversation_id then
    raise exception 'a reply must belong to the same conversation as its parent';
  end if;
  if pp is not null then
    new.parent_id := pp; -- no nested threads: replies to a reply join the top-level thread
  end if;
  return new;
end $$;
revoke execute on function public.messages_check_parent() from public, anon, authenticated;
drop trigger if exists messages_check_parent on public.messages;
create trigger messages_check_parent
  before insert on public.messages
  for each row execute function public.messages_check_parent();

-- The last message in a conversation should not update on replies (Slack keeps threads out of the channel list)
create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is null then
    update public.conversations
       set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
     where id = new.conversation_id;
  end if;
  -- the sender has read their own message
  if new.sender_id is not null and new.parent_id is null then
    update public.conversation_members
       set last_read_at = greatest(coalesce(last_read_at, new.created_at), new.created_at)
     where conversation_id = new.conversation_id and user_id = new.sender_id;
  end if;
  return null;
end $$;

create or replace function public.mark_thread_read(p_message_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_org uuid; cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select org_id, conversation_id into v_org, cid from public.messages where id = p_message_id;
  if cid is null or not public.is_member(cid) then raise exception 'thread not found'; end if;
  insert into public.thread_follows (message_id, user_id, org_id, last_read_at)
  values (p_message_id, me, v_org, now())
  on conflict (message_id, user_id) do update set last_read_at = now();
end $$;
revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

-- Threads I follow, newest activity first, with unread reply counts.
create or replace function public.my_threads(max_rows int default 50)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz,
  reply_count int,
  last_reply_at timestamptz,
  last_read_at timestamptz,
  unread_count bigint,
  participant_ids uuid[]
)
language sql stable security invoker set search_path = public as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at, m.reply_count, m.last_reply_at, f.last_read_at,
         (select count(*) from public.messages r
           where r.parent_id = m.id and r.deleted_at is null and r.sender_id is distinct from auth.uid()
             and r.created_at > coalesce(f.last_read_at, 'epoch'::timestamptz)
             and (r.visibility = 'public' or public.is_team())) as unread_count,
         (select array_agg(distinct r.sender_id) from public.messages r where r.parent_id = m.id and r.deleted_at is null and r.sender_id is not null) as participant_ids
    from public.thread_follows f
    join public.messages m on m.id = f.message_id
   where f.user_id = auth.uid() and m.deleted_at is null and m.reply_count > 0
   order by m.last_reply_at desc nulls last
   limit greatest(1, least(max_rows, 200))
$$;
revoke all on function public.my_threads(int) from public, anon;
grant execute on function public.my_threads(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Saved for later
-- ---------------------------------------------------------------------------
create table if not exists public.saved_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  message_id   uuid not null references public.messages (id) on delete cascade,
  saved_at     timestamptz not null default now(),
  remind_at    timestamptz,
  reminded_at  timestamptz,
  completed_at timestamptz,
  archived_at  timestamptz,
  unique (user_id, message_id)
);
create index if not exists saved_items_user_idx on public.saved_items (user_id, saved_at desc);
create index if not exists saved_items_remind_idx on public.saved_items (remind_at) where remind_at is not null and reminded_at is null;
create index if not exists saved_items_org_idx on public.saved_items (org_id);
create index if not exists saved_items_message_idx on public.saved_items (message_id);
alter table public.saved_items enable row level security;
create policy "saved: own rows" on public.saved_items for select to authenticated using (user_id = (select auth.uid()));
create policy "saved: save visible messages" on public.saved_items for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id = (select public.auth_org_id())
              and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
create policy "saved: update own" on public.saved_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "saved: remove own" on public.saved_items for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Scheduled messages (posted by the cron worker with the service role)
-- ---------------------------------------------------------------------------
create table if not exists public.scheduled_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  parent_id       uuid references public.messages (id) on delete set null,
  body            text not null,
  visibility      public.message_visibility not null default 'public',
  send_at         timestamptz not null,
  sent_message_id uuid references public.messages (id) on delete set null,
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages (send_at) where sent_message_id is null and cancelled_at is null;
create index if not exists scheduled_messages_sender_idx on public.scheduled_messages (sender_id);
create index if not exists scheduled_messages_org_idx on public.scheduled_messages (org_id);
create index if not exists scheduled_messages_conversation_idx on public.scheduled_messages (conversation_id);
create index if not exists scheduled_messages_parent_idx on public.scheduled_messages (parent_id);
create index if not exists scheduled_messages_sent_idx on public.scheduled_messages (sent_message_id);
alter table public.scheduled_messages enable row level security;
create policy "scheduled: own rows" on public.scheduled_messages for select to authenticated using (sender_id = (select auth.uid()));
create policy "scheduled: schedule in own conversations" on public.scheduled_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and org_id = (select public.auth_org_id()) and public.is_member(conversation_id)
              and (visibility = 'public' or (select public.is_team())));
create policy "scheduled: edit own" on public.scheduled_messages for update to authenticated
  using (sender_id = (select auth.uid())) with check (sender_id = (select auth.uid()));
create policy "scheduled: delete own" on public.scheduled_messages for delete to authenticated using (sender_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Link previews (fetched server-side by /api/unfurl with the service role)
-- ---------------------------------------------------------------------------
create table if not exists public.link_previews (
  url          text primary key,
  title        text,
  description  text,
  image_url    text,
  site_name    text,
  fetched_at   timestamptz not null default now(),
  ok           boolean not null default true
);
alter table public.link_previews enable row level security;
create policy "link_previews: signed-in read" on public.link_previews for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Notification outbox kinds
-- ---------------------------------------------------------------------------
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('welcome', 'message', 'reminder'));

-- ---------------------------------------------------------------------------
-- Channel management RPCs (team only) with system messages and audit rows
-- ---------------------------------------------------------------------------
create or replace function public.channel_system_message(cid uuid, body text, event text, extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from public.conversations where id = cid;
  insert into public.messages (org_id, conversation_id, sender_id, body, kind, meta)
  values (v_org, cid, null, body, 'system', jsonb_build_object('event', event, 'user_id', auth.uid()::text) || extra);
end $$;
revoke execute on function public.channel_system_message(uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.rename_channel(p_conversation_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; v_slug text; my_name text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  if c.type not in ('owner', 'internal', 'job') then raise exception 'direct messages cannot be renamed'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then raise exception 'give the group a name'; end if;
  if exists (select 1 from public.conversations x where x.org_id = c.org_id and x.slug = v_slug and x.id <> c.id and x.archived_at is null) then
    raise exception 'a group called % already exists', v_slug;
  end if;
  update public.conversations set name = v_slug, slug = v_slug where id = c.id;
  select display_name into my_name from public.profiles where id = me;
  perform public.channel_system_message(c.id, format('%s renamed the group from #%s to #%s.', my_name, c.name, v_slug), 'channel_renamed', jsonb_build_object('from', c.name, 'to', v_slug));
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, me, 'channel.renamed', 'conversation', c.id::text, jsonb_build_object('from', c.name, 'to', v_slug));
end $$;
revoke all on function public.rename_channel(uuid, text) from public, anon;
grant execute on function public.rename_channel(uuid, text) to authenticated;

create or replace function public.set_channel_details(p_conversation_id uuid, p_topic text, p_description text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; my_name text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  update public.conversations set topic = nullif(trim(p_topic), ''), description = nullif(trim(p_description), '') where id = c.id;
  select display_name into my_name from public.profiles where id = me;
  if nullif(trim(p_topic), '') is distinct from c.topic then
    perform public.channel_system_message(c.id, format('%s set the topic: %s', my_name, coalesce(nullif(trim(p_topic), ''), '(cleared)')), 'topic_changed', jsonb_build_object('topic', nullif(trim(p_topic), '')));
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, me, 'channel.details', 'conversation', c.id::text, jsonb_build_object('topic', p_topic, 'description', p_description));
end $$;
revoke all on function public.set_channel_details(uuid, text, text) from public, anon;
grant execute on function public.set_channel_details(uuid, text, text) to authenticated;

create or replace function public.archive_channel(p_conversation_id uuid, p_archived boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; my_name text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  if c.type in ('dm', 'group_dm') then raise exception 'direct messages cannot be archived'; end if;
  select display_name into my_name from public.profiles where id = me;
  if p_archived then
    perform public.channel_system_message(c.id, format('%s archived this group.', my_name), 'channel_archived');
    update public.conversations set archived_at = now() where id = c.id;
  else
    update public.conversations set archived_at = null where id = c.id;
    perform public.channel_system_message(c.id, format('%s un-archived this group.', my_name), 'channel_unarchived');
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (c.org_id, me, case when p_archived then 'channel.archived' else 'channel.unarchived' end, 'conversation', c.id::text);
end $$;
revoke all on function public.archive_channel(uuid, boolean) from public, anon;
grant execute on function public.archive_channel(uuid, boolean) to authenticated;

create or replace function public.add_members(p_conversation_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; uid uuid; my_name text; added text[] := '{}';
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  if c.type = 'dm' then raise exception 'start a group message instead'; end if;
  select display_name into my_name from public.profiles where id = me;
  foreach uid in array coalesce(p_user_ids, '{}'::uuid[]) loop
    if exists (select 1 from public.profiles p where p.id = uid and p.org_id = c.org_id and p.deactivated_at is null)
       and not exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = uid) then
      if c.type = 'internal' and (select account_type from public.profiles where id = uid) <> 'team' then
        raise exception 'only Stayful team members can join internal channels';
      end if;
      insert into public.conversation_members (conversation_id, user_id, org_id) values (c.id, uid, c.org_id);
      added := array_append(added, (select display_name from public.profiles where id = uid));
      perform public.channel_system_message(c.id, format('%s has been added to this conversation by %s.', (select coalesce(full_name, display_name) from public.profiles where id = uid), my_name), 'member_joined', jsonb_build_object('user_id', uid::text, 'added_by', me::text));
    end if;
  end loop;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, me, 'channel.members_added', 'conversation', c.id::text, jsonb_build_object('members', to_jsonb(p_user_ids)));
end $$;
revoke all on function public.add_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_member(p_conversation_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c public.conversations%rowtype; my_name text; their_name text;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'not found'; end if;
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
    perform public.channel_system_message(c.id, format('%s was removed by %s.', their_name, my_name), 'member_removed', jsonb_build_object('user_id', p_user_id::text, 'removed_by', me::text));
  end if;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, me, case when p_user_id = me then 'channel.left' else 'channel.member_removed' end, 'conversation', c.id::text, jsonb_build_object('user_id', p_user_id::text));
end $$;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Team accounts (admin only), mirroring create_customer_account
-- ---------------------------------------------------------------------------
create or replace function public.create_team_account(
  p_email text, p_full_name text, p_display_name text, p_password text, p_role public.user_role default 'staff'
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); my_org uuid; v_email text := lower(trim(p_email)); v_uid uuid := gen_random_uuid();
  v_display text := coalesce(nullif(trim(p_display_name), ''), split_part(trim(p_full_name), ' ', 1));
begin
  if me is null or not public.is_admin() then raise exception 'only Stayful admins can add team members'; end if;
  select org_id into my_org from public.profiles where id = me;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email address'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'password must be at least 10 characters'; end if;
  if p_role not in ('staff', 'admin') then raise exception 'team members are staff or admins'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'an account already exists for %', v_email; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email, crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', trim(p_full_name), 'display_name', v_display, 'account_type', 'team', 'role', p_role::text,
                             'org_slug', (select slug from public.organisations where id = my_org), 'invited_by', me::text),
          now(), now(), '', '', '', '', false);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());
  update public.profiles set org_id = my_org, account_type = 'team', role = p_role where id = v_uid;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'team.created', 'profile', v_uid::text, jsonb_build_object('email', v_email, 'role', p_role::text));
  return v_uid;
end $$;
revoke all on function public.create_team_account(text, text, text, text, public.user_role) from public, anon;
grant execute on function public.create_team_account(text, text, text, text, public.user_role) to authenticated;

-- reset_customer_password becomes reset_password: admins may also reset team passwords
create or replace function public.reset_customer_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); target public.profiles%rowtype;
begin
  if me is null or not public.is_team() then raise exception 'only Stayful team members can reset passwords'; end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.org_id <> (select org_id from public.profiles where id = me) then raise exception 'user not found'; end if;
  if target.account_type <> 'customer' and not public.is_admin() then raise exception 'only admins can reset team passwords'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'password must be at least 10 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (target.org_id, me, 'password_reset', 'profile', p_user_id::text);
end $$;

-- ---------------------------------------------------------------------------
-- my_conversations: notify_level, archived rows included, replies excluded from unread/preview
-- ---------------------------------------------------------------------------
drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (
  id uuid, type public.conversation_type, name text, slug text, topic text, description text, is_private boolean,
  owner_user_id uuid, created_at timestamptz, last_message_at timestamptz, archived_at timestamptz,
  muted boolean, starred boolean, notify_level text, last_read_at timestamptz,
  unread_count bigint, mention_count bigint, member_count bigint, member_ids uuid[],
  last_message_body text, last_message_sender_id uuid, last_message_kind public.message_kind
)
language sql stable security invoker set search_path = public as $$
  with me as (select p.id, p.display_name from public.profiles p where p.id = auth.uid())
  select c.id, c.type, c.name, c.slug, c.topic, c.description, c.is_private, c.owner_user_id,
         c.created_at, c.last_message_at, c.archived_at,
         cm.muted, cm.starred, cm.notify_level, cm.last_read_at,
         case when cm.notify_level = 'none' then 0 else
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.deleted_at is null and m.parent_id is null
             and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
             and (m.visibility = 'public' or public.is_team())
             and (cm.notify_level <> 'mentions'
                  or m.meta->'mentions' ? (select id::text from me)
                  or m.body ilike '%@' || (select display_name from me) || '%')) end as unread_count,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.deleted_at is null and m.parent_id is null
             and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
             and (m.visibility = 'public' or public.is_team())
             and (m.meta->'mentions' ? (select id::text from me) or m.body ilike '%@' || (select display_name from me) || '%')) as mention_count,
         (select count(*) from public.conversation_members x where x.conversation_id = c.id) as member_count,
         (select array_agg(x.user_id order by x.joined_at) from public.conversation_members x where x.conversation_id = c.id) as member_ids,
         lm.body, lm.sender_id, lm.kind
    from public.conversations c
    join public.conversation_members cm on cm.conversation_id = c.id and cm.user_id = auth.uid()
    left join lateral (
      select m.body, m.sender_id, m.kind from public.messages m
       where m.conversation_id = c.id and m.deleted_at is null and m.parent_id is null
         and (m.visibility = 'public' or public.is_team())
       order by m.created_at desc limit 1
    ) lm on true
   order by c.last_message_at desc nulls last, c.created_at desc
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- my_activity: mentions, replies to threads I follow, reactions to my messages, new members
-- ---------------------------------------------------------------------------
drop function if exists public.my_activity(timestamptz, int);
create or replace function public.my_activity(since timestamptz default now() - interval '60 days', max_rows int default 80)
returns table (
  message_id uuid, conversation_id uuid, sender_id uuid, kind text, body text, created_at timestamptz, unread boolean,
  parent_id uuid, emoji text
)
language sql stable security invoker set search_path = public as $$
  with me as (select p.id, p.display_name, coalesce(p.activity_seen_at, 'epoch'::timestamptz) as seen from public.profiles p where p.id = auth.uid())
  select * from (
    -- messages in my conversations (top level) and replies to threads I follow
    select m.id as message_id, m.conversation_id, m.sender_id,
           case
             when m.kind = 'system' and m.meta->>'event' = 'member_joined' then 'New member'
             when m.meta->'mentions' ? (select id::text from me) then 'Mention'
             when m.body ilike '%@' || (select display_name from me) || '%' then 'Mention'
             when m.parent_id is not null then 'Reply'
             else 'Message'
           end as kind,
           m.body, m.created_at,
           case when m.parent_id is null
                then m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
                else m.created_at > coalesce((select f.last_read_at from public.thread_follows f where f.message_id = m.parent_id and f.user_id = auth.uid()), 'epoch'::timestamptz)
           end as unread,
           m.parent_id, null::text as emoji
      from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
     where m.created_at > since and m.deleted_at is null
       and m.sender_id is distinct from auth.uid()
       and (m.visibility = 'public' or public.is_team())
       and (m.parent_id is null
            or exists (select 1 from public.thread_follows f where f.message_id = m.parent_id and f.user_id = auth.uid())
            or m.meta->'mentions' ? (select id::text from me))
    union all
    -- reactions to my messages
    select r.message_id, m.conversation_id, r.user_id, 'Reaction', m.body, r.created_at,
           r.created_at > (select seen from me), m.parent_id, r.emoji
      from public.reactions r
      join public.messages m on m.id = r.message_id
     where m.sender_id = auth.uid() and r.user_id <> auth.uid() and r.created_at > since and m.deleted_at is null
  ) x
  order by created_at desc
  limit max_rows
$$;
revoke all on function public.my_activity(timestamptz, int) from public, anon;
grant execute on function public.my_activity(timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifications: replies go to thread followers; parent_id in the light event
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_message_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.messages; member record; sender_name text;
begin
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  if tg_op = 'INSERT' then
    select display_name into sender_name from public.profiles where id = rec.sender_id;
    for member in select user_id from public.conversation_members where conversation_id = rec.conversation_id loop
      perform realtime.send(
        jsonb_build_object('message_id', rec.id, 'conversation_id', rec.conversation_id, 'sender_id', rec.sender_id,
                           'sender_name', sender_name, 'kind', rec.kind, 'visibility', rec.visibility,
                           'preview', left(rec.body, 160), 'created_at', rec.created_at, 'parent_id', rec.parent_id,
                           'mentions', coalesce(rec.meta->'mentions', '[]'::jsonb)),
        'message_created', 'user:' || member.user_id::text, true);
    end loop;
  end if;
  return null;
end $$;

create or replace function public.enqueue_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare conv public.conversations%rowtype; sender_name text; member record;
begin
  if new.visibility <> 'public' or new.kind not in ('text', 'document') or new.deleted_at is not null then return null; end if;
  select * into conv from public.conversations where id = new.conversation_id;
  select display_name into sender_name from public.profiles where id = new.sender_id;
  for member in
    select p.id, p.email, p.display_name
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.conversation_id = new.conversation_id
       and cm.user_id is distinct from new.sender_id
       and cm.muted = false
       and cm.notify_level <> 'none'
       and (cm.notify_level = 'all' or new.meta->'mentions' ? p.id::text or new.parent_id is not null)
       and (new.parent_id is null or exists (select 1 from public.thread_follows f where f.message_id = new.parent_id and f.user_id = p.id))
       and p.account_type = 'customer'
       and p.deactivated_at is null
       and p.email is not null
       and p.email_notifications = 'instant'
       and (p.dnd_until is null or p.dnd_until < now())
  loop
    insert into public.notification_outbox (org_id, kind, recipient_user_id, recipient_email, payload)
    values (new.org_id, 'message', member.id, member.email,
      jsonb_build_object('message_id', new.id, 'conversation_id', new.conversation_id, 'conversation_type', conv.type,
                         'conversation_name', conv.name, 'sender_id', new.sender_id, 'sender_name', coalesce(sender_name, 'Stayful'),
                         'recipient_name', member.display_name, 'body', left(new.body, 2000), 'created_at', new.created_at,
                         'parent_id', new.parent_id));
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: conversation and membership changes wake each member's sidebar
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_conversation_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare member record;
begin
  for member in select user_id from public.conversation_members where conversation_id = new.id loop
    perform realtime.send(jsonb_build_object('conversation_id', new.id, 'event', 'updated'), 'conversation_changed', 'user:' || member.user_id::text, true);
  end loop;
  return null;
end $$;
revoke execute on function public.broadcast_conversation_changes() from public, anon, authenticated;
drop trigger if exists conversations_broadcast on public.conversations;
create trigger conversations_broadcast
  after update of name, topic, description, archived_at on public.conversations
  for each row execute function public.broadcast_conversation_changes();

create or replace function public.broadcast_membership_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.conversation_members; member record;
begin
  rec := coalesce(new, old);
  for member in select user_id from public.conversation_members where conversation_id = rec.conversation_id loop
    perform realtime.send(jsonb_build_object('conversation_id', rec.conversation_id, 'event', lower(tg_op), 'user_id', rec.user_id), 'conversation_changed', 'user:' || member.user_id::text, true);
  end loop;
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('conversation_id', rec.conversation_id, 'event', 'removed', 'user_id', rec.user_id), 'conversation_changed', 'user:' || rec.user_id::text, true);
  end if;
  return null;
end $$;
revoke execute on function public.broadcast_membership_changes() from public, anon, authenticated;
drop trigger if exists conversation_members_broadcast on public.conversation_members;
create trigger conversation_members_broadcast
  after insert or delete on public.conversation_members
  for each row execute function public.broadcast_membership_changes();

-- Profiles: status/presence changes are visible to the whole org via the presence topic payload,
-- so no DB broadcast is needed; the client re-reads profiles on focus.

-- ---------------------------------------------------------------------------
-- Avatars bucket: public read, owners manage their own folder <user_id>/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;
create policy "avatars: public read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "avatars: update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = (select auth.uid())::text);

-- Members may see each other's saved/scheduled? No: private. Team may read scheduled_messages of nobody else.

-- ---------------------------------------------------------------------------
-- dm_between: customers may message anyone they share a group with (team or owner)
-- ---------------------------------------------------------------------------
create or replace function public.dm_between(other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); my_org uuid; their_org uuid; me_team boolean; cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select org_id, account_type = 'team' into my_org, me_team from public.profiles where id = me;
  select org_id into their_org from public.profiles where id = other and deactivated_at is null;
  if their_org is null or their_org <> my_org then raise exception 'user not found'; end if;
  if not me_team and other <> me and not public.shares_conversation_with(other) then
    raise exception 'you can only message people in your groups';
  end if;
  select c.id into cid
    from public.conversations c
   where c.org_id = my_org and c.type = 'dm'
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = me)
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = other)
     and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = case when me = other then 1 else 2 end
   limit 1;
  if cid is null then
    insert into public.conversations (org_id, type, is_private, created_by) values (my_org, 'dm', true, me) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id, org_id) values (cid, me, my_org) on conflict do nothing;
    if other <> me then
      insert into public.conversation_members (conversation_id, user_id, org_id) values (cid, other, my_org) on conflict do nothing;
    end if;
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id) values (my_org, me, 'dm.created', 'conversation', cid::text);
  end if;
  return cid;
end $$;
