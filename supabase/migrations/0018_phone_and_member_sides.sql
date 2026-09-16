-- 0018_phone_and_member_sides.sql
-- The groundwork for reaching customers on WhatsApp:
--   1. a verified UK mobile per person, and a WhatsApp switch beside email_notifications (0006)
--   2. an explicit internal/external side per group member, which is what decides who ever
--      receives an outbound message
--   3. the "one customer, one customer group" rule the inbound routing depends on
--
-- Nothing here sends anything. 0019 turns the outbox multi-channel.

-- ---------------------------------------------------------------------------
-- Profiles: mobile number, verification stamp, per-channel switch
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists phone_verified_at timestamptz,
  add column if not exists whatsapp_notifications text not null default 'off'
    check (whatsapp_notifications in ('instant', 'off')),
  add column if not exists phone_prompt_skipped_at timestamptz;

comment on column public.profiles.phone is
  'E.164 UK mobile. Only ever written by confirm_phone_verification or set_customer_phone; '
  'profiles_guard_update blocks a direct client write so verification cannot be skipped.';
comment on column public.profiles.phone_verified_at is
  'Set when the person entered a code we sent to that number. Null means a team member typed it.';

-- src/lib/phone.ts ACCEPT_RE is this same rule. Change one, change both.
alter table public.profiles drop constraint if exists profiles_phone_uk_mobile_ck;
alter table public.profiles add constraint profiles_phone_uk_mobile_ck
  check (phone is null or phone ~ '^\+447\d{9}$');

-- Inbound WhatsApp resolves a number to exactly one profile; two would be ambiguous.
create unique index if not exists profiles_phone_key on public.profiles (phone) where phone is not null;

-- whatsapp_notifications defaults to 'off' so nobody is messaged before they have chosen it.
-- Existing customers stay email-only until they next sign in and pass the gate.

-- ---------------------------------------------------------------------------
-- Verification codes
-- ---------------------------------------------------------------------------
create table if not exists public.phone_verifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  phone       text not null check (phone ~ '^\+447\d{9}$'),
  code_hash   text not null,              -- crypt(code, gen_salt('bf')); the code itself is never stored
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists phone_verifications_user_idx on public.phone_verifications (user_id, created_at desc);
alter table public.phone_verifications enable row level security;
-- No policies on purpose: reachable only through the two SECURITY DEFINER functions below,
-- like email_reply_threads (0007). A client can neither read a hash nor count attempts.

create or replace function public.start_phone_verification(p_phone text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); v_code text; v_recent int; v_last timestamptz;
begin
  if me is null then raise exception 'sign in first'; end if;
  if p_phone !~ '^\+447\d{9}$' then raise exception 'that is not a UK mobile number'; end if;
  if exists (select 1 from public.profiles where phone = p_phone and id <> me) then
    raise exception 'that number is already on another Stayful account';
  end if;

  -- Rate limits, in the function rather than the route: the route is not the only caller and
  -- an SMS-style flood is billable as well as annoying.
  select count(*), max(created_at) into v_recent, v_last
    from public.phone_verifications where user_id = me and created_at > now() - interval '1 hour';
  if v_recent >= 3 then raise exception 'too many attempts; try again in an hour'; end if;
  if v_last is not null and v_last > now() - interval '60 seconds' then
    raise exception 'wait a minute before asking for another code';
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into public.phone_verifications (user_id, phone, code_hash, expires_at)
  values (me, p_phone, extensions.crypt(v_code, extensions.gen_salt('bf')), now() + interval '10 minutes');
  -- Returned to the server action so it can send it. It never reaches the browser.
  return v_code;
end $$;
revoke all on function public.start_phone_verification(text) from public, anon;
grant execute on function public.start_phone_verification(text) to authenticated;

create or replace function public.confirm_phone_verification(p_phone text, p_code text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); v public.phone_verifications;
begin
  if me is null then raise exception 'sign in first'; end if;
  select * into v from public.phone_verifications
   where user_id = me and phone = p_phone and consumed_at is null
   order by created_at desc limit 1;
  if v.id is null then raise exception 'ask for a code first'; end if;
  if v.expires_at < now() then raise exception 'that code has expired; ask for a new one'; end if;
  if v.attempts >= 5 then raise exception 'too many wrong codes; ask for a new one'; end if;

  update public.phone_verifications set attempts = attempts + 1 where id = v.id;
  if extensions.crypt(p_code, v.code_hash) <> v.code_hash then raise exception 'that code is not right'; end if;

  update public.phone_verifications set consumed_at = now() where id = v.id;
  perform set_config('app.phone_write', 'on', true);
  update public.profiles set phone = p_phone, phone_verified_at = now() where id = me;
  perform set_config('app.phone_write', '', true);
end $$;
revoke all on function public.confirm_phone_verification(text, text) from public, anon;
grant execute on function public.confirm_phone_verification(text, text) to authenticated;

