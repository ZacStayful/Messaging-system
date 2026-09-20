-- 0043_slack_sync_fixes.sql
-- Four corrections to 0042, found by reading it again before the first import ran. Nothing had
-- been imported yet, so none of this is a repair — it is the difference between an import that
-- behaves and one that quietly misbehaves for as long as Slack is still in use.
--
--   1. slack_finish_backfill marked everything read on *every* call, and the daily catch-up calls
--      it. `greatest(coalesce(last_read_at, now()), now())` is always now(), which is right once,
--      at the end of a backfill nobody was watching, and wrong every day after: a channel synced
--      at 09:30 cleared the badge for a message sent at 09:00 that nobody had opened — including
--      the Slack messages the catch-up had just imported.
--   2. It also never raised app.bulk_import, so each of its thread_follows updates fired
--      broadcast_thread_read_state (0041). A three-year channel is thousands of realtime sends
--      at the end of its backfill, which is the exact flood 0042 added the flag to prevent.
--   3. The conversation a channel becomes was findable only through slack_conversations, and that
--      row is written one statement *after* the conversation is inserted. A slice killed between
--      the two left an orphan, and the next run built a second group — "general-2", or a second
--      property group with its own pair of anchors.
--   4. A re-read whose body differs only because someone's display name changed since — mentions
--      render through the directory — stamped "(edited)" on a message nobody had edited.

-- ---------------------------------------------------------------------------
-- 3. Which Slack channel a conversation came from, on the conversation itself
-- ---------------------------------------------------------------------------
-- The same shape as properties.slack_channel_id (0042), and for the same reason: an import step
-- must be able to find what it already made without depending on a row written after it.
alter table public.conversations add column if not exists slack_channel_id text;
create unique index if not exists conversations_slack_channel_idx
  on public.conversations (org_id, slack_channel_id) where slack_channel_id is not null;
comment on column public.conversations.slack_channel_id is
  'The Slack channel this conversation was imported from. Written in the same insert, so a run killed before slack_conversations.conversation_id is set finds it rather than making a second group.';

-- Backfill the link for anything 0042 already created (nothing, at the time of writing, but a
-- migration that assumes its own table is empty is a migration that breaks on a re-run).
update public.conversations c
   set slack_channel_id = sc.slack_channel_id
  from public.slack_conversations sc
 where sc.conversation_id = c.id and c.slack_channel_id is null;

-- ---------------------------------------------------------------------------
-- 1 and 2. slack_finish_backfill: mark read once, and say nothing while doing it
-- ---------------------------------------------------------------------------
-- The read-state sweep is what stops a three-year backfill arriving as fifty thousand unread
-- messages. It belongs to the backfill alone: after that, unread means unread, and the daily
-- catch-up has no business deciding anyone has read anything.
--
-- Dropped rather than replaced because the argument list changes; a default would otherwise leave
-- two overloads and make every one-argument call ambiguous.
drop function if exists public.slack_finish_backfill(uuid);

