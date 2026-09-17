-- 0032_calls.sql
-- Calling. A team member talks in the browser; Twilio dials the contact's mobile.
--
-- This is not the huddle. A huddle is team-to-team video and can stay in the browser on both
-- sides. This is for the people who will never open the app — a cleaner mid-changeover, a
-- contractor on a roof — whose phone has to ring like any other phone.

-- ---------------------------------------------------------------------------
-- Which of our numbers a call goes out from
-- ---------------------------------------------------------------------------
-- A caller ID cannot be invented: Twilio only accepts a From it sold us or that we verified,
-- and since May 2023 Ofcom has required UK networks to block caller IDs that are not valid,
-- dialable and uniquely identifying. So the number is a row we own, not a string in an env var.
--
-- One row today. It is a table rather than a constant because the obvious next step is a number
-- per account manager — so a cleaner rings back the person who actually called them — and that
-- should be a row, not a migration. whatsapp_accounts (0022) already answers exactly this
-- question for messaging; this is the same shape for voice.
create table if not exists public.voice_numbers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations (id) on delete cascade,
  -- Generic E.164 rather than the UK-only rule on profiles.phone: this is a number we bought,
  -- not one a customer typed, and buying a non-UK number should not need a migration.
  phone         text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  label         text,
  -- null means the shared org number. Set it to give one manager their own.
  owner_user_id uuid references public.profiles (id) on delete set null,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists voice_numbers_phone_idx on public.voice_numbers (org_id, phone);
-- At most one default per organisation: two would make "which number did this go out from"
-- depend on row order, which is how a caller ID quietly becomes unpredictable.
create unique index if not exists voice_numbers_one_default_idx
  on public.voice_numbers (org_id) where is_default;

alter table public.voice_numbers enable row level security;
create policy "voice numbers: team reads"
  on public.voice_numbers for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
create policy "voice numbers: admins manage"
  on public.voice_numbers for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
-- status holds Twilio's own vocabulary verbatim (queued, ringing, in-progress, completed,
-- busy, no-answer, failed, canceled). Translating it into a vocabulary of our own would mean
-- maintaining a mapping that silently loses whatever Twilio adds next.
create table if not exists public.calls (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organisations (id) on delete cascade,
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  -- The thread strand it belongs to, so a call from a property's Cleaning thread files its
  -- summary there rather than at the top of the group.
  parent_message_id  uuid references public.messages (id) on delete set null,
  twilio_call_sid    text unique,
  direction          text not null check (direction in ('outbound', 'inbound')),
  from_number        text not null,
  to_number          text not null,
  to_user_id         uuid references public.profiles (id) on delete set null,
  started_by         uuid references public.profiles (id) on delete set null,
  status             text not null default 'queued',
  started_at         timestamptz not null default now(),
  answered_at        timestamptz,
  ended_at           timestamptz,
  duration_seconds   int,
  summary_message_id uuid references public.messages (id) on delete set null
);
create index if not exists calls_conversation_idx on public.calls (conversation_id, started_at desc);
create index if not exists calls_sid_idx on public.calls (twilio_call_sid);

alter table public.calls enable row level security;
-- Same rule as reading the conversation itself: a call is part of its story.
create policy "calls: members read"
  on public.calls for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));
-- No insert or update policy. Rows are written by start_call below and by the Twilio webhooks
-- under the service role; a client that could write here could invent a call that never happened.

-- ---------------------------------------------------------------------------
-- call_recordings
-- ---------------------------------------------------------------------------
-- A separate table, not a column on calls, because the rule is different: a customer sitting in
-- their own group may see that a call happened, and must not be able to play back a recording of
-- the team discussing them. RLS is row-level, so a stricter rule needs its own row — column
-- privileges would break `select *` for everyone rather than hiding one field.
create table if not exists public.call_recordings (
  call_id          uuid primary key references public.calls (id) on delete cascade,
  org_id           uuid not null references public.organisations (id) on delete cascade,
  recording_sid    text not null unique,
  -- Twilio's URL. Played back through a server route that re-checks the caller, never handed
  -- to the browser directly, because a Twilio recording URL is readable by anyone holding it.
  url              text not null,
  duration_seconds int,
  created_at       timestamptz not null default now()
);

alter table public.call_recordings enable row level security;
create policy "call recordings: team reads"
  on public.call_recordings for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.is_team())
    and exists (select 1 from public.calls c where c.id = call_id and public.is_member(c.conversation_id))
  );

-- ---------------------------------------------------------------------------
-- start_call
-- ---------------------------------------------------------------------------
-- Creates the row the browser then dials against, so that by the time any audio exists there is
-- already something to hang the status callbacks and the summary off.
--
-- Team only: a customer pressing Call would place a real, billable call from a Stayful number.
create or replace function public.start_call(
  p_conversation_id uuid,
  p_to_user_id uuid,
  p_parent_message_id uuid default null
)
returns public.calls language plpgsql security definer set search_path = public as $$
declare
  me       uuid := auth.uid();
  my_org   uuid;
  v_conv   public.conversations%rowtype;
  v_to     public.profiles%rowtype;
  v_from   text;
  v_call   public.calls;
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can start calls';
  end if;
  select org_id into my_org from public.profiles where id = me;

  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or v_conv.org_id is distinct from my_org then raise exception 'not found'; end if;
  if not public.is_member(p_conversation_id) then raise exception 'not allowed'; end if;

  select * into v_to from public.profiles where id = p_to_user_id;
  if v_to.id is null or v_to.org_id is distinct from my_org then raise exception 'not found'; end if;
  if v_to.phone is null then raise exception 'there is no mobile number for %', v_to.display_name; end if;
  if v_to.deactivated_at is not null then raise exception 'that account is deactivated'; end if;

  -- The manager's own number if they have one, otherwise the shared default.
  select phone into v_from from public.voice_numbers
   where org_id = my_org and owner_user_id = me
   limit 1;
  if v_from is null then
    select phone into v_from from public.voice_numbers where org_id = my_org and is_default limit 1;
  end if;
  if v_from is null then raise exception 'no Stayful number is configured to call from'; end if;

  insert into public.calls (org_id, conversation_id, parent_message_id, direction,
                            from_number, to_number, to_user_id, started_by, status)
  values (my_org, p_conversation_id, p_parent_message_id, 'outbound',
          v_from, v_to.phone, p_to_user_id, me, 'queued')
  returning * into v_call;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'call.started', 'call', v_call.id::text,
          jsonb_build_object('conversation_id', p_conversation_id, 'to_user_id', p_to_user_id));

  return v_call;
end $$;
revoke all on function public.start_call(uuid, uuid, uuid) from public, anon;
grant execute on function public.start_call(uuid, uuid, uuid) to authenticated;
