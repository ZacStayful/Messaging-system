-- 0025_whatsapp_thread_routing.sql
-- One number, more than one conversation.
--
-- whatsapp_threads (0019) has user_id as its primary key, which was exactly right at the time:
-- 0018 guarantees one customer group per external member, so "which conversation did we last
-- WhatsApp this person from" had precisely one answer and the key said so.
--
-- A cleaner breaks that. A cleaner covers six properties, is an external member of six property
-- groups, and the only thing telling us which one a reply belongs to is which one we last
-- messaged them from. That needs six rows, not one.
--
-- The customer rule is untouched: 0018 still allows an external member exactly one 'owner'
-- group, so a customer still has exactly one row here and their routing is unchanged. What
-- changes is that a person can now also have rows for the 'internal' property groups they serve.

alter table public.whatsapp_threads drop constraint if exists whatsapp_threads_pkey;
alter table public.whatsapp_threads add primary key (user_id, conversation_id);

-- Which thread inside that conversation, so a reply lands under the Cleaning anchor rather than
-- as a loose message at the bottom of the group. Null means top level, which is what every
-- existing customer row is and stays.
alter table public.whatsapp_threads
  add column if not exists parent_message_id uuid references public.messages (id) on delete set null;

-- The lookup the inbound webhook now does: this person's conversations, most recently messaged
-- first. Nulls last so a row we have never sent from never beats one we have.
create index if not exists whatsapp_threads_recent_idx
  on public.whatsapp_threads (user_id, last_outbound_at desc nulls last);

comment on table public.whatsapp_threads is
  'Which conversation (and thread) we last WhatsApped someone from. One row per '
  '(person, conversation): a customer has one, a cleaner has one per property they serve.';

-- inbound_messages_unmatched.reason is free text by design, so this is documentation rather
-- than a constraint. The values the WhatsApp webhook can now write:
--   bad_number | unknown_sender | deactivated | no_group | not_a_member | archived | empty_body
--   ambiguous_cleaner     - registered on several properties and we have never messaged them,
--                           so there is no honest way to pick one
--   no_maintenance_channel - the central maintenance channel could not be resolved or created
comment on column public.inbound_messages_unmatched.reason is
  'Why the message could not be routed. See 0020 and 0025 for the full list.';