create or replace function public.slack_finish_backfill(p_conversation_id uuid, p_mark_read boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  -- Set for the read-state updates below: each one would otherwise broadcast to its owner's
  -- private topic, and there are as many of them as the channel has members and threads.
  perform set_config('app.bulk_import', 'on', true);

  if p_mark_read then
    update public.conversation_members
       set last_read_at = now()
     where conversation_id = p_conversation_id;
    update public.thread_follows f
       set last_read_at = now()
      from public.messages m
     where f.message_id = m.id and m.conversation_id = p_conversation_id;
  end if;

  update public.slack_conversations
     set status = 'complete', completed_at = coalesce(completed_at, now()), claimed_at = null,
         last_synced_at = now(), next_sync_at = now() + interval '1 day', attempts = 0, last_error = null,
         updated_at = now()
   where conversation_id = p_conversation_id;

  perform set_config('app.bulk_import', '', true);
end $$;
revoke all on function public.slack_finish_backfill(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. A re-render is not an edit, and a parent belongs to one organisation
-- ---------------------------------------------------------------------------
-- Body from 0042 with two changes, marked below. Everything else is verbatim.
create or replace function public.import_slack_messages(p_conversation_id uuid, p_rows jsonb, p_bulk boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c          public.conversations%rowtype;
  r          jsonb;
  rx         jsonb;
  v_ts       text;
  v_thread   text;
  v_channel  text;
  v_parent   uuid;
  v_existing uuid;
  v_id       uuid;
  v_body     text;
  v_kind     public.message_kind;
  v_meta     jsonb;
  v_edited   timestamptz;
  v_old_body text;
  v_old_edit timestamptz;
  v_old_del  timestamptz;
  v_out      jsonb := '[]'::jsonb;
  v_outcome  text;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then raise exception 'unknown conversation'; end if;
  if p_bulk then perform set_config('app.bulk_import', 'on', true); end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_ts := r->>'ts';
    v_channel := r->>'channel_id';
    v_thread := nullif(r->>'thread_ts', '');
    v_body := coalesce(r->>'body', '');
    v_kind := coalesce(nullif(r->>'kind', ''), 'text')::public.message_kind;
    v_meta := coalesce(r->'meta', '{}'::jsonb) || jsonb_build_object('mirrored', true);
    v_edited := case when nullif(r->>'edited_ts', '') is null then null else to_timestamp((r->>'edited_ts')::numeric) end;

    select message_id into v_existing from public.slack_messages
     where channel_id = v_channel and ts = v_ts and org_id = c.org_id;  -- CHANGED: org-scoped

    if v_existing is not null then
      select body, edited_at, deleted_at into v_old_body, v_old_edit, v_old_del from public.messages where id = v_existing;
      if v_old_body is distinct from v_body or v_old_del is not null then
        update public.messages set body = v_body, deleted_at = null where id = v_existing;
        -- CHANGED: no now() fallback. messages_before_update stamps edited_at on a body change,
        -- and a body can change here for a reason that is not an edit: mentions render through
        -- the directory, so one display name changing rewrites every message that mentions them.
        -- Slack's own edit time is the only thing that means "edited"; without it, put back what
        -- was there, which for a message nobody edited is null.
        update public.messages set edited_at = coalesce(v_edited, v_old_edit) where id = v_existing;
        v_outcome := 'updated';
      else
        v_outcome := 'unchanged';
      end if;
      v_id := v_existing;
    else
      v_parent := null;
      if v_thread is not null and v_thread <> v_ts then
        select message_id into v_parent from public.slack_messages
         where channel_id = v_channel and ts = v_thread and org_id = c.org_id;  -- CHANGED: org-scoped
        if v_parent is null then
          v_out := v_out || jsonb_build_object('ts', v_ts, 'message_id', null, 'outcome', 'orphan');
          continue;
        end if;
      end if;
      insert into public.messages (org_id, conversation_id, sender_id, body, kind, visibility, parent_id, meta,
                                   sent_via, external_ref, created_at, edited_at)
      values (c.org_id, c.id, nullif(r->>'sender_id', '')::uuid, v_body, v_kind, 'public', v_parent, v_meta,
              'slack', v_channel || ':' || v_ts, to_timestamp(v_ts::numeric), v_edited)
      returning id into v_id;
      insert into public.slack_messages (org_id, channel_id, ts, message_id, thread_ts)
      values (c.org_id, v_channel, v_ts, v_id, v_thread);
      v_outcome := 'inserted';
    end if;

    for rx in select * from jsonb_array_elements(coalesce(r->'reactions', '[]'::jsonb)) loop
      if nullif(rx->>'user_id', '') is not null then
        insert into public.reactions (message_id, user_id, org_id, emoji, created_at)
        values (v_id, (rx->>'user_id')::uuid, c.org_id, rx->>'emoji', to_timestamp(v_ts::numeric))
        on conflict (message_id, user_id, emoji) do nothing;
      end if;
    end loop;

    if coalesce((r->>'pinned')::boolean, false) then
      insert into public.pins (conversation_id, message_id, org_id, pinned_by, pinned_at)
      values (c.id, v_id, c.org_id, nullif(r->>'pinned_by', '')::uuid,
              case when nullif(r->>'pinned_ts', '') is null then now() else to_timestamp((r->>'pinned_ts')::numeric) end)
      on conflict (conversation_id, message_id) do nothing;
    end if;

    v_out := v_out || jsonb_build_object('ts', v_ts, 'message_id', v_id, 'outcome', v_outcome);
  end loop;

  if p_bulk then perform set_config('app.bulk_import', '', true); end if;
  return v_out;
end $$;
revoke all on function public.import_slack_messages(uuid, jsonb, boolean) from public, anon, authenticated;

-- mark_slack_deleted, org-scoped for the same reason.
create or replace function public.mark_slack_deleted(p_channel_id text, p_ts_list text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  perform set_config('app.bulk_import', 'on', true);
  update public.messages m
     set deleted_at = now()
    from public.slack_messages sm
   where sm.message_id = m.id and sm.channel_id = p_channel_id and sm.ts = any (p_ts_list)
     and sm.org_id = m.org_id
     and m.deleted_at is null;
  get diagnostics n = row_count;
  perform set_config('app.bulk_import', '', true);
  return n;
end $$;
revoke all on function public.mark_slack_deleted(text, text[]) from public, anon, authenticated;
