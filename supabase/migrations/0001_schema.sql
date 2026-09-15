-- 0001_schema.sql
-- Core schema for the Stayful messaging platform.
-- Multi-tenant from day one: every row carries org_id (spec D3).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.account_type as enum ('customer', 'team');
create type public.user_role as enum ('owner', 'delegate', 'contractor', 'cleaner', 'staff', 'admin');
create type public.conversation_type as enum ('owner', 'internal', 'dm', 'group_dm', 'job');
create type public.message_kind as enum ('text', 'system', 'document', 'approval', 'call_summary', 'broadcast');
create type public.message_visibility as enum ('public', 'internal');
create type public.presence_status as enum ('online', 'away', 'offline');

-- ---------------------------------------------------------------------------
-- Organisations
-- ---------------------------------------------------------------------------
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  -- settings.team_domains: string[] of email domains that get team accounts on sign-up
  -- settings.default: boolean, the org new users fall into when no domain matches
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  org_id           uuid not null references public.organisations (id) on delete restrict,
  account_type     public.account_type not null default 'customer',
  role             public.user_role not null default 'owner',
  display_name     text not null,
  full_name        text,
  email            text,
  avatar_url       text,
  avatar_color     text not null default '#5D8156',
  presence         public.presence_status not null default 'offline',
  status_text      text,
  last_active_at   timestamptz,
  monday_person_id text,
  deactivated_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (org_id);

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations (id) on delete cascade,
  type             public.conversation_type not null,
  name             text,             -- channel name e.g. "joseph-obianwu"; null for DMs
  slug             text,
  topic            text,
  description      text,
  is_private       boolean not null default true,
  owner_user_id    uuid references public.profiles (id) on delete set null,
  property_id      uuid,             -- properties table lands in a later migration
  assignee_id      uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  last_message_at  timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz not null default now()
);
create unique index conversations_org_slug_idx on public.conversations (org_id, slug) where slug is not null;
create index conversations_org_type_idx on public.conversations (org_id, type);
create index conversations_last_message_idx on public.conversations (last_message_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Membership and read state
-- ---------------------------------------------------------------------------
create table public.conversation_members (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  org_id           uuid not null references public.organisations (id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  muted            boolean not null default false,
  starred          boolean not null default false,
  notify_level     text not null default 'all',   -- all | mentions | none
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organisations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  sender_id        uuid references public.profiles (id) on delete set null, -- null = system
  body             text not null default '',
  body_json        jsonb,            -- optional structured blocks; body stays the plain-text source of truth
  kind             public.message_kind not null default 'text',
  visibility       public.message_visibility not null default 'public',
  parent_id        uuid references public.messages (id) on delete set null,
  meta             jsonb not null default '{}'::jsonb,  -- mentions[], client_id, document_type, ...
  sent_via         text not null default 'app',         -- app | email | api | mcp | sms | import
  external_ref     text,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);
create index messages_org_created_idx on public.messages (org_id, created_at desc);
create index messages_sender_idx on public.messages (sender_id);
create index messages_parent_idx on public.messages (parent_id);

-- ---------------------------------------------------------------------------
-- Attachments, pins, reactions
-- ---------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete cascade,
  message_id    uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime          text not null,
  size_bytes    bigint not null default 0,
  category      text,   -- contract | compliance | statement | invoice | photo | other
  created_at    timestamptz not null default now()
);
create index attachments_message_idx on public.attachments (message_id);
create index attachments_conversation_idx on public.attachments (conversation_id);

create table public.pins (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id      uuid not null references public.messages (id) on delete cascade,
  org_id          uuid not null references public.organisations (id) on delete cascade,
  pinned_by       uuid references public.profiles (id) on delete set null,
  pinned_at       timestamptz not null default now(),
  primary key (conversation_id, message_id)
);

create table public.reactions (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  org_id      uuid not null references public.organisations (id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organisations (id) on delete cascade,
  actor_id    uuid,
  actor_type  text not null default 'user',   -- user | api_key | mcp_client | system
  action      text not null,
  entity      text not null,
  entity_id   text,
  diff        jsonb,
  at          timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log (org_id, at desc);

-- ---------------------------------------------------------------------------
-- Triggers: bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.conversation_id;
  -- the sender has read their own message
  if new.sender_id is not null then
    update public.conversation_members
       set last_read_at = greatest(coalesce(last_read_at, new.created_at), new.created_at)
     where conversation_id = new.conversation_id and user_id = new.sender_id;
  end if;
  return new;
end $$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.messages_before_update()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body or new.body_json is distinct from old.body_json then
    new.edited_at = now();
  end if;
  return new;
end $$;

create trigger messages_before_update
  before update on public.messages
  for each row execute function public.messages_before_update();

-- ---------------------------------------------------------------------------
-- Trigger: create a profile for every new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  email_domain text := lower(split_part(coalesce(new.email, ''), '@', 2));
  target_org  public.organisations%rowtype;
  v_account   public.account_type;
  v_role      public.user_role;
  v_display   text;
  v_full      text;
begin
  -- 1. explicit org via metadata (seed / invitations), 2. team domain match, 3. default org
  if meta ? 'org_slug' then
    select * into target_org from public.organisations where slug = meta->>'org_slug';
  end if;
  if target_org.id is null and email_domain <> '' then
    select * into target_org from public.organisations o
     where o.settings->'team_domains' ? email_domain
     limit 1;
    if target_org.id is not null then
      v_account := 'team';
    end if;
  end if;
  if target_org.id is null then
    select * into target_org from public.organisations o
     where coalesce((o.settings->>'default')::boolean, false)
     order by created_at limit 1;
  end if;
  if target_org.id is null then
    select * into target_org from public.organisations order by created_at limit 1;
  end if;
  if target_org.id is null then
    raise exception 'No organisation exists to attach user % to', new.id;
  end if;

  if meta ? 'account_type' then
    v_account := (meta->>'account_type')::public.account_type;
  end if;
  v_account := coalesce(v_account, 'customer');

  if meta ? 'role' then
    v_role := (meta->>'role')::public.user_role;
  else
    v_role := case when v_account = 'team' then 'staff' else 'owner' end;
  end if;

  v_full := coalesce(meta->>'full_name', meta->>'name');
  v_display := coalesce(meta->>'display_name', split_part(coalesce(v_full, ''), ' ', 1));
  if v_display is null or v_display = '' then
    v_display := split_part(coalesce(new.email, 'user'), '@', 1);
  end if;

  insert into public.profiles (id, org_id, account_type, role, display_name, full_name, email, avatar_url, avatar_color)
  values (
    new.id,
    target_org.id,
    v_account,
    v_role,
    v_display,
    v_full,
    new.email,
    coalesce(meta->>'avatar_url', meta->>'picture'),
    coalesce(meta->>'avatar_color', '#5D8156')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
