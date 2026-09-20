-- 0044_outbox_idempotency_key.sql
-- The key a send went out under, kept on the rows it was made of.
--
-- 0038 added dispatched_at so a run that died between Resend accepting a message and the UPDATE
-- recording it could be recognised on the way back. For email that recognition was supposed to
-- come from the idempotency key instead: replay the same key and Resend replays its own answer
-- rather than sending twice.
--
-- That only works while the key is reproducible, and it is not. The key is a hash of the outbox
-- row ids in the batch and lives only inside the request that computes it. finish() then updates
-- the batch one row at a time, so a run killed partway through — maxDuration is 60 seconds and a
-- run can hold 200 rows — leaves some rows 'sent' and the rest 'sending'. Ten minutes later the
-- rescue returns the remainder alone, a strict subset, which hashes to a key Resend has never
-- seen. The recipient reads the same message twice.
--
-- Persisting the key closes it: a rescued row carries the key its email actually went out under,
-- is re-batched by that key alone, and replays byte-identically.
--
-- Deliberately not unique. Every row of a batch carries the same key, which is the point.
alter table public.notification_outbox add column if not exists idempotency_key text;

comment on column public.notification_outbox.idempotency_key is
  'The Idempotency-Key this row''s email was handed to Resend under, written with dispatched_at. A rescued row re-batches by this key alone so the replay is byte-identical; a row without one has never been dispatched and batches by recipient and conversation as usual.';

-- Finding the siblings of a rescued row. Partial, because the column is null until a first
-- dispatch and stays null for every row that never reaches one.
create index if not exists notification_outbox_idempotency_key_idx
  on public.notification_outbox (idempotency_key)
  where idempotency_key is not null;
