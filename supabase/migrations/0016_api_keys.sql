-- 0016_api_keys.sql
-- API keys for the public REST API and the MCP server.
--
-- A key acts on behalf of a real person: requests run with a short-lived token minted for that
-- user (src/lib/api/jwt.ts), so every existing RLS policy and every existing RPC applies
-- unchanged and there is no second copy of the authorisation rules to keep in step. This is
-- why no policy or function in the earlier migrations needed touching: auth.uid() is
-- load-bearing in all of them (add_members, my_conversations, create_customer_account, and
-- every audit_log write), and it resolves normally under a minted user token.

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations (id) on delete cascade,
  -- The person the key acts as. Messages it sends appear from them, with a "via API" chip.
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  -- sha256 hex of the plaintext. The plaintext is shown once at creation and never stored:
  -- a fast hash is right here because the key is 256 bits of randomness with no dictionary
  -- to attack, so bcrypt would only add latency to every request.
  key_hash     text not null unique,
  key_prefix   text not null,          -- "sk_live_a1b2c3" — for telling keys apart in the UI
  scopes       text[] not null default '{}',
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint api_keys_name_check check (length(btrim(name)) between 1 and 80)
);
create index if not exists api_keys_org_idx on public.api_keys (org_id);
create index if not exists api_keys_user_idx on public.api_keys (user_id);
alter table public.api_keys enable row level security;

-- Admins manage their own org's keys. Verification runs as the service role and so needs no
-- policy; key_hash is never selected by the browser.
create policy "api keys: admins read"
  on public.api_keys for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()));

create policy "api keys: admins create"
  on public.api_keys for insert to authenticated
  with check (org_id = (select public.auth_org_id())
              and (select public.is_admin())
              and created_by = (select auth.uid())
              -- A key may only act as an active team member of the same organisation. Without
              -- this an admin could mint a key acting as a customer and read their DMs.
              and exists (select 1 from public.profiles p
                           where p.id = user_id
                             and p.org_id = api_keys.org_id
                             and p.account_type = 'team'
                             and p.deactivated_at is null));

-- Revoking sets revoked_at; there is deliberately no delete policy, so a key's history and the
-- audit rows that point at it survive.
create policy "api keys: admins revoke"
  on public.api_keys for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()));

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
-- A fixed window counted in Postgres. Coarse, but it is the only stateful option available
-- without adding Redis, and one upsert per request is cheap. A proper token bucket is a
-- follow-up, not a pretence made here.
create table if not exists public.api_rate_limits (
  key_id       uuid not null references public.api_keys (id) on delete cascade,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key_id, window_start)
);
alter table public.api_rate_limits enable row level security;  -- service role only; no policies

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
  -- Opportunistic sweep; there is no cron for this and the table would otherwise grow forever.
  delete from public.api_rate_limits where window_start < now() - interval '1 hour';
  return n <= p_limit;            -- false = over the limit, reject the request
end $$;
revoke all on function public.api_rate_hit(uuid, int, int) from public, anon, authenticated;

-- Stamped on every authenticated request so an admin can see which keys are actually in use
-- (and spot one that should have been revoked months ago).
create or replace function public.api_touch_key(p_key_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.api_keys set last_used_at = now() where id = p_key_id;
$$;
revoke all on function public.api_touch_key(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency
-- ---------------------------------------------------------------------------
-- A retried POST must not post twice. meta.client_id is already stamped with a fresh
-- crypto.randomUUID() by the browser's send(), so ordinary traffic is unaffected and this
-- index was verified to create cleanly against existing data.
--
-- Note the behaviour change: a genuine double-submit (a retry after an insert that actually
-- succeeded) is now rejected rather than duplicating the message, and the optimistic row in
-- the composer flips to "failed" instead of appearing twice. That is the right outcome, but it
-- is a change.
create unique index if not exists messages_client_id_idx
  on public.messages (conversation_id, (meta->>'client_id'))
  where meta->>'client_id' is not null;
