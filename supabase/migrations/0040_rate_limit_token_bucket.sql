-- 0040_rate_limit_token_bucket.sql
-- Replace the fixed window with the token bucket 0016 said was the real answer.
--
-- 0016 was explicit that its fixed window was a stand-in: "A proper token bucket is a follow-up,
-- not a pretence made here." This is that follow-up.
--
-- The hole in a fixed window is the boundary. Windows are aligned to the epoch, so at 10:00:59 a
-- key can spend its whole allowance, and one second later a brand-new window hands it the whole
-- allowance again: 1200 requests in two seconds against a limit of 600 a minute. Nothing is
-- broken from the database's point of view — each window counted correctly — which is what makes
-- it easy to miss and hard to argue with when a client insists it stayed inside the limit.
--
-- A bucket has no boundaries to sit on. Every key holds a balance that refills continuously at
-- limit/window tokens a second, capped at limit. A request costs one token; no token, no request.
-- Idle time is still worth something — a key that has been quiet can spend up to a full bucket at
-- once, which is the same generosity the fixed window gave and the reason clients that batch keep
-- working — but the sustained rate cannot exceed the refill rate, and there is no instant at
-- which the allowance doubles.
--
-- Two things fall out of it, both worth more than the arithmetic:
--
--   * **The sweep is gone.** The old table grew a row per key per window for ever, so 0016 added
--     an unconditional delete on every request and 0035 had to sample it down to one in a
--     thousand and add an index to make it an index scan. A bucket is one row per key, removed by
--     the key's own `on delete cascade`. There is nothing left to sweep, so the housekeeping that
--     was helping to overload the database at exactly the wrong moment simply stops existing.
--
--   * **The signature does not change.** Still (uuid, int, int) returning boolean, still false for
--     "over". Old code calling the new function and new code calling the old one both behave, so
--     this migration and the deploy that goes with it can land in either order.

create table if not exists public.api_rate_buckets (
  key_id     uuid primary key references public.api_keys (id) on delete cascade,
  -- Fractional on purpose: a request costs exactly one token, but refill is continuous, and
  -- rounding the balance down on every hit would quietly tighten the limit.
  tokens     double precision not null,
  -- When the balance above was last correct. Everything since is owed to the key.
  updated_at timestamptz not null default now()
);
alter table public.api_rate_buckets enable row level security;  -- service role only; no policies

create or replace function public.api_rate_hit(p_key_id uuid, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_tokens  double precision;
  v_allowed boolean;
begin
  -- A nonsensical limit must not read as "unlimited". The caller's constants make this
  -- unreachable; it is here so that a future caller passing 0 is refused rather than waved past.
  if p_limit <= 0 or p_window_seconds <= 0 then
    return false;
  end if;

  -- First sight of a key: a full bucket. `do nothing` rather than `do update` so that two
  -- requests racing on a key's very first use cannot both reset it to full.
  insert into public.api_rate_buckets (key_id, tokens, updated_at)
  values (p_key_id, p_limit, now())
  on conflict (key_id) do nothing;

  -- `for update` is the whole concurrency story. Without it two requests arriving together would
  -- both read the same balance and both spend it, so the last token would be sold twice — the
  -- failure the old upsert avoided by never reading a balance at all. Concurrent hits on one key
  -- queue here; hits on different keys never meet, because the lock is on that key's row.
  --
  -- now() is the transaction timestamp, so the instant used to measure the refill is the same one
  -- written back below. A pair that disagreed would leak or lose tokens on every request.
  -- greatest(0, ...) keeps the invariant total: the balance is always between zero and the limit.
  -- The only way the elapsed term goes negative is the server's clock stepping backwards, which
  -- would otherwise push the balance below zero and leave the key throttled harder than its limit
  -- until the clock caught up — the same deficit the refusal branch below is written to avoid.
  select greatest(0,
           least(p_limit::double precision,
                 tokens + extract(epoch from (now() - updated_at)) * (p_limit::double precision / p_window_seconds)))
    into v_tokens
    from public.api_rate_buckets
   where key_id = p_key_id
     for update;

  v_allowed := v_tokens >= 1;

  -- A refused request still banks the refill, but is not charged for it. Charging anyway would
  -- let a client that keeps hammering dig itself into a deficit and stay locked out long after it
  -- had the right to be served again — punishing exactly the badly written retry loop this is
  -- supposed to slow down rather than break.
  update public.api_rate_buckets
     set tokens = case when v_allowed then v_tokens - 1 else v_tokens end,
         updated_at = now()
   where key_id = p_key_id;

  -- Stamped here so it cannot be lost to a dropped promise (0017). Same transaction, no extra
  -- trip. Deliberately stamped even when the request is refused: an admin looking for a key to
  -- revoke wants to know it is being used, and a key being refused is still a key in use.
  update public.api_keys set last_used_at = now() where id = p_key_id;

  return v_allowed;               -- false = over the limit, reject the request
end $$;
revoke all on function public.api_rate_hit(uuid, int, int) from public, anon, authenticated;

-- The fixed-window table and the index 0035 added to keep its sweep affordable. Nothing reads
-- either now, and the rows were never worth more than the minute they counted.
drop index if exists public.api_rate_limits_window_idx;
drop table if exists public.api_rate_limits;

-- The advisor note from 0035 carries over unchanged: "RLS enabled, no policy" on
-- api_rate_buckets is the intended state, not an oversight. Nothing but this function touches the
-- table, it is security definer and called with the service role, and tests/rls.test.ts asserts
-- that a signed-in user can neither read the table nor call the function. Adding a permissive
-- policy to quieten the linter would be the only way to make it genuinely unsafe.
