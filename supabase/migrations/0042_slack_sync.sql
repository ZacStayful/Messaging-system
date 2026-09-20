-- 0042_slack_sync.sql
-- Slack → Stayful Messaging: the import of a workspace's channels and their history, and the
-- daily catch-up that follows, so the team can move off Slack without recreating anything.
--
-- Shape, in one paragraph: `slack_users` and `slack_conversations` are what discovery found and
-- what was decided about each (link to something that exists, create, or skip), reviewable on
-- Settings → Integrations before anything is written. The three `import_slack_*` functions are the
-- only way rows reach `profiles`, `conversation_members` and `messages`, and each is idempotent on
-- Slack's own ids so any slice can be re-run. `slack_messages` maps (channel, ts) to a message —
-- that is how a reply finds its parent and how a re-read of a window is diffed against what is
-- already here. Everything a Slack message becomes carries `sent_via = 'slack'`,
-- `external_ref = '<channel>:<ts>'` and `meta.mirrored = true`, the one flag
-- enqueue_message_notifications (0034) honours, so a three-year backfill sends nobody an email.
--
-- Two things here are fixes rather than additions, both found while reading for this work:
--   * properties_monday_item_idx was partial, and provision.ts upserts with `onConflict` and no
--     predicate — which Postgres answers with 42P10, silently, so no property ever got an id.
--   * next_available_slug ignored archived rows while conversations_org_slug_idx includes them,
--     so re-using an archived name raised 23505 one step later.

-- ---------------------------------------------------------------------------
-- profiles: the Slack identity
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists slack_user_id text;
create unique index if not exists profiles_slack_user_idx
  on public.profiles (org_id, slack_user_id) where slack_user_id is not null;
comment on column public.profiles.slack_user_id is
  'The Slack member id (U…/B…) this person was imported from or linked to. Shaped after monday_person_id.';

-- ---------------------------------------------------------------------------
-- properties: found again on a re-run, and the Monday index made usable
-- ---------------------------------------------------------------------------
alter table public.properties add column if not exists slack_channel_id text;
create unique index if not exists properties_slack_channel_idx
  on public.properties (org_id, slack_channel_id) where slack_channel_id is not null;

-- Nulls are distinct in a unique index, so dropping the predicate loses nothing and lets a plain
-- `on conflict (org_id, monday_item_id)` — which is all PostgREST can emit — find the index.
drop index if exists public.properties_monday_item_idx;
create unique index if not exists properties_monday_item_idx
  on public.properties (org_id, monday_item_id);

-- ---------------------------------------------------------------------------
-- slack_users: the directory as discovered, and what to do with each person
-- ---------------------------------------------------------------------------
create table if not exists public.slack_users (
  org_id              uuid not null references public.organisations (id) on delete cascade default public.default_org_id(),
  slack_user_id       text not null,
  name                text,
  real_name           text,
  display_name        text,
  email               text,
  is_bot              boolean not null default false,
  is_app_user         boolean not null default false,
  is_restricted       boolean not null default false,
  is_ultra_restricted boolean not null default false,
  deleted             boolean not null default false,
  tz                  text,
  image_url           text,
  raw                 jsonb not null default '{}'::jsonb,
  -- link: an account with this email exists; invite_team: a live team member, invited for real;
  -- create_customer / create_team / create_bot: dormant accounts (create_team is a deleted Slack
  -- member, or a full member outside the team domain held for review); skip: nothing.
  decision            text not null check (decision in ('link', 'invite_team', 'create_customer', 'create_team', 'create_bot', 'skip')),
  decision_source     text not null default 'auto' check (decision_source in ('auto', 'manual')),
  -- The display name the profile will carry, de-duplicated: mentions in this app resolve by
  -- display name (src/lib/richtext.ts), so two "Sam"s would share every @mention.
  resolved_display    text,
  profile_id          uuid references public.profiles (id) on delete set null,
  outcome             text,
  error               text,
  updated_at          timestamptz not null default now(),
  primary key (org_id, slack_user_id)
);
alter table public.slack_users enable row level security;
create policy "slack users: team reads"
  on public.slack_users for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

