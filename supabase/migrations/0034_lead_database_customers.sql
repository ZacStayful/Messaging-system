-- 0034_lead_database_customers.sql
-- Customers who signed up to the lead database, on file but not let in.
--
-- The Monday board "Stayful Lead database enquiries" (18420649520) holds people who have signed
-- up for Stayful's lead resale service. They are being brought into the messaging system so that
-- what they WhatsApp and email to Zac lands in one thread per person — but they are not yet
-- being invited to use the system, so nothing here sends them anything and nothing here lets
-- them sign in.
--
-- Four pieces:
--   1. profiles.lead_category and profiles.portal_access, with profiles_guard_update widened
--   2. import_lead_customer(): create_customer_account's shape, minus the password anyone knows,
--      plus a sign-in block and the notification switches set the way a lead needs them
--   3. my_conversations() returns lead_category so the sidebar can file these threads apart
--   4. enqueue_message_notifications() ignores a message that was mirrored in from a channel

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists lead_category text
    check (lead_category is null or lead_category in ('airbnb_management', 'r2r')),
  add column if not exists portal_access boolean not null default true;

comment on column public.profiles.lead_category is
  'Set for customers imported from the lead database board. Null for every other account.';
comment on column public.profiles.portal_access is
  'False for imported lead-database customers. A readable flag only: sign-in is blocked by auth.users.banned_until, set at creation.';

create index if not exists profiles_lead_category_idx
  on public.profiles (org_id, lead_category) where lead_category is not null;

-- One Monday item is one person. The import looks this up on every run, and a second profile
-- for the same item would give inbound routing two candidates for one number.
create unique index if not exists profiles_monday_person_idx
  on public.profiles (org_id, monday_person_id) where monday_person_id is not null;

-- Guard: the two new columns join the admin-only set. Without this, "profiles: update own"
-- (0013) would let any customer file themselves under the leads section. Body copied from 0018
-- with the one condition added — `create or replace` swaps the whole function, and a dropped
-- clause would silently re-open a hole.
create or replace function public.profiles_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.account_type <> old.account_type or new.role <> old.role or new.org_id <> old.org_id
      or new.email is distinct from old.email or new.deactivated_at is distinct from old.deactivated_at
      or new.lead_category is distinct from old.lead_category
      or new.portal_access is distinct from old.portal_access)
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
-- 2. import_lead_customer
-- ---------------------------------------------------------------------------
-- create_customer_account (0029) with four differences:
--   * the password is random and never leaves this function — nobody is meant to log in;
--   * auth.users.banned_until is set far in the future, which GoTrue honours for every grant
--     type (password, magic link, OAuth). Not 'infinity': GoTrue scans the column into a Go
--     time.Time, which 'infinity' breaks, taking the dashboard's user list down with it;
--   * email notifications are off (an email would carry the login link) and WhatsApp is on
--     (a reply typed in the app reaches them as a plain chat message from Zac's number);
--   * it is idempotent on the Monday item id, so re-running the import refreshes details.
--
-- Admin-only rather than team: the idempotent path rewrites email, which profiles_guard_update
-- lets only an admin do, and the Import button is admin-only anyway.
create or replace function public.import_lead_customer(
  p_conversation_id uuid,
  p_email text,
  p_full_name text,
  p_lead_category text,
  p_monday_item_id text,
  p_phone text
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  me        uuid := auth.uid();
  my_org    uuid;
  v_email   text := lower(trim(p_email));
  v_name    text := trim(p_full_name);
  v_display text := split_part(trim(p_full_name), ' ', 1);
  v_item    text := trim(p_monday_item_id);
  v_uid     uuid;
  v_created boolean := false;
  c         public.conversations%rowtype;
begin
  if me is null or not public.is_admin() then
    raise exception 'only Stayful admins can import lead customers';
  end if;
  select org_id into my_org from public.profiles where id = me;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email address';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception 'a name is required';
  end if;
  if p_lead_category not in ('airbnb_management', 'r2r') then
    raise exception 'unknown lead category %', p_lead_category;
  end if;
  if p_phone is not null and p_phone !~ '^\+447\d{9}$' then
    raise exception 'bad_phone: % is not a UK mobile in E.164', p_phone;
  end if;
  if coalesce(v_item, '') = '' then
    raise exception 'a Monday item id is required';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or c.org_id <> my_org or c.type <> 'owner' or not public.is_member(c.id) then
    raise exception 'not allowed';
  end if;

  -- Already imported? Then this run refreshes their details.
  select id into v_uid from public.profiles where org_id = my_org and monday_person_id = v_item;

  -- Explicit, before any insert, so the error reads as what it is rather than as a 23505 from
  -- an index the importer would have to decode.
  if p_phone is not null
     and exists (select 1 from public.profiles where phone = p_phone and id is distinct from v_uid) then
    raise exception 'phone_conflict: % is already on another account', p_phone;
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from v_uid) then
    raise exception 'email_conflict: an account already exists for %', v_email;
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
      -- Two UUIDs of entropy, hashed, and discarded: there is no password to know.
      crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', v_name,
        'display_name', v_display,
        'account_type', 'customer',
        'role', 'owner',
        'org_slug', (select slug from public.organisations where id = my_org),
        'invited_by', me::text,
        'lead_import', true
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
  else
    update auth.users set email = v_email, updated_at = now()
     where id = v_uid and lower(coalesce(email, '')) is distinct from v_email;
  end if;

  -- The profile row comes from the on_auth_user_created trigger. phone_verified_at stays null:
  -- Monday supplied the number, the customer has not proved it. The phone prompt is marked as
  -- skipped so the first-login gate never applies if access is granted later.
  perform set_config('app.phone_write', 'on', true);
  update public.profiles
     set org_id = my_org,
         full_name = v_name,
         display_name = coalesce(nullif(v_display, ''), display_name),
         email = v_email,
         phone = coalesce(p_phone, phone),
         phone_verified_at = case when p_phone is not null then null else phone_verified_at end,
         email_notifications = 'off',
         whatsapp_notifications = 'instant',
         lead_category = p_lead_category,
         portal_access = false,
         monday_person_id = v_item,
         phone_prompt_skipped_at = coalesce(phone_prompt_skipped_at, now())
   where id = v_uid;
  perform set_config('app.phone_write', '', true);

  -- conversation_members_one_owner_group (0018) is satisfied: a lead has no other owner group.
  insert into public.conversation_members (conversation_id, user_id, org_id, member_side, last_read_at)
  values (c.id, v_uid, my_org, 'external', now())
  on conflict (conversation_id, user_id) do update set member_side = 'external';

  if v_created then
    -- kind = 'system' never notifies (0019), and sent_via = 'import' says how they got here.
    insert into public.messages (org_id, conversation_id, sender_id, body, kind, meta, sent_via)
    values (my_org, c.id, null,
            format('%s has been added to this conversation by %s.', v_name,
                   (select display_name from public.profiles where id = me)),
            'system',
            jsonb_build_object('event', 'member_joined', 'user_id', v_uid::text, 'added_by', me::text, 'lead_import', true),
            'import');
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me,
          case when v_created then 'lead_customer.imported' else 'lead_customer.updated' end,
          'profile', v_uid::text,
          jsonb_build_object('email', v_email, 'phone', p_phone, 'lead_category', p_lead_category,
                             'monday_item_id', v_item, 'conversation_id', c.id));

  return v_uid;
