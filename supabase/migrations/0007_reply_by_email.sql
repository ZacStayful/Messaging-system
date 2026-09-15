-- 0007_reply_by_email.sql
-- Reply-by-email (spec 4.1): each customer + conversation pair gets a short opaque
-- token used in the Reply-To address of notification emails. Inbound replies are
-- matched back to the conversation and stored as messages with sent_via = 'email'.

create table public.email_reply_threads (
  token            text primary key,
  org_id           uuid not null references public.organisations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  unique (user_id, conversation_id)
);
create index email_reply_threads_org_idx on public.email_reply_threads (org_id);
create index email_reply_threads_conversation_idx on public.email_reply_threads (conversation_id);

-- Service role only: no policies for authenticated users.
alter table public.email_reply_threads enable row level security;

-- One message per inbound email, however many times the webhook retries.
create unique index if not exists messages_external_ref_email_idx
  on public.messages (external_ref) where sent_via = 'email' and external_ref is not null;