-- ---------------------------------------------------------------------------
-- slack_conversations: the channel list, the decision, and where the sync has got to
-- ---------------------------------------------------------------------------
create table if not exists public.slack_conversations (
  org_id             uuid not null references public.organisations (id) on delete cascade default public.default_org_id(),
  slack_channel_id   text not null,
  kind               text not null check (kind in ('channel', 'group')),
  name               text,
  is_private         boolean not null default true,
  is_archived        boolean not null default false,
  is_member          boolean not null default true,
  topic              text,
  purpose            text,
  creator            text,
  created_ts         text,
  members            jsonb not null default '[]'::jsonb,
  -- pending until the member list has been read, which is what decides owner vs internal.
  decision           text not null default 'pending' check (decision in ('pending', 'create', 'link', 'skip')),
  skip_reason        text,
  decision_source    text not null default 'auto' check (decision_source in ('auto', 'manual')),
  -- owner: a customer group; internal: a team channel; property: a team channel that is also a
  -- property record with the Cleaning and Maintenance threads, the shape Monday creates.
  target_kind        text check (target_kind in ('owner', 'internal', 'property')),
  property_id        uuid references public.properties (id) on delete set null,
  property_address   text,
  address_guessed    boolean not null default false,
  customer_channel_id text,
  conversation_id    uuid references public.conversations (id) on delete set null,
  status             text not null default 'discovered'
    check (status in ('discovered', 'ready', 'members', 'history', 'files', 'bookmarks', 'complete', 'error', 'skipped', 'paused')),
  -- Two watermarks. conversations.history returns newest first, so the backfill walks *backwards*
  -- from history_low_ts and a crash resumes exactly where it stopped; the daily catch-up walks
  -- forwards from history_high_ts.
  history_low_ts     text,
  history_high_ts    text,
  next_sync_at       timestamptz,
  last_synced_at     timestamptz,
  threads_checked_at timestamptz,
  imported_messages  int not null default 0,
  imported_replies   int not null default 0,
  imported_files     int not null default 0,
  skipped_files      int not null default 0,
  member_outcomes    jsonb not null default '{}'::jsonb,
  last_error         text,
  claimed_at         timestamptz,
  attempts           int not null default 0,
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz,
  primary key (org_id, slack_channel_id)
);
create unique index if not exists slack_conversations_conversation_idx
  on public.slack_conversations (conversation_id) where conversation_id is not null;
create index if not exists slack_conversations_work_idx
  on public.slack_conversations (status, claimed_at)
  where status in ('ready', 'members', 'history', 'files', 'bookmarks');
create index if not exists slack_conversations_due_idx
  on public.slack_conversations (next_sync_at) where status = 'complete';
alter table public.slack_conversations enable row level security;
create policy "slack conversations: team reads"
  on public.slack_conversations for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

-- ---------------------------------------------------------------------------
-- slack_messages: (channel, ts) → message. The source of truth for threads and re-reads.
-- ---------------------------------------------------------------------------
create table if not exists public.slack_messages (
  org_id     uuid not null references public.organisations (id) on delete cascade default public.default_org_id(),
  channel_id text not null,
  ts         text not null,
  message_id uuid not null references public.messages (id) on delete cascade,
  thread_ts  text,
  created_at timestamptz not null default now(),
  primary key (channel_id, ts)
);
create unique index if not exists slack_messages_message_idx on public.slack_messages (message_id);
-- Service role only: no policies.
alter table public.slack_messages enable row level security;

-- Belt and braces, the shape of 0007 / 0020 / 0033. ts is unique per channel, hence the prefix.
create unique index if not exists messages_external_ref_slack_idx
  on public.messages (external_ref) where sent_via = 'slack' and external_ref is not null;