-- The team's escape hatch for a customer who cannot complete the gate. Needed as an RPC because
-- "profiles: update own" (0013) restricts updates to your own row.
create or replace function public.set_customer_phone(p_user_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not public.is_team() then raise exception 'only Stayful team members can set a number'; end if;
  if p_phone is not null and p_phone !~ '^\+447\d{9}$' then raise exception 'that is not a UK mobile number'; end if;
  select org_id into v_org from public.profiles where id = p_user_id;
  if v_org is null or v_org <> public.auth_org_id() then raise exception 'not allowed'; end if;
  if p_phone is not null and exists (select 1 from public.profiles where phone = p_phone and id <> p_user_id) then
    raise exception 'that number is already on another Stayful account';
  end if;
  -- phone_verified_at stays null: the team typed this, the customer has not proved it.
  perform set_config('app.phone_write', 'on', true);
  update public.profiles set phone = p_phone, phone_verified_at = null where id = p_user_id;
  perform set_config('app.phone_write', '', true);
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (v_org, auth.uid(), 'profile.phone_set', 'profile', p_user_id::text,
          jsonb_build_object('phone', p_phone));
end $$;
revoke all on function public.set_customer_phone(uuid, text) from public, anon;
grant execute on function public.set_customer_phone(uuid, text) to authenticated;

-- Guard: phone and phone_verified_at join the admin-guarded columns, so the only ways in are
-- the three functions above. Body copied from 0013 with the two columns added — `create or
-- replace` swaps the whole function, and a dropped condition would silently re-open a hole.
create or replace function public.profiles_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.account_type <> old.account_type or new.role <> old.role or new.org_id <> old.org_id
      or new.email is distinct from old.email or new.deactivated_at is distinct from old.deactivated_at)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin can change roles, emails or account types';
  end if;
  -- SECURITY DEFINER swaps the database role, not the JWT, so auth.uid() is still the caller
  -- inside confirm_phone_verification and set_customer_phone. Without the flag below those two
  -- functions are blocked by this very guard and no number can ever be verified. The flag is
  -- transaction-local and set only inside them; PostgREST gives each request its own
  -- transaction and does not expose set_config, so a client cannot raise it and then update.
  if (new.phone is distinct from old.phone or new.phone_verified_at is distinct from old.phone_verified_at)
     and auth.uid() is not null
     and coalesce(current_setting('app.phone_write', true), '') <> 'on' then
    raise exception 'change your number from your account settings so we can verify it';
  end if;
  return new;
end $$;
-- The trigger itself (0013) is unchanged.

-- ---------------------------------------------------------------------------
-- conversation_members: which side of the group someone is on
-- ---------------------------------------------------------------------------
-- Until now "external" was read off profiles.account_type. That column drives RLS and is
-- admin-guarded, so tying "who gets messaged" to it means a future account type silently
-- changes who we contact. An explicit side also lets a Stayful person be deliberately external
-- on a job, or a customer-side manager be internal, without touching their account type.
alter table public.conversation_members
  add column if not exists member_side text check (member_side in ('internal', 'external'));

update public.conversation_members cm
   set member_side = case when p.account_type = 'customer' then 'external' else 'internal' end
  from public.profiles p
 where p.id = cm.user_id and cm.member_side is null;

create or replace function public.conversation_members_default_side()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.member_side is null then
    new.member_side := case
      when (select account_type from public.profiles where id = new.user_id) = 'customer'
      then 'external' else 'internal' end;
  end if;
  return new;
end $$;
revoke execute on function public.conversation_members_default_side() from public, anon, authenticated;
drop trigger if exists conversation_members_default_side on public.conversation_members;
create trigger conversation_members_default_side
  before insert on public.conversation_members
  for each row execute function public.conversation_members_default_side();

alter table public.conversation_members alter column member_side set not null;

create index if not exists conversation_members_external_idx
  on public.conversation_members (conversation_id) where member_side = 'external';

create or replace function public.set_member_side(p_conversation_id uuid, p_user_id uuid, p_side text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  if p_side not in ('internal', 'external') then raise exception 'side must be internal or external'; end if;
  update public.conversation_members set member_side = p_side
   where conversation_id = p_conversation_id and user_id = p_user_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, auth.uid(), 'channel.member_side', 'conversation', c.id::text,
          jsonb_build_object('user_id', p_user_id::text, 'side', p_side));
end $$;
revoke all on function public.set_member_side(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_side(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One customer, one customer group
-- ---------------------------------------------------------------------------
-- Inbound WhatsApp has no reply token to tell it which conversation a message belongs to — it
-- has only the sender's number. That routing is only sound if an external person is in exactly
-- one owner group, so the rule is enforced here rather than left as a convention.
--
-- Trigger name matters: Postgres fires BEFORE row triggers in alphabetical order, and
-- conversation_members_default_side sorts before conversation_members_one_owner_group, so
-- member_side is already populated when this runs.
create or replace function public.one_owner_group_per_external()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type public.conversation_type; v_other text;
begin
  select type into v_type from public.conversations where id = new.conversation_id;
  if v_type is distinct from 'owner' or new.member_side <> 'external' then return new; end if;
  select c.name into v_other
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
   where cm.user_id = new.user_id and cm.member_side = 'external'
     and c.type = 'owner' and c.archived_at is null
     and cm.conversation_id <> new.conversation_id
   limit 1;
  if v_other is not null then
    raise exception 'that person is already in the customer group "%"; archive it or remove them first', v_other;
  end if;
  return new;
end $$;
revoke execute on function public.one_owner_group_per_external() from public, anon, authenticated;
drop trigger if exists conversation_members_one_owner_group on public.conversation_members;
create trigger conversation_members_one_owner_group
  before insert on public.conversation_members
  for each row execute function public.one_owner_group_per_external();
