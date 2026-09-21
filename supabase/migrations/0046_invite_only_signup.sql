-- 0046_invite_only_signup.sql
-- Accounts are created by Stayful. Nobody signs themselves up.
--
-- handle_new_user (0029) builds a profile for any insert into auth.users, including one the
-- person made themselves. The publishable key ships in the browser by design, so with
-- self-service sign-up left on, anyone can POST /auth/v1/signup, confirm their own address and
-- end up with a customer profile inside this organisation. 0029's own header said so and left
-- it:
--
--   "This is a backstop, not a substitute for turning self-service sign-up off in the project's
--    auth settings. Anyone who can create an account is still inside the tenant, even as a
--    customer."
--
-- This is that change, made in the database rather than only in a dashboard checkbox.
--
-- What it is worth, honestly. Nobody has used it: every account on the project was created by
-- Stayful. And RLS means a stranger who did sign up would read nothing — "profiles: read"
-- (0005) needs is_team() or shares_conversation_with(), and every other table gates on
-- conversation_members, so somebody in no conversation sees only their own row. What they would
-- have is a valid session against the app, and a profile sitting in the People directory for a
-- team member to puzzle over. A foothold and some litter, not a way into anything.
--
-- Why app.trusted_signup is an exact test. Five writers raise it, and they are the only ways an
-- account is legitimately made: create_customer_account and create_team_account (0029),
-- import_lead_customer (0034), import_slack_account (0042), and the seed. Nothing else can.
-- PostgREST does not expose set_config and gives each request its own transaction,
-- `authenticated` cannot insert into auth.users at all, and no code path in the app calls
-- auth.admin.createUser. So its absence means precisely "somebody signed themselves up".
--
-- What this does NOT affect: signing in (nothing here runs unless a row is being inserted),
-- invitations, the lead import, the Slack import, or the seed.
--
-- What it DOES break, on purpose: "Add user" in the Supabase dashboard, which is an untrusted
-- insert like any other. Use /customers/new or /team/new, which set the organisation, the role
-- and the group membership that a bare auth user has none of.
--
-- Belt and braces. "Allow new users to sign up" should also be off in Authentication > Sign In /
-- Providers. That is the gate people actually meet: GoTrue refuses before reaching this insert,
-- so a caller gets a clean signup_disabled rather than a database error. It is also one click to
-- undo and is not in version control. This is the half that holds.
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
  -- Only create_customer_account, create_team_account, import_lead_customer,
  -- import_slack_account and the seed raise this.
  v_trusted   boolean := coalesce(current_setting('app.trusted_signup', true), '') = 'on';
begin
  -- The whole of this change. Everything below is unchanged from 0029.
  if not v_trusted then
    raise exception 'Sign-up is by invitation only'
      using hint = 'Create the account at /customers/new or /team/new, or import it from the lead database board.';
  end if;

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
