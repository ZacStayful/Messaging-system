-- 0045_archived_conversations.sql
-- Where a conversation's content goes when the conversation itself is removed.
--
-- Everything hanging off a conversation cascades when it is deleted: messages, attachments, pins,
-- members, property_threads. That is right for a group made by mistake, and wrong for a group that
-- has simply gone quiet — the point of importing three years of Slack was not to start deleting it
-- a day later. These two tables are the difference between "remove the group" and "lose the record".
--
-- Deliberately not foreign-keyed to conversations, profiles or messages. An archive that cascades
-- is not an archive. Everything a reader needs is denormalised in, including the sender's name, so
-- the rows still make sense after the group, and even the person, has gone.
--
-- The files themselves are untouched. Deleting an attachments row does not delete the object in the
-- storage bucket, so storage_path below is a live pointer to the file, not a description of one.

create table if not exists public.archived_conversations (
  id                uuid primary key,
  org_id            uuid not null references public.organisations (id) on delete cascade,
  slug              text,
  title             text,
  type              text,
  topic             text,
  description       text,
  slack_channel_id  text,
  slack_channel_name text,
  target_kind       text,
  property_id       uuid,
  property_address  text,
  created_at        timestamptz,
  last_message_at   timestamptz,
  message_count     int not null default 0,
  members           jsonb not null default '[]'::jsonb,
  reason            text,
  archived_at       timestamptz not null default now(),
  archived_by       uuid
);
comment on table public.archived_conversations is
  'A conversation that was removed, kept for the record. No foreign key to conversations: the row outlives it.';
create index if not exists archived_conversations_org_idx on public.archived_conversations (org_id, archived_at desc);
create index if not exists archived_conversations_slack_idx on public.archived_conversations (slack_channel_id);

create table if not exists public.archived_messages (
  id                uuid primary key,
  org_id            uuid not null references public.organisations (id) on delete cascade,
  conversation_id   uuid not null,
  slack_channel_id  text,
  slack_ts          text,
  thread_ts         text,
  parent_id         uuid,
  sender_id         uuid,
  -- Denormalised on purpose. A name is what makes the archive readable, and the profile it came
  -- from may be deactivated or gone by the time anyone reads this.
  sender_name       text,
  body              text,
  kind              text,
  visibility        text,
  sent_via          text,
  external_ref      text,
  meta              jsonb,
  attachments       jsonb not null default '[]'::jsonb,
  reactions         jsonb not null default '[]'::jsonb,
  created_at        timestamptz,
  edited_at         timestamptz,
  deleted_at        timestamptz,
  archived_at       timestamptz not null default now()
);
comment on table public.archived_messages is
  'Messages from a removed conversation. attachments keeps each file''s storage_path, which still resolves: deleting an attachments row never deleted the object in the bucket.';
comment on column public.archived_messages.conversation_id is
  'The conversation this came from. Plain uuid, not a reference: that conversation no longer exists.';
create index if not exists archived_messages_conversation_idx
  on public.archived_messages (conversation_id, created_at);
create index if not exists archived_messages_org_idx on public.archived_messages (org_id, created_at desc);

-- Team members read their own organisation's archive; nobody writes from a browser. Same shape as
-- monday_events after 0030.
alter table public.archived_conversations enable row level security;
alter table public.archived_messages enable row level security;

drop policy if exists "archived conversations: team reads" on public.archived_conversations;
create policy "archived conversations: team reads"
  on public.archived_conversations for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));

drop policy if exists "archived messages: team reads" on public.archived_messages;
create policy "archived messages: team reads"
  on public.archived_messages for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
