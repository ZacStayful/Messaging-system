-- 0037_outbox_dead_status.sql
-- A notification that has been given up on should say so.
--
-- The drain selects `.lt("attempts", MAX_ATTEMPTS)`, so at five attempts a row simply stops being
-- picked up. It is left as status='failed', which is exactly what a row that failed once and will
-- be retried next minute also looks like: the only thing distinguishing "will be retried" from
-- "abandoned" is an integer nobody queries. Nothing logs it, nothing alerts, and no UI reads
-- notification_outbox — its only policy is an admin SELECT for debugging. A customer who was
-- never reached is indistinguishable from one who was.
--
-- 'dead' is a state the row can be left in honestly. The point is not the string; it is that the
-- give-up becomes a thing that happened rather than an absence, so it can be counted, queried and
-- acted on.
alter table public.notification_outbox drop constraint if exists notification_outbox_status_check;
alter table public.notification_outbox add constraint notification_outbox_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'dead'));

-- The org_id foreign key had no covering index (Supabase performance advisor). Cheap to add while
-- the table is already being altered, and this is the column a per-organisation query would use.
create index if not exists notification_outbox_org_idx on public.notification_outbox (org_id);
