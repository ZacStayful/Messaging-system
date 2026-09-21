-- Does api_rate_hit actually behave like a token bucket?
--
-- 0040 replaced a fixed window with a bucket, and the reason was a specific bug: at a window
-- boundary a key could spend its whole allowance twice within a second or two. That bug lived
-- entirely inside a plpgsql body, so nothing that parses SQL could have caught it, and nothing in
-- the TypeScript suite can reach it either — the function is revoked from every role the app's
-- own clients use.
--
-- So it is asserted here, against a real Postgres, with no network and no production writes.
--
-- Time is moved by rewinding updated_at rather than by waiting. That is not only faster: inside a
-- single transaction now() is frozen, so pg_sleep would advance nothing and every assertion below
-- would be measuring the same instant. It also means these cannot be written as a differential
-- test against the old fixed window — that bug needed the wall clock to roll past a window
-- boundary, which no amount of rewinding a row simulates. What follows asserts the properties a
-- bucket must have; the boundary one is the property whose absence *was* the bug.
do $check$
declare
  v_org  uuid;
  v_user uuid;
  v_key  uuid;
  i      int;
  v      boolean;
  v_tok  double precision;
begin
  insert into public.organisations (name, slug) values ('Check org', 'check-org') returning id into v_org;
  v_user := gen_random_uuid();
  -- A trigger on auth.users creates the profile (0001), so this updates it into the org made
  -- above rather than inserting a second one.
  -- 0046 makes handle_new_user reject an untrusted insert, the way it does for a self-service
  -- sign-up. A fixture is creating the account the same way the app does, so it announces itself
  -- the same way every legitimate creator does.
  perform set_config('app.trusted_signup', 'on', true);
  insert into auth.users (id, email) values (v_user, 'check@example.test');
  update public.profiles set org_id = v_org, display_name = 'Check user', account_type = 'team'
   where id = v_user;
  insert into public.api_keys (org_id, user_id, name, key_hash, key_prefix, scopes)
  values (v_org, v_user, 'check', repeat('a', 64), 'sk_check_0000', '{}')
  returning id into v_key;

  -- A key seen for the first time starts full, so the whole allowance is available at once.
  for i in 1..5 loop
    if not public.api_rate_hit(v_key, 5, 60) then
      raise exception 'request % of a full bucket was refused', i;
    end if;
  end loop;

  -- And then it is empty.
  if public.api_rate_hit(v_key, 5, 60) then
    raise exception 'the bucket allowed a 6th request against a limit of 5';
  end if;

  -- The property the fixed window did not have. There, a key that exhausted its allowance just
  -- before a window boundary got the whole allowance back a second later — 2x the limit inside
  -- two seconds. A bucket has no boundary to cross, so a second of idling is worth a second's
  -- refill and nothing more: 5/60 of a token, which does not buy a request.
  update public.api_rate_buckets set updated_at = now() - interval '1 second' where key_id = v_key;
  if public.api_rate_hit(v_key, 5, 60) then
    raise exception 'a second of idling refilled a whole request: the window boundary bug is back';
  end if;

  -- A refused request must not be charged for. If it were, a client hammering a closed door would
  -- dig a deficit and stay locked out long after it had the right to be served again.
  select tokens into v_tok from public.api_rate_buckets where key_id = v_key;
  if v_tok < 0 then
    raise exception 'a refused request was charged: balance went to %', v_tok;
  end if;

  -- Refill is continuous and proportional: half a window earns half an allowance.
  update public.api_rate_buckets set tokens = 0, updated_at = now() - interval '30 seconds'
   where key_id = v_key;
  if not public.api_rate_hit(v_key, 5, 60) then
    raise exception 'half a window of idling did not earn a single request';
  end if;
  select tokens into v_tok from public.api_rate_buckets where key_id = v_key;
  if abs(v_tok - 1.5) > 0.01 then
    raise exception 'half a window of idling should leave 1.5 tokens after spending one, left %', v_tok;
  end if;

  -- Idle time is worth something, but not unlimited: the balance caps at the limit. Without the
  -- cap a key quiet overnight would wake up able to spend thousands of requests at once.
  update public.api_rate_buckets set updated_at = now() - interval '1 day' where key_id = v_key;
  if not public.api_rate_hit(v_key, 5, 60) then
    raise exception 'a day of idling left the bucket empty';
  end if;
  select tokens into v_tok from public.api_rate_buckets where key_id = v_key;
  if v_tok > 4 then
    raise exception 'a day of idling banked more than the limit: % tokens after spending one', v_tok;
  end if;

  -- The balance never goes below zero, even if the server's clock steps backwards and the elapsed
  -- term comes out negative. Without the clamp the key would be throttled harder than its own
  -- limit until the clock caught up, which is the deficit the refusal branch exists to prevent.
  update public.api_rate_buckets set tokens = 0, updated_at = now() + interval '1 hour'
   where key_id = v_key;
  if public.api_rate_hit(v_key, 5, 60) then
    raise exception 'a bucket with a future timestamp allowed a request';
  end if;
  select tokens into v_tok from public.api_rate_buckets where key_id = v_key;
  if v_tok < 0 then
    raise exception 'a clock stepping backwards drove the balance to %', v_tok;
  end if;

  -- A nonsensical limit must refuse, not read as "unlimited".
  if public.api_rate_hit(v_key, 0, 60) then
    raise exception 'a limit of 0 allowed a request';
  end if;

  -- last_used_at is stamped inside this function (0017) because a separate un-awaited call was
  -- being dropped by the serverless runtime before it ran.
  if (select last_used_at from public.api_keys where id = v_key) is null then
    raise exception 'api_rate_hit did not stamp last_used_at';
  end if;

  -- One row per key, removed with the key. This is what replaced the sweep that 0016 added and
  -- 0035 had to sample down; if the cascade ever goes, the table grows for ever again in silence.
  delete from public.api_keys where id = v_key;
  if exists (select 1 from public.api_rate_buckets where key_id = v_key) then
    raise exception 'the bucket outlived the key it belongs to';
  end if;

  raise notice 'token bucket: all assertions passed';
end $check$;
