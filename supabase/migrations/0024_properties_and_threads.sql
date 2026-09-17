-- 0024_properties_and_threads.sql
-- Properties become a thing the schema knows about, and a property group gets the two threads
-- every conversation about a property is filed under: cleaning and maintenance.
--
-- conversations.property_id has existed since 0001 with the comment "properties table lands in a
-- later migration". This is that migration.
--
-- Why a thread and not a channel each: cleaning and maintenance are two strands of one
-- property's story, and the team wants them side by side with the rest of it. Threads already
-- carry unread counts, follows and their own composer, so the only thing missing was a stable
-- handle on which message is the root of which strand — property_threads is that handle.

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------
create table if not exists public.properties (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organisations (id) on delete cascade,
  address                text not null,
  -- Monday's own ids, kept as text: they are opaque identifiers, not numbers we do arithmetic on.
  monday_item_id         text,
  client_monday_item_id  text,
  created_at             timestamptz not null default now()
);
create unique index if not exists properties_monday_item_idx
  on public.properties (org_id, monday_item_id) where monday_item_id is not null;
create index if not exists properties_org_idx on public.properties (org_id);

alter table public.properties enable row level security;
create policy "properties: team reads"
  on public.properties for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
create policy "properties: team writes"
  on public.properties for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_team()));

-- conversations.property_id has been a bare uuid with no referent since 0001. Now it has one.
-- Not validated against existing rows because nothing has ever written to it.
alter table public.conversations drop constraint if exists conversations_property_id_fkey;
alter table public.conversations
  add constraint conversations_property_id_fkey
  foreign key (property_id) references public.properties (id) on delete set null not valid;
create index if not exists conversations_property_idx
  on public.conversations (property_id) where property_id is not null;

-- ---------------------------------------------------------------------------
-- The two threads
-- ---------------------------------------------------------------------------
-- One row per (group, strand), pointing at the message everything in that strand replies to.
-- Without this the anchors would only be findable by matching on their text, which breaks the
-- first time someone edits one.
create table if not exists public.property_threads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  kind            text not null check (kind in ('cleaning', 'maintenance')),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  root_message_id uuid not null references public.messages (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, kind)
);
create index if not exists property_threads_root_idx on public.property_threads (root_message_id);
alter table public.property_threads enable row level security;
create policy "property threads: members read"
  on public.property_threads for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));

-- ---------------------------------------------------------------------------
-- Who we talk to about a property
-- ---------------------------------------------------------------------------
-- A cleaner or contractor registered against a property strand. This is what turns an inbound
-- WhatsApp from a number we know into a message filed in the right place (0025).
--
-- The primary key allows one person to be both the cleaner and the maintenance contact for the
-- same property, which happens, and the (user_id) index is the lookup the inbound webhook does
-- on every single message — it is on the hot path, not a convenience.
create table if not exists public.property_contacts (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('cleaning', 'maintenance')),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id, kind)
);
create index if not exists property_contacts_user_idx on public.property_contacts (user_id);
alter table public.property_contacts enable row level security;
create policy "property contacts: team reads"
  on public.property_contacts for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

-- ---------------------------------------------------------------------------
-- Slugs that do not collide
-- ---------------------------------------------------------------------------
-- create_channel (0009) raises when a live group already holds the slug. That is right for a
-- person typing a name — they should be told — and wrong for an automated sync, where two
-- clients sharing a surname would leave the second one with no group at all. This finds the
-- next free suffix so the sync can pass a name create_channel will accept.
--
-- Truncated to 60 characters before suffixing: a property address slugifies to something like
-- apartment-1203-michighan-point-tower-d-18-michighan-avenue-salford-m50-2hn, which is a
-- terrible thing to see in a sidebar.
create or replace function public.next_available_slug(p_org uuid, p_base text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_base text; v_try text; n int := 1;
begin
  v_base := trim(both '-' from regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 60));
  if v_base = '' then return null; end if;
  v_try := v_base;
  while exists (select 1 from public.conversations c
                 where c.org_id = p_org and c.slug = v_try and c.archived_at is null) loop
    n := n + 1;
    v_try := v_base || '-' || n;
    if n > 50 then return null; end if;
  end loop;
  return v_try;