-- ---------------------------------------------------------------------------
-- slack_files: the download queue. attachments has no unique key, so this is where idempotency lives.
-- ---------------------------------------------------------------------------
create table if not exists public.slack_files (
  org_id          uuid not null references public.organisations (id) on delete cascade default public.default_org_id(),
  slack_file_id   text not null,
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  channel_id      text not null,
  name            text,
  mimetype        text,
  size            bigint,
  url_private     text,
  mode            text,
  status          text not null default 'pending'
    check (status in ('pending', 'done', 'skipped_mime', 'skipped_size', 'skipped_mode', 'error', 'dead')),
  attempts        int not null default 0,
  last_error      text,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  primary key (message_id, slack_file_id)
);
create index if not exists slack_files_pending_idx
  on public.slack_files (conversation_id, created_at) where status = 'pending';
alter table public.slack_files enable row level security;
create policy "slack files: team reads"
  on public.slack_files for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

create unique index if not exists attachments_slack_file_idx
  on public.attachments (message_id, (meta->>'slack_file_id')) where meta->>'slack_file_id' is not null;

-- ---------------------------------------------------------------------------
-- slack_leases: one worker at a time for the phases that must not overlap
-- ---------------------------------------------------------------------------
create table if not exists public.slack_leases (
  name       text primary key,
  holder     text,
  expires_at timestamptz
);
alter table public.slack_leases enable row level security;

-- ---------------------------------------------------------------------------
-- The switch. Off, like monday_clients (0026).
-- ---------------------------------------------------------------------------
insert into public.integrations (org_id, key, enabled)
select id, 'slack', false from public.organisations
on conflict (org_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- Bulk import: silence the realtime broadcasts while a backfill runs
-- ---------------------------------------------------------------------------
-- broadcast_message_changes (0029) does one realtime.send per member per insert; a forty-member
-- channel with fifty thousand messages is two million sends to nobody. The flag is transaction-
-- local, set only inside import_slack_messages / import_slack_members, and unreachable over
-- PostgREST. Each broadcast function below is its 0009 / 0010 / 0029 body with one line added.
create or replace function public.bulk_import_active()
returns boolean language sql stable as $$
  select coalesce(current_setting('app.bulk_import', true), '') = 'on'
$$;
revoke all on function public.bulk_import_active() from public, anon;

create or replace function public.broadcast_message_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec public.messages;
  member record;
  sender_name text;
  v_topic text;
begin
  if public.bulk_import_active() then return null; end if;
  rec := coalesce(new, old);
  v_topic := case when rec.visibility = 'internal' then 'conversation-internal:' else 'conversation:' end
             || rec.conversation_id::text;
  perform realtime.broadcast_changes(v_topic, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);

  if tg_op = 'INSERT' then
    select display_name into sender_name from public.profiles where id = rec.sender_id;
    for member in
      select cm.user_id
        from public.conversation_members cm
       where cm.conversation_id = rec.conversation_id
         and (rec.visibility = 'public'
              or exists (select 1 from public.profiles p
                          where p.id = cm.user_id
                            and p.account_type = 'team'
                            and p.deactivated_at is null))
    loop
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

create or replace function public.broadcast_membership_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.conversation_members; member record;
begin
  if public.bulk_import_active() then return null; end if;
  rec := coalesce(new, old);
  for member in select user_id from public.conversation_members where conversation_id = rec.conversation_id loop
    perform realtime.send(jsonb_build_object('conversation_id', rec.conversation_id, 'event', lower(tg_op), 'user_id', rec.user_id), 'conversation_changed', 'user:' || member.user_id::text, true);
  end loop;
  if tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('conversation_id', rec.conversation_id, 'event', 'removed', 'user_id', rec.user_id), 'conversation_changed', 'user:' || rec.user_id::text, true);
  end if;
  return null;
end $$;

create or replace function public.broadcast_conversation_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare member record;
begin
  if public.bulk_import_active() then return null; end if;
  for member in select user_id from public.conversation_members where conversation_id = new.id loop
    perform realtime.send(jsonb_build_object('conversation_id', new.id, 'event', 'updated'), 'conversation_changed', 'user:' || member.user_id::text, true);
  end loop;
  return null;
end $$;

