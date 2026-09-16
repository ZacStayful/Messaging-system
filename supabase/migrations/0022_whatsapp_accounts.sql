-- 0022_whatsapp_accounts.sql
-- More than one Stayful WhatsApp number.
--
-- 0019 assumed a single sender (the workspace had exactly one connected account) and picked it
-- from an env var. Stayful will run a handful — one per account manager, each their own mobile —
-- so which number a message leaves from becomes data, not configuration.
--
-- The rule: a customer group owns a number. The customer then always sees the same number and
-- their phone shows one continuous conversation with Stayful, rather than a separate chat per
-- person who happened to reply.

create table if not exists public.whatsapp_accounts (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations (id) on delete cascade,
  phone               text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  -- TimelinesAI's own id, e.g. 447957516879@s.whatsapp.net. Nullable because the inbound webhook
  -- identifies an account by phone and email only, and that is how a new one first reaches us.
  provider_account_id text,
  account_name        text,
  owner_email         text,
  -- The Stayful person whose mobile this is, resolved from owner_email.
  owner_user_id       uuid references public.profiles (id) on delete set null,
  status              text not null default 'active' check (status in ('active', 'inactive')),
  is_default          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists whatsapp_accounts_phone_idx on public.whatsapp_accounts (org_id, phone);
create unique index if not exists whatsapp_accounts_provider_idx
  on public.whatsapp_accounts (provider_account_id) where provider_account_id is not null;
-- At most one default per organisation, so the fallback can never be ambiguous.
create unique index if not exists whatsapp_accounts_one_default_idx
  on public.whatsapp_accounts (org_id) where is_default;
create index if not exists whatsapp_accounts_owner_idx on public.whatsapp_accounts (owner_user_id);

alter table public.whatsapp_accounts enable row level security;
drop policy if exists "whatsapp accounts: team reads" on public.whatsapp_accounts;
create policy "whatsapp accounts: team reads"
  on public.whatsapp_accounts for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
drop policy if exists "whatsapp accounts: admins write" on public.whatsapp_accounts;
create policy "whatsapp accounts: admins write"
  on public.whatsapp_accounts for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_admin()));

drop trigger if exists whatsapp_accounts_updated_at on public.whatsapp_accounts;
create trigger whatsapp_accounts_updated_at
  before update on public.whatsapp_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Which number a group sends from
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts (id) on delete set null;
create index if not exists conversations_whatsapp_account_idx on public.conversations (whatsapp_account_id);

alter table public.whatsapp_threads
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts (id) on delete set null;

-- Picks the number a new group should use: the creator's own mobile if they have one connected,
-- otherwise the organisation's default, otherwise any active account. Group DMs and internal
-- channels never message anyone externally, so they are left alone.
create or replace function public.conversations_assign_whatsapp_account()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if new.type <> 'owner' or new.whatsapp_account_id is not null then return new; end if;
  select id into v_id from public.whatsapp_accounts
   where org_id = new.org_id and status = 'active' and owner_user_id = new.created_by limit 1;
  if v_id is null then
    select id into v_id from public.whatsapp_accounts
     where org_id = new.org_id and status = 'active' and is_default order by created_at limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.whatsapp_accounts
     where org_id = new.org_id and status = 'active' order by created_at limit 1;
  end if;
  new.whatsapp_account_id := v_id;
  return new;
end $$;
revoke execute on function public.conversations_assign_whatsapp_account() from public, anon, authenticated;
drop trigger if exists conversations_assign_whatsapp_account on public.conversations;
create trigger conversations_assign_whatsapp_account
  before insert on public.conversations
  for each row execute function public.conversations_assign_whatsapp_account();

-- The team can move a group to a different number, e.g. when an account manager changes.
create or replace function public.set_conversation_whatsapp_account(p_conversation_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; a public.whatsapp_accounts%rowtype;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not public.is_member(c.id) or not public.is_team() then raise exception 'not allowed'; end if;
  if p_account_id is not null then
    select * into a from public.whatsapp_accounts where id = p_account_id and org_id = c.org_id;
    if a.id is null then raise exception 'that WhatsApp number is not set up for this organisation'; end if;
  end if;
  update public.conversations set whatsapp_account_id = p_account_id where id = c.id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (c.org_id, auth.uid(), 'channel.whatsapp_account', 'conversation', c.id::text,
          jsonb_build_object('whatsapp_account_id', p_account_id));
end $$;
revoke all on function public.set_conversation_whatsapp_account(uuid, uuid) from public, anon;
grant execute on function public.set_conversation_whatsapp_account(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The account already connected, and a backfill
-- ---------------------------------------------------------------------------
-- Further accounts arrive either by an admin adding them, or on their own: the inbound webhook
-- carries whatsapp_account.phone/email, so a number that messages us registers itself.
insert into public.whatsapp_accounts (org_id, phone, provider_account_id, account_name, owner_email, is_default)
select o.id, '+447957516879', '447957516879@s.whatsapp.net', 'Zac', 'zac@stayful.co.uk', true
  from public.organisations o
on conflict (org_id, phone) do nothing;

update public.whatsapp_accounts a
   set owner_user_id = p.id
  from public.profiles p
 where p.org_id = a.org_id and lower(p.email) = lower(a.owner_email) and a.owner_user_id is null;

update public.conversations c
   set whatsapp_account_id = (select id from public.whatsapp_accounts a
                               where a.org_id = c.org_id and a.status = 'active'
                               order by a.is_default desc, a.created_at limit 1)
 where c.type = 'owner' and c.whatsapp_account_id is null;
