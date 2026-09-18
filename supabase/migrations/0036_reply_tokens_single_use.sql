-- 0036_reply_tokens_single_use.sql
-- A forwarded notification email should not be a login.
--
-- The reply token is a bearer credential: it sits in the Reply-To of every notification for a
-- (person, conversation) pair, and the inbound webhook carries no SPF, DKIM or DMARC result — so
-- the From line beside it proves nothing and is only a string compare against an unauthenticated
-- header. Confirmed against Resend's own documentation: the email.received payload is metadata
-- only, and headers come from a separate API call whose contents are undocumented. The token is
-- therefore the whole of the authentication, and until now it was a very durable one — a single
-- row per pair, reused in every notification for ever, with its expiry pushed out another 30
-- days on every send *and* every reply. A notification from months ago, forwarded to anyone,
-- still worked.
--
-- Three changes make it perishable:
--
--   1. One token per notification email, not per pair. Dropping unique (user_id, conversation_id)
--      is what allows that. The newest email always carries a live token, so nothing about the
--      experience changes for the person replying to the mail that just arrived.
--   2. Expiry runs from issue and is never refreshed. This is the half that does the work: the
--      forwarded email in an attacker's hands is carrying a token that died a week after it was
--      sent, whatever anyone does with it afterwards.
--   3. Single use. used_at is stamped on the first reply and a second reply on the same token is
--      refused. Note the cost, which is real: someone who replies twice to the *same*
--      notification has the second reply rejected and recorded as unmatched rather than posted.
--      Dropping this is a one-line change if that trade turns out to be wrong; the expiry above
--      carries most of the benefit on its own.
alter table public.email_reply_threads drop constraint if exists email_reply_threads_user_id_conversation_id_key;
alter table public.email_reply_threads add column if not exists used_at timestamptz;

-- The notification drain inserts one of these per email now, so the lookup that finds the most
-- recent live token for a pair has to be cheap.
create index if not exists email_reply_threads_pair_idx
  on public.email_reply_threads (user_id, conversation_id, created_at desc);

-- Seven days from issue. The previous default was 30 days from last use, which in practice meant
-- "for ever" for any conversation still in use.
alter table public.email_reply_threads alter column expires_at set default (now() + interval '7 days');

-- Existing rows were minted under the old rule and have had their expiry pushed forward by every
-- send since. Bring them back to the new window rather than leaving long-lived credentials in
-- circulation: a reply to a recent notification still works, an old one stops.
update public.email_reply_threads
   set expires_at = least(expires_at, now() + interval '7 days')
 where expires_at > now() + interval '7 days';
