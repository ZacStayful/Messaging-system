-- 0031_reply_expiry_and_scheduled_claim.sql
-- Two things that were left open after 0029 and 0030, both about a credential or a row being
-- usable for longer than it should be.

-- ---------------------------------------------------------------------------
-- 1. Reply-by-email tokens stop being valid for ever
-- ---------------------------------------------------------------------------
-- The token in a notification's Reply-To is the real credential on that path. The sender check
-- beside it compares an unauthenticated From header — the inbound webhook carries no SPF, DKIM
-- or DMARC result — so anyone who sees one of those emails and can set a From line could post
-- as its owner. And the token never expired: one forwarded email leaked one permanently.
--
-- Thirty days from last use, not from creation. A token rides every notification for its
-- conversation, and both sending and receiving push the date out, so an active conversation
-- never expires and an abandoned one stops being a way in a month later.
alter table public.email_reply_threads
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days');

-- Existing tokens have been valid since the day they were made. Giving them the full window
-- from now is the kind thing to do — nobody's in-flight reply breaks — and they age out after.
update public.email_reply_threads
   set expires_at = now() + interval '30 days'
 where expires_at is null or expires_at < now() + interval '30 days';

create index if not exists email_reply_threads_expiry_idx on public.email_reply_threads (expires_at);

comment on column public.email_reply_threads.expires_at is
  'A reply token is a bearer credential printed in every notification. Refreshed on each send and each successful inbound reply; a token nobody has used for 30 days stops working.';

-- ---------------------------------------------------------------------------
-- 2. A scheduled message is claimed before it is posted
-- ---------------------------------------------------------------------------
-- postScheduledMessages had no claim at all. It selected rows that were due, inserted each one,
-- and only then wrote sent_message_id — so the window between the select and the insert was
-- wide open:
--
--   * two overlapping cron runs both selected the same row and both posted it. Unlike a message
--     sent from the app these carry no client_id, so messages_client_id_idx did not cover them
--     and nothing stopped the duplicate;
--   * pressing Cancel inside that window set cancelled_at on a row already on its way out. The
--     chip disappeared from the composer and the message went anyway, which is worse than the
--     button not existing.
--
-- claimed_at closes both. The claim is one conditional UPDATE ... RETURNING that also asserts
-- the row is neither cancelled nor sent, so a second runner takes nothing, and a cancel that
-- arrives first wins outright.
alter table public.scheduled_messages
  add column if not exists claimed_at timestamptz;

create index if not exists scheduled_messages_claimable_idx
  on public.scheduled_messages (send_at)
  where sent_message_id is null and cancelled_at is null and claimed_at is null;

comment on column public.scheduled_messages.claimed_at is
  'When the cron took this row to post it. Once set, the row is on its way out and the owner can no longer edit or cancel it.';

-- A claimed row is out of the sender's hands: the drain is mid-flight with it, and letting the
-- body, the destination or cancelled_at change underneath would reintroduce exactly the race
-- the claim removes. The cron writes sent_message_id with the service role, which is not
-- subject to this.
--
-- The client is expected to notice the refusal and say so, rather than hiding the chip and
-- leaving the person believing they cancelled something they did not — see cancelScheduled.
alter policy "scheduled: edit own" on public.scheduled_messages
  using (sender_id = (select auth.uid()) and claimed_at is null)
  with check (
    sender_id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
    and (visibility = 'public' or (select public.is_team()))
  );

alter policy "scheduled: delete own" on public.scheduled_messages
  using (sender_id = (select auth.uid()) and claimed_at is null);
