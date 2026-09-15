-- 0013_profiles_update_policy.sql
-- The profiles update policy looked the caller's own row up in profiles inside WITH CHECK,
-- which Postgres rejects as infinite policy recursion, so nobody could save a status, name
-- or photo. Move the "no self-promotion" rule into a trigger and keep the policy simple.
alter policy "profiles: update own" on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and org_id = (select public.auth_org_id()));

create or replace function public.profiles_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.account_type <> old.account_type or new.role <> old.role or new.org_id <> old.org_id
      or new.email is distinct from old.email or new.deactivated_at is distinct from old.deactivated_at)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'only an admin can change roles, emails or account types';
  end if;
  return new;
end $$;
revoke execute on function public.profiles_guard_update() from public, anon, authenticated;
drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.profiles_guard_update();
