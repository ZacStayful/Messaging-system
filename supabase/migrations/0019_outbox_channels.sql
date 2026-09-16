-- 0019_outbox_channels.sql
-- One outbox, more than one channel.
--
-- notification_outbox has been email-shaped since 0006: recipient_email is not null and the
-- drain speaks only to Resend. This widens it so a message can go out on whichever channels the
-- recipient asked for, while keeping the claim/retry machinery that already works.
--
-- One table with a channel column rather than a table per channel: status, attempts, last_error,
-- provider_message_id, sent_at, the pending index, the admin read policy and mark_outbox are all
-- identical per channel, and splitting them gives two places to look when a notification goes
-- missing. The independence the per-channel switches need is a *row* concern — email and
-- WhatsApp for one message are two rows that succeed, fail and retry separately. Adding SMS
-- later is one CHECK value and one branch in the drain.

alter table public.notification_outbox
  add column if not exists channel text not null default 'email'
    check (channel in ('email', 'whatsapp')),
  add column if not exists recipient_phone text,
  -- Set on a row created because another channel gave up. Constrained to 'whatsapp', so a
  -- failing email row can never spawn another: fallback is one hop by construction.
  add column if not exists fallback_from text check (fallback_from in ('whatsapp'));

alter table public.notification_outbox alter column recipient_email drop not null;

alter table public.notification_outbox drop constraint if exists notification_outbox_target_ck;
alter table public.notification_outbox add constraint notification_outbox_target_ck check (
  (channel = 'email'    and recipient_email is not null) or
  (channel = 'whatsapp' and recipient_phone is not null)
);

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (channel, status, created_at) where status in ('pending', 'failed');

-- A retried trigger can never double-send the same message on the same channel. This is also
-- what makes the email fallback safe: the fallback insert is `on conflict do nothing`, so it
-- only creates a row when the recipient did not already have an email row for that message.
create unique index if not exists notification_outbox_message_dedupe_idx
  on public.notification_outbox (channel, recipient_user_id, ((payload->>'message_id')))
  where kind = 'message';

-- ---------------------------------------------------------------------------
-- enqueue_message_notifications: external side only, one row per enabled channel
-- ---------------------------------------------------------------------------
-- Body taken from the live 0014_manual_away.sql definition, not 0010's: `create or replace`
-- swaps the whole function, and silently dropping the manual-away clause would notify people
-- who had explicitly gone quiet. Every predicate below is deliberate.
--
-- Two changes:
--   1. cm.member_side = 'external' replaces p.account_type = 'customer' (0018). This one
--      predicate is the whole "the external participant, never the internal team" rule.
--   2. The email preference moves OUT of the WHERE clause and into the loop body. Left where it
--      was, a customer who chose WhatsApp-only would be filtered out before either row was
--      written and would receive nothing at all.
create or replace function public.enqueue_message_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
declare conv public.conversations%rowtype; sender_name text; member record; v_payload jsonb;
begin
  if new.visibility <> 'public' or new.kind not in ('text', 'document') or new.deleted_at is not null then return null; end if;
  select * into conv from public.conversations where id = new.conversation_id;
  select display_name into sender_name from public.profiles where id = new.sender_id;
  for member in
    select p.id, p.email, p.phone, p.display_name, p.email_notifications, p.whatsapp_notifications
      from public.conversation_members cm
      join public.profiles p on p.id = cm.user_id
     where cm.conversation_id = new.conversation_id
       and cm.user_id is distinct from new.sender_id
       and cm.member_side = 'external'
       and cm.muted = false
       and cm.notify_level <> 'none'
       and (cm.notify_level = 'all' or new.meta->'mentions' ? p.id::text or new.parent_id is not null)
       and (new.parent_id is null or exists (select 1 from public.thread_follows f where f.message_id = new.parent_id and f.user_id = p.id))
       and p.deactivated_at is null
       and (p.dnd_until is null or p.dnd_until < now())
       -- Manual away silences every notification until it is cleared or expires.
       and not (coalesce(p.presence_mode, 'auto') = 'away'
                and (p.away_until is null or p.away_until > now()))
  loop
    v_payload := jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id, 'conversation_type', conv.type,
      'conversation_name', conv.name, 'sender_id', new.sender_id,
      'sender_name', coalesce(sender_name, 'Stayful'), 'recipient_name', member.display_name,
      'body', left(new.body, 2000), 'created_at', new.created_at,
      'parent_id', new.parent_id, 'sent_via', new.sent_via);

    if member.email is not null and member.email_notifications = 'instant' then
      insert into public.notification_outbox (org_id, kind, channel, recipient_user_id, recipient_email, payload)
      values (new.org_id, 'message', 'email', member.id, member.email, v_payload)
      on conflict do nothing;
    end if;

    if member.phone is not null and member.whatsapp_notifications = 'instant' then
      insert into public.notification_outbox (org_id, kind, channel, recipient_user_id, recipient_phone, payload)
      values (new.org_id, 'message', 'whatsapp', member.id, member.phone, v_payload)
      on conflict do nothing;
    end if;
  end loop;
  return null;
end $$;

-- The messages_notify trigger itself (0006) is unchanged.

-- ---------------------------------------------------------------------------
-- whatsapp_threads: which group we last WhatsApped someone from
-- ---------------------------------------------------------------------------
-- Written by the drain on every successful send. An inbound WhatsApp has no reply token like
-- email does, so this gives it an authoritative conversation to land in rather than re-deriving
-- one. user_id is the primary key because 0018 enforces one customer group per external member.
create table if not exists public.whatsapp_threads (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  org_id           uuid not null references public.organisations (id) on delete cascade,
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  phone            text not null,
  last_outbound_at timestamptz,
  last_inbound_at  timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists whatsapp_threads_conversation_idx on public.whatsapp_threads (conversation_id);
create index if not exists whatsapp_threads_org_idx on public.whatsapp_threads (org_id);
alter table public.whatsapp_threads enable row level security;
-- No policies, like email_reply_threads (0007): the drain and the inbound webhook reach this
-- with the service role, and nothing a browser does should read another person's number.