end $$;
revoke all on function public.import_lead_customer(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.import_lead_customer(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. my_conversations: lead_category
-- ---------------------------------------------------------------------------
-- The return type changes, so the function is dropped and recreated. Body is 0010's verbatim
-- with one column appended: for an owner group, the lead category of its external member.
drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (
  id uuid, type public.conversation_type, name text, slug text, topic text, description text, is_private boolean,
  owner_user_id uuid, created_at timestamptz, last_message_at timestamptz, archived_at timestamptz,
  muted boolean, starred boolean, notify_level text, last_read_at timestamptz,
  unread_count bigint, mention_count bigint, member_count bigint, member_ids uuid[],
  last_message_body text, last_message_sender_id uuid, last_message_kind public.message_kind,
  lead_category text
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
         lm.body, lm.sender_id, lm.kind,
         case when c.type = 'owner' then
           (select p.lead_category
              from public.conversation_members x
              join public.profiles p on p.id = x.user_id
             where x.conversation_id = c.id and x.member_side = 'external' and p.lead_category is not null
             order by x.joined_at limit 1)
         end as lead_category
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
-- 4. enqueue_message_notifications: mirrored messages do not go back out
-- ---------------------------------------------------------------------------
-- A message captured from WhatsApp or email (meta.mirrored = true) is one the other party
-- already has — they sent it, or it was sent to them on that channel. Notifying them would
-- deliver it twice, and for WhatsApp would arrive back at the webhook as another "sent" event.
-- Body is 0019's verbatim (which already carries 0014's manual-away clause) plus the one check.
create or replace function public.enqueue_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare conv public.conversations%rowtype; sender_name text; member record; v_payload jsonb;
begin
  if new.visibility <> 'public' or new.kind not in ('text', 'document') or new.deleted_at is not null then return null; end if;
  if coalesce(new.meta->>'mirrored', '') = 'true' then return null; end if;
  select * into conv from public.conversations where id = new.conversation_id;
  select display_name into sender_name from public.profiles where id = new.sender_id;
  for member in
    select p.id, p.email, p.phone, p.display_name, p.email_notifications, p.whatsapp_notifications
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.conversation_id = new.conversation_id
       and cm.user_id is distinct from new.sender_id
       and cm.member_side = 'external'
       and cm.muted = false
       and cm.notify_level <> 'none'
       and (cm.notify_level = 'all' or new.meta->'mentions' ? p.id::text or new.parent_id is not null)
       and (new.parent_id is null or exists (select 1 from public.thread_follows f where f.message_id = new.parent_id and f.user_id = p.id))
       and p.deactivated_at is null
       and (p.dnd_until is null or p.dnd_until < now())
       -- Manual away silences every notification until it is cleared or expires.
       and not (coalesce(p.presence_mode, 'auto') = 'away'
                and (p.away_until is null or p.away_until > now()))
  loop
    v_payload := jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id, 'conversation_type', conv.type,
      'conversation_name', conv.name, 'sender_id', new.sender_id,
      'sender_name', coalesce(sender_name, 'Stayful'), 'recipient_name', member.display_name,
      'body', left(new.body, 2000), 'created_at', new.created_at,
      'parent_id', new.parent_id, 'sent_via', new.sent_via);

    if member.email is not null and member.email_notifications = 'instant' then
      insert into public.notification_outbox (org_id, kind, channel, recipient_user_id, recipient_email, payload)
      values (new.org_id, 'message', 'email', member.id, member.email, v_payload)
      on conflict do nothing;
    end if;

    if member.phone is not null and member.whatsapp_notifications = 'instant' then
      insert into public.notification_outbox (org_id, kind, channel, recipient_user_id, recipient_phone, payload)
      values (new.org_id, 'message', 'whatsapp', member.id, member.phone, v_payload)
      on conflict do nothing;
    end if;
  end loop;
  return null;
end $$;
-- The messages_notify trigger itself (0006) is unchanged.
