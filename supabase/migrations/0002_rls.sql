-- 0002_rls.sql
-- Row Level Security. Every permission rule lives here, not in the UI (spec 3.10, 4.4).

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies never recurse into RLS)
-- ---------------------------------------------------------------------------
create or replace function public.auth_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select account_type = 'team' and deactivated_at is null from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select account_type = 'team' and role = 'admin' and deactivated_at is null from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = cid and user_id = auth.uid()
  )
$$;

-- Two users share at least one conversation
create or replace function public.shares_conversation_with(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.conversation_members a
      join public.conversation_members b on a.conversation_id = b.conversation_id
     where a.user_id = auth.uid() and b.user_id = other
  )
$$;

revoke all on function public.auth_org_id() from public;
revoke all on function public.is_team() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_member(uuid) from public;
revoke all on function public.shares_conversation_with(uuid) from public;
grant execute on function public.auth_org_id() to authenticated;
grant execute on function public.is_team() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_conversation_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.organisations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.attachments          enable row level security;
alter table public.pins                 enable row level security;
alter table public.reactions            enable row level security;
alter table public.audit_log            enable row level security;

-- ---------------------------------------------------------------------------
-- organisations
-- ---------------------------------------------------------------------------
create policy "org: members read their org"
  on public.organisations for select to authenticated
  using (id = public.auth_org_id());

create policy "org: admins update settings"
  on public.organisations for update to authenticated
  using (id = public.auth_org_id() and public.is_admin())
  with check (id = public.auth_org_id());

-- ---------------------------------------------------------------------------
-- profiles
-- Team sees everyone in the org. Customers see only people they share a
-- conversation with (their own group, its team members, co-owners) (D13).
-- ---------------------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles: team reads org"
  on public.profiles for select to authenticated
  using (org_id = public.auth_org_id() and public.is_team());

create policy "profiles: customers read shared"
  on public.profiles for select to authenticated
  using (org_id = public.auth_org_id() and public.shares_conversation_with(id));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and org_id = public.auth_org_id()
    -- nobody promotes themselves; account_type/role changes are admin-only (later migration)
    and account_type = (select account_type from public.profiles p where p.id = auth.uid())
    and role = (select role from public.profiles p where p.id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create policy "conversations: members read"
  on public.conversations for select to authenticated
  using (org_id = public.auth_org_id() and public.is_member(id));

create policy "conversations: team creates"
  on public.conversations for insert to authenticated
  with check (org_id = public.auth_org_id() and public.is_team() and created_by = auth.uid());

create policy "conversations: team members update"
  on public.conversations for update to authenticated
  using (org_id = public.auth_org_id() and public.is_team() and public.is_member(id))
  with check (org_id = public.auth_org_id());

-- no delete policy: archive instead

-- ---------------------------------------------------------------------------
-- conversation_members
-- ---------------------------------------------------------------------------
create policy "members: members read membership"
  on public.conversation_members for select to authenticated
  using (org_id = public.auth_org_id() and public.is_member(conversation_id));

create policy "members: team adds people"
  on public.conversation_members for insert to authenticated
  with check (
    org_id = public.auth_org_id()
    and public.is_team()
    and (public.is_member(conversation_id) or public.is_admin()
         -- creator adds the first members of a brand-new conversation
         or exists (select 1 from public.conversations c where c.id = conversation_id and c.created_by = auth.uid()))
  );

create policy "members: update own read state"
  on public.conversation_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and org_id = public.auth_org_id());

create policy "members: team removes people"
  on public.conversation_members for delete to authenticated
  using (org_id = public.auth_org_id() and public.is_team() and (public.is_member(conversation_id) or public.is_admin()));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create policy "messages: members read (internal notes team-only)"
  on public.messages for select to authenticated
  using (
    org_id = public.auth_org_id()
    and public.is_member(conversation_id)
    and (visibility = 'public' or public.is_team())
  );

create policy "messages: members post as themselves"
  on public.messages for insert to authenticated
  with check (
    org_id = public.auth_org_id()
    and public.is_member(conversation_id)
    and sender_id = auth.uid()
    and kind in ('text', 'document')
    and (visibility = 'public' or public.is_team())
  );

create policy "messages: edit own (customers within 15 minutes)"
  on public.messages for update to authenticated
  using (
    org_id = public.auth_org_id()
    and sender_id = auth.uid()
    and (public.is_team() or created_at > now() - interval '15 minutes')
  )
  with check (
    org_id = public.auth_org_id()
    and sender_id = auth.uid()
    and conversation_id = (select m.conversation_id from public.messages m where m.id = messages.id)
  );

-- no hard delete: set deleted_at through the update policy

-- ---------------------------------------------------------------------------
-- attachments, pins, reactions
-- ---------------------------------------------------------------------------
create policy "attachments: members read"
  on public.attachments for select to authenticated
  using (org_id = public.auth_org_id() and public.is_member(conversation_id));

create policy "attachments: members attach to own messages"
  on public.attachments for insert to authenticated
  with check (
    org_id = public.auth_org_id()
    and public.is_member(conversation_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid() and m.conversation_id = attachments.conversation_id)
  );

create policy "pins: members read"
  on public.pins for select to authenticated
  using (org_id = public.auth_org_id() and public.is_member(conversation_id));

create policy "pins: members pin"
  on public.pins for insert to authenticated
  with check (org_id = public.auth_org_id() and public.is_member(conversation_id) and pinned_by = auth.uid());

create policy "pins: members unpin"
  on public.pins for delete to authenticated
  using (org_id = public.auth_org_id() and public.is_member(conversation_id));

create policy "reactions: members read"
  on public.reactions for select to authenticated
  using (org_id = public.auth_org_id() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));

