-- 0014_manual_away.sql
-- A manual "Away" that everyone can see and that silences every notification.
--
-- Presence has until now been ephemeral: the client tracks an idle timer on the org topic and
-- keeps the result in browser memory (src/components/shell/store.tsx). That cannot express a
-- deliberate "I am away", cannot be seen once the tab is closed, and cannot be read by the
-- notification trigger below. These three columns are the server-side half.
--
-- profiles.presence (the presence_status enum) stays DEAD: it is `not null default 'offline'`
-- and has never been written by anything, so there is no "unset" value to tell apart from a
-- deliberate one, and the enum has no 'auto' member. Postgres also cannot *use* a value added
-- by `alter type ... add value` in the same transaction, so reusing it here would fail outright.

alter table public.profiles
  add column if not exists presence_mode text not null default 'auto',
  add column if not exists away_since    timestamptz,
  add column if not exists away_until    timestamptz;

alter table public.profiles drop constraint if exists profiles_presence_mode_check;
alter table public.profiles add constraint profiles_presence_mode_check
  check (presence_mode in ('auto', 'away'));

comment on column public.profiles.presence_mode is
  'auto = derived from the realtime idle timer; away = the person set themselves away by hand.';
comment on column public.profiles.away_until is
  'null = away until cleared by hand. Expiry is evaluated lazily at read time, like dnd_until.';

-- Partial: only the handful of rows that are actually away.
create index if not exists profiles_presence_mode_idx on public.profiles (presence_mode)
  where presence_mode <> 'auto';

-- No RLS change is needed. "profiles: update own" (0013) already allows any column on your own
-- row, and profiles_guard_update() only guards role / account_type / org_id / email /
-- deactivated_at. These three are self-serve by design.

-- ---------------------------------------------------------------------------
-- Notifications: away implies do-not-disturb
-- ---------------------------------------------------------------------------
-- Body copied verbatim from 0010_slack_parity.sql with exactly one predicate added, because
-- `create or replace` swaps the whole WHERE clause wholesale and a dropped condition would fail
-- silently in the direction of emailing people who asked not to be emailed.

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
       -- Manual away silences every notification until it is cleared or expires.
       and not (coalesce(p.presence_mode, 'auto') = 'away'
                and (p.away_until is null or p.away_until > now()))
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

-- The messages_notify trigger itself (0006_customer_accounts_notifications.sql) is unchanged.

-- ---------------------------------------------------------------------------
-- Realtime: away travels on the org topic everyone already subscribes to
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.display_name is distinct from old.display_name
     or new.full_name is distinct from old.full_name
     or new.avatar_url is distinct from old.avatar_url
     or new.avatar_color is distinct from old.avatar_color
     or new.status_text is distinct from old.status_text
     or new.status_emoji is distinct from old.status_emoji
     or new.status_expires_at is distinct from old.status_expires_at
     or new.dnd_until is distinct from old.dnd_until
     or new.timezone is distinct from old.timezone
     or new.presence is distinct from old.presence
     or new.presence_mode is distinct from old.presence_mode
     or new.away_since is distinct from old.away_since
     or new.away_until is distinct from old.away_until
     or new.deactivated_at is distinct from old.deactivated_at then
    perform realtime.send(
      jsonb_build_object(
        'id', new.id, 'display_name', new.display_name, 'full_name', new.full_name,
        'avatar_url', new.avatar_url, 'avatar_color', new.avatar_color,
        'status_text', new.status_text, 'status_emoji', new.status_emoji,
        'status_expires_at', new.status_expires_at, 'dnd_until', new.dnd_until,
        'timezone', new.timezone, 'presence', new.presence,
        'presence_mode', new.presence_mode, 'away_since', new.away_since, 'away_until', new.away_until,
        'deactivated_at', new.deactivated_at),
      'profile_changed', 'org:' || new.org_id::text, true);
  end if;
  return null;
end $$;
revoke execute on function public.broadcast_profile_changes() from public, anon, authenticated;
-- The profiles_broadcast trigger (0012_profile_presence.sql) already fires on every update.