create or replace function public.broadcast_reaction_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec public.reactions;
  cid uuid;
begin
  if public.bulk_import_active() then return null; end if;
  rec := coalesce(new, old);
  select conversation_id into cid from public.messages where id = rec.message_id;
  if cid is not null then
    perform realtime.broadcast_changes('conversation:' || cid::text, 'REACTION', tg_op, tg_table_name, tg_table_schema, new, old);
  end if;
  return null;
end $$;

create or replace function public.broadcast_pin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.pins;
begin
  if public.bulk_import_active() then return null; end if;
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, 'PIN', tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;

create or replace function public.broadcast_attachment_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.attachments;
begin
  if public.bulk_import_active() then return null; end if;
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, 'ATTACHMENT', tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- next_available_slug: respect the unique index it exists to satisfy
-- ---------------------------------------------------------------------------
-- conversations_org_slug_idx (0001) is unique on (org_id, slug) with no archived predicate, but
-- the loop below only looked at live rows. Body from 0028 with that one condition removed.
create or replace function public.next_available_slug(p_org uuid, p_base text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_base text; v_try text; n int := 1;
begin
  if auth.uid() is not null and (p_org is distinct from public.auth_org_id() or not public.is_team()) then
    raise exception 'not allowed';
  end if;
  v_base := trim(both '-' from regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 60));
  if v_base = '' then return null; end if;
  v_try := v_base;
  while exists (select 1 from public.conversations c where c.org_id = p_org and c.slug = v_try) loop
    n := n + 1;
    v_try := v_base || '-' || n;
    if n > 50 then return null; end if;
  end loop;
  return v_try;
end $$;

