-- 0017_api_key_last_used.sql
-- last_used_at never updated, because the wrapper fired api_touch_key as an un-awaited
-- promise (`void admin.rpc(...)`). On a serverless runtime the function is frozen as soon as
-- the response is returned, so a dangling promise is simply dropped — the admin UI's
-- "last used" column stayed empty however much a key was used, which is exactly the signal
-- someone needs to spot a key that should have been revoked months ago.
--
-- Rather than pay a second awaited round trip, fold the stamp into api_rate_hit, which
-- already runs once per authenticated request and is already awaited. api_touch_key then has
-- no caller and is dropped.

create or replace function public.api_rate_hit(p_key_id uuid, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz; n int;
begin
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.api_rate_limits (key_id, window_start, count)
  values (p_key_id, w, 1)
  on conflict (key_id, window_start)
    do update set count = public.api_rate_limits.count + 1
  returning count into n;

  -- Stamped here so it cannot be lost to a dropped promise. Same transaction, no extra trip.
  update public.api_keys set last_used_at = now() where id = p_key_id;

  -- Opportunistic sweep; there is no cron for this and the table would otherwise grow forever.
  delete from public.api_rate_limits where window_start < now() - interval '1 hour';
  return n <= p_limit;            -- false = over the limit, reject the request
end $$;
revoke all on function public.api_rate_hit(uuid, int, int) from public, anon, authenticated;

drop function if exists public.api_touch_key(uuid);
