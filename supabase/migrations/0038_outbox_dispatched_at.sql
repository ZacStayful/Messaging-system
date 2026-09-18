-- 0038_outbox_dispatched_at.sql
-- Tell "never sent" apart from "sent, but we died before writing it down".
--
-- The claim (0029) stops two concurrent runs sending the same row. It does nothing about a single
-- run dying between the provider accepting a message and the UPDATE that records it: the row is
-- left in 'sending', the stranded-claim rescue returns it to 'pending' ten minutes later, and it
-- goes out again. The recipient gets it twice, and nothing anywhere knows.
--
-- One column closes the gap. dispatched_at is written immediately *before* the provider call, so
-- a row picked up with it already set is one a previous attempt had handed over. That is not the
-- same as knowing it arrived — nothing our side can know that — but it is the difference between
-- "safe to send" and "find out first", and each channel answers it differently:
--
--   * email  — Resend accepts an Idempotency-Key (256 chars, kept 24 hours), so the retry is
--              genuinely exactly-once: the same key returns the original response instead of
--              sending again.
--   * whatsapp — TimelinesAI has no idempotency mechanism at all: its send endpoint takes phone,
--              text, whatsapp_account_id, label and chat_id, and nothing else. So the worker asks
--              instead, reading the chat's recent outbound history before it resends. A duplicate
--              WhatsApp is visible to the customer and repeated ones cost the number its standing,
--              which is why it is worth an extra read on a path this rare.
alter table public.notification_outbox add column if not exists dispatched_at timestamptz;

comment on column public.notification_outbox.dispatched_at is
  'Set immediately before the provider call. Non-null on a claimed row means a previous attempt reached the provider and the outcome is unknown.';
