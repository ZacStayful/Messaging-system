-- 0026_integrations.sql
-- The Monday.com integration: its switch, its delivery log, and its idempotency record.
--
-- The switch exists because this ships before it is wanted. Monday can be pointed at the webhook
-- and real payloads watched arriving for as long as it takes to trust them, with the integration
-- doing nothing at all, and then be turned on from the app rather than by a deploy.

-- ---------------------------------------------------------------------------
-- integrations
-- ---------------------------------------------------------------------------
-- A table rather than a key in organisations.settings: settings is read on the hot path by
-- team-domain resolution and is edited by hand in the dashboard, and an integration that can be
-- switched on by mistyping a jsonb blob is not a switch.
--
-- config holds:
--   actor_user_id      uuid   the team member the integration acts as (see below)
--   standard_member_ids uuid[] who joins every group it creates
create table if not exists public.integrations (
  org_id     uuid not null references public.organisations (id) on delete cascade,
  key        text not null,
  enabled    boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table public.integrations enable row level security;
create policy "integrations: team reads"
  on public.integrations for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
create policy "integrations: admins write"
  on public.integrations for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_admin()));

-- Off. This is the entire point of the row existing before anything uses it.
insert into public.integrations (org_id, key, enabled)
select id, 'monday_clients', false from public.organisations
on conflict (org_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- monday_events
-- ---------------------------------------------------------------------------
-- Every delivery, whether or not it did anything. Two jobs:
--   1. dedupe. Monday retries, and a retry must not create a second pair of groups.
--   2. visibility. A switched-off integration that logs nothing is indistinguishable from a
--      webhook that was never configured, which is the exact question this is meant to answer.
--
-- No org_id: a delivery for a board we do not recognise has no org to attribute it to, which is
-- the same reasoning as inbound_messages_unmatched (0020).
create table if not exists public.monday_events (
  id          bigint generated always as identity primary key,
  event_id    text,
  board_id    text,
  item_id     text,
  event_type  text,
  payload     jsonb not null default '{}'::jsonb,
  -- created | skipped_disabled | skipped_board | skipped_group | skipped_event | duplicate |
  -- no_address | error
  outcome     text not null,
  error       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists monday_events_event_idx
  on public.monday_events (event_id) where event_id is not null;
create index if not exists monday_events_recent_idx on public.monday_events (created_at desc);

alter table public.monday_events enable row level security;
-- Read-only for the team; the webhook writes with the service role. Admins configure the
-- integration, but anyone on the team debugging "did that client come through?" should be able
-- to look without being made an admin first.
create policy "monday events: team reads"
  on public.monday_events for select to authenticated
  using ((select public.is_team()));

-- ---------------------------------------------------------------------------
-- monday_links
-- ---------------------------------------------------------------------------
-- What a Monday item produced. The unique event id above catches a literal redelivery; this
-- catches the rest — a replayed payload, a manual re-fire, a new event id for an item we have
-- already provisioned. Together they are why the webhook can be called repeatedly and still
-- only ever create one pair of groups.
create table if not exists public.monday_links (
  org_id                    uuid not null references public.organisations (id) on delete cascade,
  monday_item_id            text not null,
  board_id                  text,
  customer_conversation_id  uuid references public.conversations (id) on delete set null,
  property_conversation_id  uuid references public.conversations (id) on delete set null,
  property_id               uuid references public.properties (id) on delete set null,
  created_at                timestamptz not null default now(),
  primary key (org_id, monday_item_id)
);
alter table public.monday_links enable row level security;
create policy "monday links: team reads"
  on public.monday_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