end $$;
revoke all on function public.next_available_slug(uuid, text) from public, anon;
grant execute on function public.next_available_slug(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_property_group
-- ---------------------------------------------------------------------------
-- The group, its two anchors, the property_threads rows and the pins, in one call. The webhook,
-- the UI and any future MCP tool all go through this, so a property group created by one route
-- cannot end up shaped differently from one created by another.
--
-- 'internal' rather than 'owner': the customer never sees this group, and — usefully — the
-- one_owner_group_per_external trigger (0018) only fires for 'owner', so a cleaner who works on
-- six properties can be an external member of six of these without tripping it.
create or replace function public.create_property_group(
  p_name text,
  p_topic text default null,
  p_property_id uuid default null,
  p_member_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_org uuid;
  cid uuid;
  v_name text;
  v_msg uuid;
  strand record;
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can create property groups';
  end if;
  select org_id into my_org from public.profiles where id = me;

  v_name := public.next_available_slug(my_org, p_name);
  if v_name is null then raise exception 'give the property group a name'; end if;

  cid := public.create_channel(v_name, 'internal', p_member_ids, p_topic);

  if p_property_id is not null then
    update public.conversations set property_id = p_property_id where id = cid;
  end if;

  -- The anchors. Deliberately ordinary public messages: the whole point is that a reply to one
  -- is a thread, and threads only work on real messages.
  for strand in
    select * from (values
      ('cleaning',    '🧹 **Cleaning**' || chr(10) || chr(10) ||
                      'Everything about cleaning this property goes in this thread — rotas, access, linen, issues found on a changeover. Replies here reach the cleaning contact on WhatsApp.'),
      ('maintenance', '🔧 **Maintenance**' || chr(10) || chr(10) ||
                      'Everything about maintaining this property goes in this thread — jobs, quotes, contractor visits, certificates. Replies here reach the contractors registered on this property.')
    ) as v(kind, body)
  loop
    insert into public.messages (org_id, conversation_id, sender_id, body, kind, visibility, meta)
    values (my_org, cid, me, strand.body, 'text', 'public',
            jsonb_build_object('property_thread', strand.kind))
    returning id into v_msg;
    insert into public.property_threads (conversation_id, kind, org_id, root_message_id)
    values (cid, strand.kind, my_org, v_msg);
    -- Pinned so the two strands are one click away however long the group gets.
    insert into public.pins (conversation_id, message_id, org_id, pinned_by)
    values (cid, v_msg, my_org, me) on conflict do nothing;
  end loop;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'property_group.created', 'conversation', cid::text,
          jsonb_build_object('name', v_name, 'property_id', p_property_id));
  return cid;
end $$;
revoke all on function public.create_property_group(text, text, uuid, uuid[]) from public, anon;
grant execute on function public.create_property_group(text, text, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- add_property_contact
-- ---------------------------------------------------------------------------
-- Three writes that must happen together or the contact is registered and never hears from us:
--   1. property_contacts  — what inbound routing looks up
--   2. conversation_members with member_side = 'external' — what enqueue_message_notifications
--      (0019) uses to decide anyone is contactable at all
--   3. thread_follows on the anchor — because that same function only notifies an external
--      member of a *reply* when they follow its parent. Miss this one and everything looks
--      correct while no reply ever reaches them.
--
-- SECURITY DEFINER is load-bearing for (3): thread_follows' insert policy (0010) only lets you
-- follow a thread as yourself.
create or replace function public.add_property_contact(p_conversation_id uuid, p_user_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; v_root uuid;
begin
  if not public.is_team() then raise exception 'only Stayful team members can add a service contact'; end if;
  if p_kind not in ('cleaning', 'maintenance') then raise exception 'a contact is for cleaning or maintenance'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or c.org_id <> public.auth_org_id() or not public.is_member(c.id) then
    raise exception 'not allowed';
  end if;
  select root_message_id into v_root from public.property_threads
   where conversation_id = p_conversation_id and kind = p_kind;
  if v_root is null then raise exception 'that group has no % thread', p_kind; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and org_id = c.org_id) then
    raise exception 'that person is not in this workspace';
  end if;

  insert into public.conversation_members (conversation_id, user_id, org_id, member_side)
  values (p_conversation_id, p_user_id, c.org_id, 'external')
  on conflict (conversation_id, user_id) do update set member_side = 'external';

  insert into public.property_contacts (conversation_id, user_id, kind, org_id, created_by)
  values (p_conversation_id, p_user_id, p_kind, c.org_id, auth.uid())
  on conflict do nothing;

  insert into public.thread_follows (message_id, user_id, org_id)
  values (v_root, p_user_id, c.org_id) on conflict do nothing;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, auth.uid(), 'property.contact_added', 'conversation', c.id::text,
          jsonb_build_object('user_id', p_user_id::text, 'kind', p_kind));
end $$;
revoke all on function public.add_property_contact(uuid, uuid, text) from public, anon;
grant execute on function public.add_property_contact(uuid, uuid, text) to authenticated;

create or replace function public.remove_property_contact(p_conversation_id uuid, p_user_id uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; v_root uuid;
begin
  if not public.is_team() then raise exception 'only Stayful team members can remove a service contact'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or c.org_id <> public.auth_org_id() or not public.is_member(c.id) then
    raise exception 'not allowed';
  end if;
  delete from public.property_contacts
   where conversation_id = p_conversation_id and user_id = p_user_id and kind = p_kind;
  select root_message_id into v_root from public.property_threads
   where conversation_id = p_conversation_id and kind = p_kind;
  if v_root is not null then
    delete from public.thread_follows where message_id = v_root and user_id = p_user_id;
  end if;
  -- Membership stays: they may still be the contact for the other strand, and dropping someone
  -- out of a group they can see is a bigger decision than un-registering them from one thread.
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, auth.uid(), 'property.contact_removed', 'conversation', c.id::text,
          jsonb_build_object('user_id', p_user_id::text, 'kind', p_kind));
end $$;
revoke all on function public.remove_property_contact(uuid, uuid, text) from public, anon;
grant execute on function public.remove_property_contact(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The central maintenance channel
-- ---------------------------------------------------------------------------
-- A contractor works across many properties, so an inbound WhatsApp from one carries no signal
-- about which property it is about. Guessing would file real jobs against the wrong address, so
-- for now every inbound maintenance message lands here and a team member moves it to the right
-- property thread with move_message (0027).
--
-- Contractors are deliberately NOT members: the service role writes their messages in, which
-- means no contractor can read another contractor's quotes.
create or replace function public.ensure_maintenance_channel(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; v_actor uuid;
begin
  select id into cid from public.conversations
   where org_id = p_org and slug = 'maintenance' and type = 'internal' and archived_at is null;
  if cid is not null then return cid; end if;
  -- auth.uid() is null when the drain or the webhook calls this, so fall back to an admin as
  -- the creator rather than leaving created_by null and the channel memberless.
  v_actor := coalesce(auth.uid(),
    (select id from public.profiles
      where org_id = p_org and account_type = 'team' and role = 'admin' and deactivated_at is null
      order by created_at limit 1));
  insert into public.conversations (org_id, type, name, slug, topic, is_private, created_by)
  values (p_org, 'internal', 'maintenance', 'maintenance',
          'Inbound maintenance WhatsApp lands here until it is moved to a property thread',
          true, v_actor)
  returning id into cid;
  if v_actor is not null then
    insert into public.conversation_members (conversation_id, user_id, org_id, member_side)
    values (cid, v_actor, p_org, 'internal') on conflict do nothing;
  end if;
  return cid;
end $$;
revoke all on function public.ensure_maintenance_channel(uuid) from public, anon;
grant execute on function public.ensure_maintenance_channel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cleaners and contractors are accounts too
-- ---------------------------------------------------------------------------
-- create_customer_account (0006) has always refused any role but owner or delegate, even though
-- the user_role enum has had 'cleaner' and 'contractor' since 0001. Registering a cleaner means
-- creating an account for them, so that one check is widened by exactly those two values.
--
-- Everything else is 0006's body verbatim — the auth.identities row, the empty-string token
-- columns, the profile org pin, the member_joined system message. `create or replace` swaps the
-- whole function, so anything paraphrased here would be silently dropped. The search_path also
-- carries 0008's `, extensions`, without which crypt() is off the path and no account is created.
create or replace function public.create_customer_account(
  p_email text,
  p_full_name text,
  p_display_name text,
  p_password text,
  p_conversation_ids uuid[] default '{}'::uuid[],
  p_role public.user_role default 'owner'
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  me       uuid := auth.uid();
  my_org   uuid;
  v_email  text := lower(trim(p_email));
  v_uid    uuid := gen_random_uuid();
  cid      uuid;
  v_display text := coalesce(nullif(trim(p_display_name), ''), split_part(trim(p_full_name), ' ', 1));
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can create customer accounts';
  end if;
  select org_id into my_org from public.profiles where id = me;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address';
  end if;
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'password must be at least 10 characters';
  end if;
  -- Widened from ('owner', 'delegate'): a cleaner and a contractor are customer-type accounts
  -- with their own role, and the user_role enum has carried both since 0001.
  if p_role not in ('owner', 'delegate', 'cleaner', 'contractor') then
    raise exception 'customers can only be owners, delegates, cleaners or contractors';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'an account already exists for %', v_email;
  end if;
  foreach cid in array p_conversation_ids loop
    if not public.is_member(cid) then
      raise exception 'you can only add customers to conversations you belong to';
    end if;
  end loop;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', trim(p_full_name),
      'display_name', v_display,
      'account_type', 'customer',
      'role', p_role::text,
      'org_slug', (select slug from public.organisations where id = my_org),
      'invited_by', me::text
    ),
    now(), now(), '', '', '', '', false
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
          'email', null, now(), now());

  -- profile row comes from the on_auth_user_created trigger; pin the org explicitly
  update public.profiles set org_id = my_org where id = v_uid;

  foreach cid in array p_conversation_ids loop
    insert into public.conversation_members (conversation_id, user_id, org_id, last_read_at)
    values (cid, v_uid, my_org, now())
    on conflict do nothing;
    insert into public.messages (org_id, conversation_id, sender_id, body, kind, meta, sent_via)
    values (my_org, cid, null,
            format('%s has been added to this conversation by %s.', coalesce(nullif(trim(p_full_name), ''), v_display),
                   (select display_name from public.profiles where id = me)),
            'system', jsonb_build_object('event', 'member_joined', 'user_id', v_uid::text, 'added_by', me::text), 'app');
  end loop;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'customer.created', 'profile', v_uid::text,
          jsonb_build_object('email', v_email, 'conversations', to_jsonb(p_conversation_ids)));

  return v_uid;
end $$;
revoke all on function public.create_customer_account(text, text, text, text, uuid[], public.user_role) from public, anon;
grant execute on function public.create_customer_account(text, text, text, text, uuid[], public.user_role) to authenticated;
