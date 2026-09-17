-- 0029_security_fixes.sql
-- Five holes found by auditing the schema against the app, in the order they matter.
--
-- Four of them share one shape: a policy or a function that checks *who* you are and forgets to
-- check *which row* you are touching. 0028 fixed that shape for three SECURITY DEFINER functions
-- that trusted a p_org argument. These are the same mistake in UPDATE policies, where it is
-- easier to miss because the INSERT policy alongside them usually gets it right.

-- ---------------------------------------------------------------------------
-- 1. Sign-up metadata is not a source of truth
-- ---------------------------------------------------------------------------
-- handle_new_user read org_slug, account_type and role straight out of raw_user_meta_data. On
-- Supabase that is the `data` field of POST /auth/v1/signup, which anyone holding the publishable
-- key can call. `{"org_slug":"stayful","account_type":"team","role":"admin"}` therefore minted an
-- admin of this organisation, and an admin can reset any customer's password and sign in as them.
--
-- The two paths that legitimately carry that metadata are create_customer_account and
-- create_team_account, which insert into auth.users themselves and rely on this trigger to build
-- the profile. They announce themselves with a transaction-local flag, exactly as
-- confirm_phone_verification does with app.phone_write and for the same reason: SECURITY DEFINER
-- swaps the database role, not the JWT, so there is nothing else in the trigger that can tell the
-- two callers apart. PostgREST does not expose set_config and gives each request its own
-- transaction, and `authenticated` cannot insert into auth.users at all, so a client can neither
-- raise the flag nor reach the trigger with it raised.
--
-- Untrusted sign-ups still get a profile. They get a customer one, in the organisation the email
-- domain or the default setting chooses — never one they asked for.
--
-- This is a backstop, not a substitute for turning self-service sign-up off in the project's auth
-- settings. Anyone who can create an account is still inside the tenant, even as a customer.
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
  -- Only create_customer_account, create_team_account and the seed raise this.
  v_trusted   boolean := coalesce(current_setting('app.trusted_signup', true), '') = 'on';
begin
  -- 1. explicit org via metadata (invitations only), 2. team domain match, 3. default org
  if v_trusted and meta ? 'org_slug' then
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

  if v_trusted and meta ? 'account_type' then
    v_account := (meta->>'account_type')::public.account_type;
  end if;
  v_account := coalesce(v_account, 'customer');

  if v_trusted and meta ? 'role' then
    v_role := (meta->>'role')::public.user_role;
  else
    v_role := case when v_account = 'team' then 'staff' else 'owner' end;
  end if;

  -- Names are cosmetic and are taken from whoever signed up, trusted or not.
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

-- The two callers that are allowed to say what they are creating. Identical to their previous
-- definitions but for the set_config on either side of the auth.users insert.
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

  perform set_config('app.trusted_signup', 'on', true);
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
  perform set_config('app.trusted_signup', 'off', true);
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

create or replace function public.create_team_account(
  p_email text, p_full_name text, p_display_name text, p_password text, p_role public.user_role default 'staff'
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); my_org uuid; v_email text := lower(trim(p_email)); v_uid uuid := gen_random_uuid();
  v_display text := coalesce(nullif(trim(p_display_name), ''), split_part(trim(p_full_name), ' ', 1));
begin
  if me is null or not public.is_admin() then raise exception 'only Stayful admins can add team members'; end if;
  select org_id into my_org from public.profiles where id = me;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email address'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'password must be at least 10 characters'; end if;
  if p_role not in ('staff', 'admin') then raise exception 'team members are staff or admins'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'an account already exists for %', v_email; end if;
  perform set_config('app.trusted_signup', 'on', true);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email, crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', trim(p_full_name), 'display_name', v_display, 'account_type', 'team', 'role', p_role::text,
                             'org_slug', (select slug from public.organisations where id = my_org), 'invited_by', me::text),
          now(), now(), '', '', '', '', false);
  perform set_config('app.trusted_signup', 'off', true);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text, jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());
  update public.profiles set org_id = my_org, account_type = 'team', role = p_role where id = v_uid;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'team.created', 'profile', v_uid::text, jsonb_build_object('email', v_email, 'role', p_role::text));
  return v_uid;
