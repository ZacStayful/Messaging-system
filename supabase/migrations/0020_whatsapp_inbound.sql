-- 0020_whatsapp_inbound.sql
-- WhatsApp replies land in the same conversation as anything else the customer sends, so the
-- team reads one thread and never has to know which app the message came from.

-- Mirrors messages_external_ref_email_idx (0007): a redelivered webhook is one message, not two.
-- TimelinesAI retries twice on a non-2xx, so this is load-bearing, not belt-and-braces.
create unique index if not exists messages_external_ref_whatsapp_idx
  on public.messages (external_ref) where sent_via = 'whatsapp' and external_ref is not null;

-- ---------------------------------------------------------------------------
-- Nothing a customer sends is ever silently dropped
-- ---------------------------------------------------------------------------
-- The email webhook returns { ignored: ... } for an unknown token, a non-member or an empty
-- body and keeps no record, so "did we miss anything?" has no answer today. Both channels write
-- here instead, and the webhook still answers 200 — a 4xx just makes the provider retry a
-- message that was never going to route.
create table if not exists public.inbound_messages_unmatched (
  id              bigint generated always as identity primary key,
  channel         text not null check (channel in ('whatsapp', 'email')),
  external_ref    text,
  from_identifier text not null,
  body            text,
  payload         jsonb not null default '{}'::jsonb,
  -- bad_number | unknown_sender | deactivated | no_group | not_a_member | archived | empty_body
  reason          text not null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists inbound_unmatched_ref_idx
  on public.inbound_messages_unmatched (channel, external_ref) where external_ref is not null;
create index if not exists inbound_unmatched_open_idx
  on public.inbound_messages_unmatched (created_at desc) where resolved_at is null;

alter table public.inbound_messages_unmatched enable row level security;
-- Read-only for admins; the webhooks write with the service role. No org_id column: for an
-- unknown sender there is no org to attribute it to, which is the whole point of the row.
create policy "inbound unmatched: admins read"
  on public.inbound_messages_unmatched for select to authenticated
  using ((select public.is_admin()));