-- ---------------------------------------------------------------------------
-- import_slack_account: a person from Slack, on file
-- ---------------------------------------------------------------------------
-- import_lead_customer (0034) generalised: any account type and role, a bot allowed a placeholder
-- address, deactivation on request. The account cannot sign in (banned_until) and is sent nothing
-- (both notification switches off), until grant_portal_access below. Idempotent on the Slack id,
-- then on the email: an existing account with the same address is linked, not duplicated, and its
-- names are left alone — a team member who already uses the app chose them.
--
-- Admin-only for the reason 0034 gives: the update path touches email and account_type, which
-- profiles_guard_update lets only an admin do. Called through actingUserClient(actor).
create or replace function public.import_slack_account(
  p_slack_user_id text,
  p_email text,
  p_full_name text,
  p_display_name text,
  p_account_type public.account_type,
  p_role public.user_role,
  p_timezone text default null,
  p_avatar_url text default null,
  p_deactivated boolean default false,
  p_is_bot boolean default false
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  me        uuid := auth.uid();
  my_org    uuid;
  v_slack   text := trim(p_slack_user_id);
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_name    text := trim(coalesce(p_full_name, ''));
  v_display text := trim(coalesce(p_display_name, ''));
  v_uid     uuid;
  v_created boolean := false;
  v_linked  boolean := false;
begin
  if me is null or not public.is_admin() then
    raise exception 'only Stayful admins can import Slack accounts';
  end if;
  select org_id into my_org from public.profiles where id = me;
  if coalesce(v_slack, '') = '' then raise exception 'a Slack user id is required'; end if;
  if v_email = '' and p_is_bot then
    -- .invalid is reserved by RFC 2606: nothing can ever be delivered there.
    v_email := 'slack-bot-' || lower(regexp_replace(v_slack, '[^A-Za-z0-9]', '', 'g')) || '@bots.stayful.invalid';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address for %', v_slack;
  end if;
  if v_name = '' then v_name := coalesce(nullif(v_display, ''), split_part(v_email, '@', 1)); end if;
  if v_display = '' then v_display := split_part(v_name, ' ', 1); end if;
  if p_account_type = 'team' and p_role not in ('staff', 'admin') then
    raise exception 'team accounts are staff or admins';
  end if;
  if p_account_type = 'customer' and p_role not in ('owner', 'delegate', 'cleaner', 'contractor') then
    raise exception 'customer accounts are owners, delegates, cleaners or contractors';
  end if;

  -- Already imported or linked?
  select id into v_uid from public.profiles where org_id = my_org and slack_user_id = v_slack;

  -- Otherwise, an account with this address: link it.
  if v_uid is null then
    select p.id into v_uid
      from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = v_email and p.org_id = my_org;
    if v_uid is not null then
      if exists (select 1 from public.profiles where id = v_uid and slack_user_id is not null and slack_user_id <> v_slack) then
        raise exception 'slack_conflict: % is already linked to another Slack account', v_email;
      end if;
      v_linked := true;
    end if;
  end if;
  if v_uid is null and exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'email_conflict: an account already exists for % in another organisation', v_email;
  end if;

  if v_uid is null then
    v_uid := gen_random_uuid();
    perform set_config('app.trusted_signup', 'on', true);
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user,
      banned_until
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', v_name,
        'display_name', v_display,
        'account_type', p_account_type::text,
        'role', p_role::text,
        'org_slug', (select slug from public.organisations where id = my_org),
        'invited_by', me::text,
        'slack_import', true
      ),
      now(), now(), '', '', '', '', false,
      timestamptz '2999-12-31 00:00:00+00'
    );
    perform set_config('app.trusted_signup', 'off', true);
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', null, now(), now());
    v_created := true;
  end if;

  if v_linked then
    -- Their account, their names, their switches. Only the link is written.
    update public.profiles
       set slack_user_id = v_slack,
           avatar_url = coalesce(avatar_url, p_avatar_url)
     where id = v_uid;
  else
    update public.profiles
       set org_id = my_org,
           account_type = p_account_type,
           role = p_role,
           full_name = v_name,
           display_name = v_display,
           email = v_email,
           timezone = coalesce(nullif(p_timezone, ''), timezone),
           avatar_url = coalesce(p_avatar_url, avatar_url),
           slack_user_id = v_slack,
           email_notifications = 'off',
           whatsapp_notifications = 'off',
           portal_access = false,
           phone_prompt_skipped_at = coalesce(phone_prompt_skipped_at, now()),
           deactivated_at = case when p_deactivated or p_is_bot then coalesce(deactivated_at, now()) else deactivated_at end
     where id = v_uid;
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me,
          case when v_created then 'slack_account.imported' when v_linked then 'slack_account.linked' else 'slack_account.updated' end,
          'profile', v_uid::text,
          jsonb_build_object('slack_user_id', v_slack, 'email', v_email, 'account_type', p_account_type::text,
                             'role', p_role::text, 'is_bot', p_is_bot, 'deactivated', p_deactivated));
  return v_uid;