end $$;
revoke all on function public.create_team_account(text, text, text, text, public.user_role) from public, anon;
grant execute on function public.create_team_account(text, text, text, text, public.user_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A member could move their own membership row into any conversation
-- ---------------------------------------------------------------------------
-- "members: update own read state" exists so you can mark a conversation read, mute it, star it
-- or change its notify level. Its WITH CHECK pinned user_id and org_id and said nothing about
-- conversation_id, which is an ordinary updatable column — and the three triggers on this table
-- are all BEFORE INSERT or AFTER INSERT OR DELETE, so nothing else looked either.
--
-- One PATCH moved your own row to any conversation id in the organisation. is_member() then
-- returned true for it, which is the predicate behind reading its messages, its attachments in
-- storage, and its private realtime topic. Conversation ids are not secret: they are the URL.
-- The cleanest case was a customer who had been removed from a group putting themselves back.
--
-- Pinning conversation_id to a conversation you are already in keeps every legitimate use (they
-- all write to the row you are looking at) and removes the teleport.
alter policy "members: update own read state" on public.conversation_members
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- 3. A scheduled message could be rewritten after its checks had passed
-- ---------------------------------------------------------------------------
-- The insert policy proves you are a member of the conversation you are scheduling into, and that
-- only the team may schedule an internal note. The update policy checked sender_id and nothing
-- else, so conversation_id, org_id, parent_id and visibility were all rewritable afterwards —
-- and the cron that posts these rows does so with the service role, re-validating nothing
-- (src/app/api/cron/notifications/route.ts). Schedule into your own group, PATCH the row, and a
-- minute later the message appears in a channel you cannot even read.
--
-- The update now carries the same predicates as the insert. Deliberately not a narrower "only
-- these columns may change" rule: matching the insert policy means the two cannot drift.
alter policy "scheduled: edit own" on public.scheduled_messages
  using (sender_id = (select auth.uid()))
  with check (
    sender_id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
    and (visibility = 'public' or (select public.is_team()))
  );

-- ---------------------------------------------------------------------------
-- 4. Internal notes were broadcast to the customers they were about
-- ---------------------------------------------------------------------------
-- "messages: members read (internal notes team-only)" keeps visibility='internal' away from
-- customers on every read that goes through the table. The realtime path did not: the trigger
-- broadcast every row to conversation:<id>, and the policy authorising that topic can only see
-- the topic name, not the row, so it had nothing to filter on.
--
-- The effect was live and invisible. A team member writing a note about a customer had it render
-- in that customer's open tab, and it disappeared on reload, because a reload reads the table.
--
-- Since a topic policy can only reason about the topic, internal notes get their own topic.
-- conversation-internal:<id> is authorised by membership *and* is_team(), so the same broadcast
-- that used to reach everyone now reaches nobody who should not see it.
create or replace function public.topic_internal_conversation_id(topic text)
returns uuid language sql immutable as $$
  select case
    when topic ~ '^conversation-internal:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(topic from 23)::uuid
    else null
  end
$$;
revoke all on function public.topic_internal_conversation_id(text) from public, anon;
grant execute on function public.topic_internal_conversation_id(text) to authenticated;

create policy "realtime: team receives internal conversation events"
  on realtime.messages for select to authenticated
  using (
    public.topic_internal_conversation_id(realtime.topic()) is not null
    and public.is_member(public.topic_internal_conversation_id(realtime.topic()))
    and (select public.is_team())
  );

-- No matching insert policy: this topic carries database broadcasts only. Typing indicators and
-- presence stay on conversation:<id>, which every member may already write to.

create or replace function public.broadcast_message_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec public.messages;
  member record;
  sender_name text;
  v_topic text;
begin
  rec := coalesce(new, old);
  v_topic := case when rec.visibility = 'internal' then 'conversation-internal:' else 'conversation:' end
             || rec.conversation_id::text;
  perform realtime.broadcast_changes(v_topic, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);

  -- A message that changes visibility moves topic, so the clients on the old one keep their copy
  -- until they reload. That is stale, not leaked: public->internal was already visible to them,
  -- and internal->public arrives on the public topic as an ordinary update.

  if tg_op = 'INSERT' then
    select display_name into sender_name from public.profiles where id = rec.sender_id;
    -- The personal topic carries a 160-character preview of the body, so it needs the same rule.
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

-- ---------------------------------------------------------------------------
-- 5. The outbox claim was not a claim
-- ---------------------------------------------------------------------------
-- Two bugs, one column apart.
--
-- The stranded-row rescue asked for rows whose *created_at* was more than ten minutes old, not
-- rows whose *claim* was. There was no claim timestamp to ask about. Any row that had waited in
-- the queue longer than that — every row, after Resend was briefly unconfigured, or behind a
-- WhatsApp burst over WHATSAPP_MAX_PER_RUN — was handed back to the next run the instant it was
-- claimed, while the run holding it was still sending. Two of every message.
--
-- And the claim itself was a SELECT followed by an unconditional UPDATE. The cron is scheduled
-- every minute with maxDuration 60, so two runs overlap by design; both selected the same rows,
-- both wrote status='sending', and both sent. claimed_at gives the rescue something true to ask,
-- and the route now claims with a single conditional UPDATE ... RETURNING so the second run
-- comes back with nothing instead of a duplicate.
alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;

-- Rows sitting in 'sending' right now were claimed by the old code and have no claimed_at, so
-- the new rescue would never see them. created_at is the best guess available and errs towards
-- rescuing, which is what the old predicate did anyway.
update public.notification_outbox set claimed_at = created_at
 where status = 'sending' and claimed_at is null;

create index if not exists notification_outbox_claimed_idx
  on public.notification_outbox (claimed_at) where status = 'sending';

comment on column public.notification_outbox.claimed_at is
  'When a worker took this row. Null unless status = ''sending''. The stranded-row rescue keys on this, never on created_at.';
