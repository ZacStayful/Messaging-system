-- 0006_customer_accounts_notifications.sql
-- Customer accounts with email + password login created by the team, and the
-- outbox that feeds email notifications (spec D8, section 6.1 outbox pattern).

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists email_notifications text not null default 'instant'
    check (email_notifications in ('instant', 'off'));

-- ---------------------------------------------------------------------------
-- Outbox of emails to send. Written by triggers and RPCs; drained by the
-- notification worker (service role). Admins may read it for debugging.
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id                   bigint generated always as identity primary key,
  org_id               uuid not null references public.organisations (id) on delete cascade,
  kind                 text not null check (kind in ('welcome', 'message')),
  recipient_user_id    uuid references public.profiles (id) on delete cascade,
  recipient_email      text not null,
  payload              jsonb not null default '{}'::jsonb,
  status               text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts             int not null default 0,
  last_error           text,
  provider_message_id  text,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz
);
create index notification_outbox_pending_idx on public.notification_outbox (status, created_at) where status in ('pending', 'failed');
create index notification_outbox_recipient_idx on public.notification_outbox (recipient_user_id, created_at desc);

alter table public.notification_outbox enable row level security;

create policy "outbox: admins read"
  on public.notification_outbox for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Trigger: queue an email for every customer member when a message is posted
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  sender_name text;
  member record;
begin
  -- Only real messages, never internal notes
  if new.visibility <> 'public' or new.kind not in ('text', 'document') or new.deleted_at is not null then
    return null;
  end if;
  select * into conv from public.conversations where id = new.conversation_id;
  select display_name into sender_name from public.profiles where id = new.sender_id;

  for member in
    select p.id, p.email, p.display_name
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.conversation_id = new.conversation_id
       and cm.user_id is distinct from new.sender_id
       and cm.muted = false
       and p.account_type = 'customer'
       and p.deactivated_at is null
       and p.email is not null
       and p.email_notifications = 'instant'
  loop
    insert into public.notification_outbox (org_id, kind, recipient_user_id, recipient_email, payload)
    values (
      new.org_id, 'message', member.id, member.email,
      jsonb_build_object(
        'message_id', new.id,
        'conversation_id', new.conversation_id,
        'conversation_type', conv.type,
        'conversation_name', conv.name,
        'sender_id', new.sender_id,
        'sender_name', coalesce(sender_name, 'Stayful'),
        'recipient_name', member.display_name,
        'body', left(new.body, 2000),
        'created_at', new.created_at
      )
    );
  end loop;
  return null;
end $$;
revoke execute on function public.enqueue_message_notifications() from public, anon, authenticated;

create trigger messages_enqueue_notifications
  after insert on public.messages
  for each row execute function public.enqueue_message_notifications();

-- ---------------------------------------------------------------------------
-- Team creates a customer account with email + password (spec 4.0).
-- The caller must belong to every conversation the customer is added to.
-- Returns the new user's id. The welcome email is queued in the outbox and the
-- caller (app server action) sends it straight away, falling back to the worker.
-- ---------------------------------------------------------------------------
create or replace function public.create_customer_account(
  p_email text,
  p_full_name text,
  p_display_name text,
  p_password text,
  p_conversation_ids uuid[] default '{}'::uuid[],
  p_role public.user_role default 'owner'
)
returns uuid language plpgsql security definer set search_path = public as $$
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
  if p_role not in ('owner', 'delegate') then
    raise exception 'customers can only be owners or delegates';
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

-- Team resets a customer's password (used for "resend login details").
create or replace function public.reset_customer_password(p_user_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target public.profiles%rowtype;
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can reset customer passwords';
  end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.org_id <> (select org_id from public.profiles where id = me) then
    raise exception 'user not found';
  end if;
  if target.account_type <> 'customer' then
    raise exception 'team passwords can only be changed by their owner';
  end if;
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'password must be at least 10 characters';
  end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id)
  values (target.org_id, me, 'customer.password_reset', 'profile', p_user_id::text);
end $$;
revoke all on function public.reset_customer_password(uuid, text) from public, anon;
grant execute on function public.reset_customer_password(uuid, text) to authenticated;

-- Queue a welcome email (team only). Returns the outbox row id.
create or replace function public.queue_welcome_email(p_user_id uuid, p_payload jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  target public.profiles%rowtype;
  oid bigint;
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can send welcome emails';
  end if;
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.org_id <> (select org_id from public.profiles where id = me) then
    raise exception 'user not found';
  end if;
  insert into public.notification_outbox (org_id, kind, recipient_user_id, recipient_email, payload)
  values (target.org_id, 'welcome', target.id, target.email, p_payload)
  returning id into oid;
  return oid;
end $$;
revoke all on function public.queue_welcome_email(uuid, jsonb) from public, anon;
grant execute on function public.queue_welcome_email(uuid, jsonb) to authenticated;

-- The app marks an outbox row after sending it itself (team only; the worker uses the service role).
create or replace function public.mark_outbox(p_id bigint, p_status text, p_provider_message_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_team() then
    raise exception 'not allowed';
  end if;
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid status';
  end if;
  update public.notification_outbox
     set status = p_status,
         attempts = attempts + 1,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         last_error = p_error,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id and org_id = (select public.auth_org_id());
end $$;
revoke all on function public.mark_outbox(bigint, text, text, text) from public, anon;
grant execute on function public.mark_outbox(bigint, text, text, text) to authenticated;
