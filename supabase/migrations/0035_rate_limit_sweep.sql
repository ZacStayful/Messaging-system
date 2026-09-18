-- 0035_rate_limit_sweep.sql
-- Stop the rate limiter from being the thing that overloads the database.
--
-- api_rate_hit (0016, revised 0017) ends with an unconditional
--   delete from api_rate_limits where window_start < now() - interval '1 hour'
-- which runs on *every single API request*. window_start is the trailing column of the primary
-- key (key_id, window_start), so no index can satisfy that predicate: it is a sequential scan
-- per request, plus the WAL and the locks of a delete.
--
-- That matters more than a slow query, because 0016's own comment calls the sweep
-- "opportunistic". Under load it is a source of the statement timeouts that used to make
-- api_rate_hit return an error — which the caller then discarded, letting the request through.
-- The limiter's own housekeeping was helping to switch the limiter off.
--
-- Two changes: an index that makes the delete an index scan, and a sweep that runs about once
-- in a thousand requests instead of every one. At 600 requests per key per minute that is still
-- several times an hour, which is ample for a table whose rows are an hour old when they die.
create index if not exists api_rate_limits_window_idx on public.api_rate_limits (window_start);

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

  -- Sampled, not every call. There is still no cron for this table, and it would otherwise
  -- grow forever.
  if random() < 0.001 then
    delete from public.api_rate_limits where window_start < now() - interval '1 hour';
  end if;

  return n <= p_limit;            -- false = over the limit, reject the request
end $$;
revoke all on function public.api_rate_hit(uuid, int, int) from public, anon, authenticated;

-- Note on the "RLS enabled, no policy" advisor warning for api_rate_limits: that is the intended
-- state, not an oversight. Nothing but this function writes the table, it is security definer and
-- called with the service role, and tests/rls.test.ts already asserts that a signed-in user can
-- neither read the table nor call the function. Adding a permissive policy to quieten the linter
-- would be the only way to make it genuinely unsafe.