create policy "reactions: react as yourself"
  on public.reactions for insert to authenticated
  with check (org_id = public.auth_org_id() and user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));

create policy "reactions: remove own"
  on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create policy "audit: anyone records their own actions"
  on public.audit_log for insert to authenticated
  with check (org_id = public.auth_org_id() and actor_id = auth.uid());

create policy "audit: admins read"
  on public.audit_log for select to authenticated
  using (org_id = public.auth_org_id() and public.is_admin());

-- ---------------------------------------------------------------------------
-- RPCs used by the UI
-- ---------------------------------------------------------------------------

-- Mark a conversation read up to now.
create or replace function public.mark_read(cid uuid)
returns void language sql security invoker set search_path = public as $$
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = cid and user_id = auth.uid();
$$;
grant execute on function public.mark_read(uuid) to authenticated;

-- Find or create the DM between the caller and another user.
-- D14 (later): customers may only DM team members who share a group with them.
create or replace function public.dm_between(other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me       uuid := auth.uid();
  my_org   uuid;
  their_org uuid;
  me_team  boolean;
  they_team boolean;
  cid      uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select org_id, account_type = 'team' into my_org, me_team from public.profiles where id = me;
  select org_id, account_type = 'team' into their_org, they_team from public.profiles where id = other;
  if their_org is null or their_org <> my_org then
    raise exception 'user not found';
  end if;
  -- customers can only DM team members they share a conversation with (D13/D14)
  if not me_team then
    if not they_team or not public.shares_conversation_with(other) then
      raise exception 'you can only message Stayful team members in your group';
    end if;
  end if;

  select c.id into cid
    from public.conversations c
   where c.org_id = my_org and c.type = 'dm'
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = me)
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = other)
     and (select count(*) from public.conversation_members m where m.conversation_id = c.id) = case when me = other then 1 else 2 end
   limit 1;

  if cid is null then
    insert into public.conversations (org_id, type, is_private, created_by)
    values (my_org, 'dm', true, me)
    returning id into cid;
    insert into public.conversation_members (conversation_id, user_id, org_id)
    values (cid, me, my_org)
    on conflict do nothing;
    if other <> me then
      insert into public.conversation_members (conversation_id, user_id, org_id)
      values (cid, other, my_org)
      on conflict do nothing;
    end if;
    insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
    values (my_org, me, 'dm.created', 'conversation', cid::text);
  end if;
  return cid;
end $$;
revoke all on function public.dm_between(uuid) from public;
grant execute on function public.dm_between(uuid) to authenticated;

-- Everything the sidebar needs in one round trip.
create or replace function public.my_conversations()
returns table (
  id uuid,
  type public.conversation_type,
  name text,
  slug text,
  topic text,
  description text,
  is_private boolean,
  owner_user_id uuid,
  created_at timestamptz,
  last_message_at timestamptz,
  archived_at timestamptz,
  muted boolean,
  starred boolean,
  last_read_at timestamptz,
  unread_count bigint,
  member_count bigint,
  member_ids uuid[],
  last_message_body text,
  last_message_sender_id uuid,
  last_message_kind public.message_kind
)
language sql stable security invoker set search_path = public as $$
  select c.id, c.type, c.name, c.slug, c.topic, c.description, c.is_private, c.owner_user_id,
         c.created_at, c.last_message_at, c.archived_at,
         cm.muted, cm.starred, cm.last_read_at,
         (select count(*) from public.messages m
           where m.conversation_id = c.id
             and m.deleted_at is null
             and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)
             and (m.visibility = 'public' or public.is_team())) as unread_count,
         (select count(*) from public.conversation_members x where x.conversation_id = c.id) as member_count,
         (select array_agg(x.user_id order by x.joined_at) from public.conversation_members x where x.conversation_id = c.id) as member_ids,
         lm.body, lm.sender_id, lm.kind
    from public.conversations c
    join public.conversation_members cm on cm.conversation_id = c.id and cm.user_id = auth.uid()
    left join lateral (
      select m.body, m.sender_id, m.kind
        from public.messages m
       where m.conversation_id = c.id
         and m.deleted_at is null
         and (m.visibility = 'public' or public.is_team())
       order by m.created_at desc
       limit 1
    ) lm on true
   where c.archived_at is null
   order by c.last_message_at desc nulls last, c.created_at desc
$$;
grant execute on function public.my_conversations() to authenticated;

-- Activity feed: mentions, joins and recent messages across my conversations.
create or replace function public.my_activity(since timestamptz default now() - interval '60 days', max_rows int default 50)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  kind text,
  body text,
  created_at timestamptz,
  unread boolean
)
language sql stable security invoker set search_path = public as $$
  with me as (select p.id, p.display_name from public.profiles p where p.id = auth.uid())
  select m.id, m.conversation_id, m.sender_id,
         case
           when m.kind = 'system' and m.meta->>'event' = 'member_joined' then 'New member'
           when m.meta->'mentions' ? (select id::text from me) then 'Mention'
           when m.body ilike '%@' || (select display_name from me) || '%' then 'Mention'
           else 'Message'
         end as kind,
         m.body, m.created_at,
         (m.created_at > coalesce(cm.last_read_at, 'epoch'::timestamptz)) as unread
    from public.messages m
    join public.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
   where m.created_at > since
     and m.deleted_at is null
     and m.sender_id is distinct from auth.uid()
     and (m.visibility = 'public' or public.is_team())
   order by m.created_at desc
   limit max_rows
$$;
grant execute on function public.my_activity(timestamptz, int) to authenticated;

-- Lock down default grants: only authenticated users touch data tables via the API.
revoke all on all tables in schema public from anon;