end $$;
revoke all on function public.import_slack_account(text, text, text, text, public.account_type, public.user_role, text, text, boolean, boolean) from public, anon;
grant execute on function public.import_slack_account(text, text, text, text, public.account_type, public.user_role, text, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- import_slack_members: a channel's membership, one batch
-- ---------------------------------------------------------------------------
-- Rows: [{"user_id": uuid, "member_side": "internal"|"external"}]. Each row is its own
-- sub-transaction so one_owner_group_per_external (0018) rejecting one person becomes an outcome
-- for that person rather than a failed batch. Service role only.
create or replace function public.import_slack_members(p_conversation_id uuid, p_rows jsonb, p_joined_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c        public.conversations%rowtype;
  r        jsonb;
  v_user   uuid;
  v_side   text;
  v_out    jsonb := '{}'::jsonb;
  v_before int;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'unknown conversation'; end if;
  perform set_config('app.bulk_import', 'on', true);

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_user := (r->>'user_id')::uuid;
    v_side := coalesce(r->>'member_side', 'internal');
    begin
      select count(*) into v_before from public.conversation_members
       where conversation_id = c.id and user_id = v_user;
      insert into public.conversation_members (conversation_id, user_id, org_id, member_side, joined_at, last_read_at)
      values (c.id, v_user, c.org_id, v_side, coalesce(p_joined_at, c.created_at), null)
      on conflict (conversation_id, user_id) do nothing;
      v_out := v_out || jsonb_build_object(v_user::text, case when v_before > 0 then 'already' else 'added' end);
    exception when others then
      v_out := v_out || jsonb_build_object(v_user::text,
        case when sqlerrm like '%already in the customer group%' then 'member_conflict' else 'error: ' || sqlerrm end);
    end;
  end loop;

  perform set_config('app.bulk_import', '', true);
  return v_out;
end $$;
revoke all on function public.import_slack_members(uuid, jsonb, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- import_slack_messages: a window of history, one batch
-- ---------------------------------------------------------------------------
-- Rows, sorted by ts by the caller:
--   {"channel_id", "ts", "thread_ts", "sender_id", "body", "kind", "edited_ts", "meta",
--    "reactions": [{"user_id", "emoji"}], "pinned": bool, "pinned_by", "pinned_ts"}
-- Returns [{"ts", "message_id", "outcome"}] with outcome inserted | updated | unchanged | orphan.
--
-- A row already mapped is compared, not skipped: the daily catch-up re-reads a window precisely
-- to catch an edit. Reactions and pins are add-only — a reaction a team member adds in this app
-- after cutover must not be removed because Slack never had it.
--
-- created_at comes from Slack's ts, to the microsecond, and is immutable after insert (0030), so
-- it is derived here rather than trusted from the caller. p_bulk is off for the daily catch-up's
-- small batches so that open tabs still hear about them.
create or replace function public.import_slack_messages(p_conversation_id uuid, p_rows jsonb, p_bulk boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c          public.conversations%rowtype;
  r          jsonb;
  rx         jsonb;
  v_ts       text;
  v_thread   text;
  v_channel  text;
  v_parent   uuid;
  v_existing uuid;
  v_id       uuid;
  v_body     text;
  v_kind     public.message_kind;
  v_meta     jsonb;
  v_edited   timestamptz;
  v_old_body text;
  v_old_edit timestamptz;
  v_old_del  timestamptz;
  v_out      jsonb := '[]'::jsonb;
  v_outcome  text;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'unknown conversation'; end if;
  if p_bulk then perform set_config('app.bulk_import', 'on', true); end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_ts := r->>'ts';
    v_channel := r->>'channel_id';
    v_thread := nullif(r->>'thread_ts', '');
    v_body := coalesce(r->>'body', '');
    v_kind := coalesce(nullif(r->>'kind', ''), 'text')::public.message_kind;
    v_meta := coalesce(r->'meta', '{}'::jsonb) || jsonb_build_object('mirrored', true);
    v_edited := case when nullif(r->>'edited_ts', '') is null then null else to_timestamp((r->>'edited_ts')::numeric) end;

    select message_id into v_existing from public.slack_messages where channel_id = v_channel and ts = v_ts;

    if v_existing is not null then
      select body, edited_at, deleted_at into v_old_body, v_old_edit, v_old_del from public.messages where id = v_existing;
      if v_old_body is distinct from v_body or v_old_del is not null then
        -- messages_before_update stamps edited_at = now() on a body change; the Slack edit time
        -- wins, and comes after the trigger because this is an update of the same row.
        update public.messages set body = v_body, deleted_at = null where id = v_existing;
        update public.messages set edited_at = coalesce(v_edited, v_old_edit, now()) where id = v_existing;
        v_outcome := 'updated';
      else
        v_outcome := 'unchanged';
      end if;
      v_id := v_existing;
    else
      v_parent := null;
      if v_thread is not null and v_thread <> v_ts then
        select message_id into v_parent from public.slack_messages where channel_id = v_channel and ts = v_thread;
        if v_parent is null then
          v_out := v_out || jsonb_build_object('ts', v_ts, 'message_id', null, 'outcome', 'orphan');
          continue;
        end if;
      end if;
      insert into public.messages (org_id, conversation_id, sender_id, body, kind, visibility, parent_id, meta,
                                   sent_via, external_ref, created_at, edited_at)
      values (c.org_id, c.id, nullif(r->>'sender_id', '')::uuid, v_body, v_kind, 'public', v_parent, v_meta,
              'slack', v_channel || ':' || v_ts, to_timestamp(v_ts::numeric), v_edited)
      returning id into v_id;
      insert into public.slack_messages (org_id, channel_id, ts, message_id, thread_ts)
      values (c.org_id, v_channel, v_ts, v_id, v_thread);
      v_outcome := 'inserted';
    end if;

    for rx in select * from jsonb_array_elements(coalesce(r->'reactions', '[]'::jsonb)) loop
      if nullif(rx->>'user_id', '') is not null then
        insert into public.reactions (message_id, user_id, org_id, emoji, created_at)
        values (v_id, (rx->>'user_id')::uuid, c.org_id, rx->>'emoji', to_timestamp(v_ts::numeric))
        on conflict (message_id, user_id, emoji) do nothing;
      end if;
    end loop;

    if coalesce((r->>'pinned')::boolean, false) then
      insert into public.pins (conversation_id, message_id, org_id, pinned_by, pinned_at)
      values (c.id, v_id, c.org_id, nullif(r->>'pinned_by', '')::uuid,
              case when nullif(r->>'pinned_ts', '') is null then now() else to_timestamp((r->>'pinned_ts')::numeric) end)
      on conflict (conversation_id, message_id) do nothing;
    end if;

    v_out := v_out || jsonb_build_object('ts', v_ts, 'message_id', v_id, 'outcome', v_outcome);
  end loop;

  if p_bulk then perform set_config('app.bulk_import', '', true); end if;
  return v_out;
end $$;
revoke all on function public.import_slack_messages(uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mark_slack_deleted: what a re-read no longer returned
-- ---------------------------------------------------------------------------
create or replace function public.mark_slack_deleted(p_channel_id text, p_ts_list text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  perform set_config('app.bulk_import', 'on', true);
  update public.messages m
     set deleted_at = now()
    from public.slack_messages sm
   where sm.message_id = m.id and sm.channel_id = p_channel_id and sm.ts = any (p_ts_list)
     and m.deleted_at is null;
  get diagnostics n = row_count;
  perform set_config('app.bulk_import', '', true);
  return n;
end $$;
revoke all on function public.mark_slack_deleted(text, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_property_anchors: the Cleaning and Maintenance threads, dated when the channel was
-- ---------------------------------------------------------------------------
-- The loop from create_property_group (0024), lifted so an imported property group gets its two
-- anchors dated at the channel's creation rather than today — pinned, they are one click away
-- regardless, and at the top of the history they read as the start of the record they are.
-- Idempotent on property_threads (conversation_id, kind).
create or replace function public.add_property_anchors(p_conversation_id uuid, p_actor uuid, p_created_at timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; strand record; v_msg uuid;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'unknown conversation'; end if;
  perform set_config('app.bulk_import', 'on', true);
  for strand in
    select * from (values
      ('cleaning',    '🧹 **Cleaning**' || chr(10) || chr(10) ||
                      'Everything about cleaning this property goes in this thread — rotas, access, linen, issues found on a changeover. Replies here reach the cleaning contact on WhatsApp.'),
      ('maintenance', '🔧 **Maintenance**' || chr(10) || chr(10) ||
                      'Everything about maintaining this property goes in this thread — jobs, quotes, contractor visits, certificates. Replies here reach the contractors registered on this property.')
    ) as v(kind, body)
  loop
    if exists (select 1 from public.property_threads where conversation_id = c.id and kind = strand.kind) then
      continue;
    end if;
    insert into public.messages (org_id, conversation_id, sender_id, body, kind, visibility, meta, sent_via, created_at)
    values (c.org_id, c.id, p_actor, strand.body, 'text', 'public',
            jsonb_build_object('property_thread', strand.kind, 'mirrored', true), 'import', p_created_at)
    returning id into v_msg;
    insert into public.property_threads (conversation_id, kind, org_id, root_message_id)
    values (c.id, strand.kind, c.org_id, v_msg);
    insert into public.pins (conversation_id, message_id, org_id, pinned_by)
    values (c.id, v_msg, c.org_id, p_actor) on conflict do nothing;
  end loop;
  perform set_config('app.bulk_import', '', true);
end $$;
revoke all on function public.add_property_anchors(uuid, uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The worker's claim, finish and lease
-- ---------------------------------------------------------------------------
-- One conversation at a time, backfill before catch-up, oldest touched first. `for update skip
-- locked` so two overlapping cron runs never pick the same row; claimed_at older than p_stale is
-- a run that died and is taken over, the outbox rescue rule (0029).
create or replace function public.slack_claim_conversation(p_stale interval default interval '10 minutes')
returns public.slack_conversations language plpgsql security definer set search_path = public as $$
declare picked public.slack_conversations%rowtype;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  update public.slack_conversations sc
     set claimed_at = now()
   where (sc.org_id, sc.slack_channel_id) = (
     select s.org_id, s.slack_channel_id
       from public.slack_conversations s
      where (s.status in ('ready', 'members', 'history', 'files', 'bookmarks')
             or (s.status = 'complete' and s.next_sync_at is not null and s.next_sync_at <= now()))
        and (s.claimed_at is null or s.claimed_at < now() - p_stale)
      order by case when s.status = 'complete' then 1 else 0 end, s.updated_at
      for update skip locked
      limit 1)
  returning * into picked;
  return picked;
end $$;
revoke all on function public.slack_claim_conversation(interval) from public, anon, authenticated;

-- Everyone has read everything that was imported: a three-year backfill must not arrive as
-- fifty thousand unread messages. The sender's own row was already set by messages_after_insert.
create or replace function public.slack_finish_backfill(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  update public.conversation_members
     set last_read_at = greatest(coalesce(last_read_at, now()), now())
   where conversation_id = p_conversation_id;
  update public.thread_follows f
     set last_read_at = greatest(coalesce(f.last_read_at, now()), now())
    from public.messages m
   where f.message_id = m.id and m.conversation_id = p_conversation_id;
  update public.slack_conversations
     set status = 'complete', completed_at = coalesce(completed_at, now()), claimed_at = null,
         last_synced_at = now(), next_sync_at = now() + interval '1 day', attempts = 0, last_error = null,
         updated_at = now()
   where conversation_id = p_conversation_id;
end $$;
revoke all on function public.slack_finish_backfill(uuid) from public, anon, authenticated;

create or replace function public.slack_acquire_lease(p_name text, p_holder text, p_ttl interval default interval '2 minutes')
returns boolean language plpgsql security definer set search_path = public as $$
declare got text;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  insert into public.slack_leases (name, holder, expires_at)
  values (p_name, p_holder, now() + p_ttl)
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where public.slack_leases.expires_at is null
       or public.slack_leases.expires_at < now()
       or public.slack_leases.holder = excluded.holder
  returning name into got;
  return got is not null;
end $$;
revoke all on function public.slack_acquire_lease(text, text, interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- grant_portal_access: the cutover step, one person at a time
-- ---------------------------------------------------------------------------
-- The reverse of what import_lead_customer and import_slack_account do: lifts the ban, sets the
-- password the caller will email, and turns email notifications back on. Admin-only and audited.
create or replace function public.grant_portal_access(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); my_org uuid; target public.profiles%rowtype;
begin
  if me is null or not public.is_admin() then raise exception 'only Stayful admins can grant access'; end if;
  select org_id into my_org from public.profiles where id = me;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.org_id <> my_org then raise exception 'not allowed'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'password must be at least 10 characters'; end if;
  update auth.users
     set banned_until = null,
         encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
  update public.profiles
     set portal_access = true,
         email_notifications = 'instant',
         deactivated_at = null
   where id = p_user_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'portal_access.granted', 'profile', p_user_id::text, jsonb_build_object('email', target.email));
end $$;
revoke all on function public.grant_portal_access(uuid, text) from public, anon;
grant execute on function public.grant_portal_access(uuid, text) to authenticated;
