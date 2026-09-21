-- Can somebody sign themselves up, and can Stayful still create an account?
--
-- Both directions matter and both are asserted here. A gate that refuses everyone would pass a
-- test that only checks strangers are refused, and would take invitations, the lead import and
-- the Slack import down with it — every one of those inserts into auth.users and relies on this
-- trigger to build the profile.
--
-- The guard is one transaction-local flag, which is exactly the kind of thing a later
-- `create or replace` of handle_new_user can drop without anything failing until a stranger has
-- a profile in this organisation. That is what this file is for.
--
-- The cluster is shared and cumulative (checks run alphabetically against one database), so the
-- names below are unique to this file.
do $check$
declare
  v_org     uuid;
  v_user    uuid := gen_random_uuid();
  v_blocked uuid := gen_random_uuid();
  v_account public.account_type;
  v_raised  boolean := false;
begin
  insert into public.organisations (name, slug, settings)
  values ('Invite only org', 'invite-only-org', '{"team_domains": ["invite-only.test"]}'::jsonb)
  returning id into v_org;

  -- 1. Stayful creating an account: raise the flag, insert, let the trigger build the profile.
  --    This is what every legitimate writer does and it must still work.
  perform set_config('app.trusted_signup', 'on', true);
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_user, 'invited@invite-only.test', jsonb_build_object('full_name', 'Invited Person'));
  perform set_config('app.trusted_signup', 'off', true);

  select account_type into v_account from public.profiles where id = v_user;
  if v_account is null then
    raise exception 'a trusted sign-up got no profile: invitations and both imports are broken';
  end if;
  -- The address is on a team domain of the org above, so the rest of the trigger should still run.
  if v_account <> 'team' then
    raise exception 'a trusted sign-up was filed as %, not team: the trigger body changed', v_account;
  end if;

  -- 2. Somebody signing themselves up: POST /auth/v1/signup, or "Add user" in the dashboard.
  --    This must be refused.
  begin
    insert into auth.users (id, email) values (v_blocked, 'stranger@example.test');
  exception
    when others then v_raised := true;
  end;

  if not v_raised then
    raise exception 'an untrusted sign-up was accepted: anyone can join this tenant';
  end if;
  if exists (select 1 from public.profiles where id = v_blocked) then
    raise exception 'an untrusted sign-up was refused but left a profile behind';
  end if;

  -- 3. The flag is transaction-local and must not have leaked out of step 1. Were set_config's
  --    third argument ever dropped, step 2 would pass for the wrong reason and this file would
  --    go on saying everything was fine.
  if coalesce(current_setting('app.trusted_signup', true), '') = 'on' then
    raise exception 'app.trusted_signup is still raised: the flag is not transaction-local';
  end if;

  raise notice 'invite-only sign-up: all assertions passed';
end $check$;
