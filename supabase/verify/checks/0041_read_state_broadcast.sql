-- Do the read-state triggers actually broadcast, and — just as important — stay quiet?
--
-- 0041 exists so that reading something on one device clears the badge on the others. The whole
-- feature is four triggers and their guards, and a guard that is wrong fails silently in the
-- expensive direction: either nothing is sent (the bug is simply still there) or something is sent
-- on every unrelated write to two of the hottest tables in the schema. Neither shows up in a
-- parse, and neither is reachable from the TypeScript suite, which has no Postgres.
--
-- This is observable at all only because supabase_stub.sql's realtime.send records into
-- realtime.messages instead of discarding. Deliberately fixed there rather than shadowed here:
-- `create or replace function` is DDL and autocommits, and verify-migrations.sh runs every check
-- against one database, so a shadow would outlive this file and quietly change what a later check
-- sees — and restoring it at the bottom would not help, because a failed assertion aborts before
-- the restore.
--
-- Note the cluster is shared and cumulative: checks/0040 runs first (alphabetical) and leaves its
-- organisation behind, so 'check-org' and check@example.test are taken. Hence the names below.
do $check$
declare
  v_org   uuid;
  v_reader uuid;
  v_other  uuid;
  v_conv   uuid;
  v_msg    uuid;
  v_reply  uuid;
  v_unfollowed uuid;
  v_n      int;
  v_row    realtime.messages%rowtype;
begin
  insert into public.organisations (name, slug) values ('Read state org', 'read-state-org')
  returning id into v_org;

  -- A trigger on auth.users creates the profile (0001), so these update it into the org.
  v_reader := gen_random_uuid();
  insert into auth.users (id, email) values (v_reader, 'reader@example.test');
  update public.profiles set org_id = v_org, display_name = 'Reader', account_type = 'team'
   where id = v_reader;

  v_other := gen_random_uuid();
  insert into auth.users (id, email) values (v_other, 'other@example.test');
  update public.profiles set org_id = v_org, display_name = 'Other', account_type = 'team'
   where id = v_other;

  insert into public.conversations (org_id, type, name, slug)
  values (v_org, 'internal', 'read-state', 'read-state') returning id into v_conv;
  insert into public.conversation_members (conversation_id, user_id, org_id)
  values (v_conv, v_reader, v_org), (v_conv, v_other, v_org);

  -- auth.uid() reads this GUC in the stub. false = session scope, so it outlives statements.
  perform set_config('request.jwt.claim.sub', v_reader::text, false);

  -- -------------------------------------------------------------------------
  -- 1. The RPC writer.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  perform public.mark_read(v_conv);

  select count(*) into v_n from realtime.messages where event = 'read_state';
  if v_n <> 1 then raise exception 'mark_read produced % read_state events, expected 1', v_n; end if;

  select * into v_row from realtime.messages where event = 'read_state';
  if v_row.topic <> 'user:' || v_reader::text then
    raise exception 'read_state went to %, not the reader''s own topic', v_row.topic;
  end if;
  if (v_row.payload->>'conversation_id')::uuid <> v_conv then
    raise exception 'read_state named conversation %, expected %', v_row.payload->>'conversation_id', v_conv;
  end if;
  if v_row.payload->>'last_read_at' is null then
    raise exception 'read_state carried no last_read_at';
  end if;
  if not v_row.private then raise exception 'read_state was sent to a public topic'; end if;

  -- -------------------------------------------------------------------------
  -- 2. The trigger writer: messages_after_insert (0010) moves the sender's own mark. A broadcast
  --    bolted to mark_read() rather than to the table would have missed this entirely.
  -- -------------------------------------------------------------------------
  -- now() is frozen inside a transaction, so the mark mark_read() just set and the created_at the
  -- insert below is about to default to are the same instant, and greatest() would not move it.
  -- Rewinding first is what makes this faithful rather than merely green: in life the read and the
  -- send are separate transactions minutes apart.
  update public.conversation_members set last_read_at = now() - interval '1 minute'
   where conversation_id = v_conv and user_id = v_reader;

  delete from realtime.messages;
  insert into public.messages (org_id, conversation_id, sender_id, body)
  values (v_org, v_conv, v_reader, 'my own message') returning id into v_msg;

  select count(*) into v_n from realtime.messages
   where event = 'read_state' and topic = 'user:' || v_reader::text;
  if v_n <> 1 then
    raise exception 'sending my own message produced % read_state events, expected 1', v_n;
  end if;
  -- And it must say there is nothing unread: the mark was moved to this message's own timestamp.
  select * into v_row from realtime.messages where event = 'read_state';
  if (v_row.payload->>'has_unread')::boolean then
    raise exception 'my own message left has_unread true';
  end if;

  -- -------------------------------------------------------------------------
  -- 3. The PostgREST writer. The UPDATE policy has no column list and tests/rls.test.ts asserts a
  --    customer can PATCH last_read_at directly, so this path exists whether or not anything in
  --    the app uses it today. It is the reason 0041 hangs off the table and not off the RPC.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  update public.conversation_members set last_read_at = now() + interval '1 second'
   where conversation_id = v_conv and user_id = v_reader;

  select count(*) into v_n from realtime.messages where event = 'read_state';
  if v_n <> 1 then raise exception 'a direct PATCH produced % read_state events, expected 1', v_n; end if;

  -- -------------------------------------------------------------------------
  -- 4. has_unread, the other way round. Someone else posts, and the mark sits before it.
  -- -------------------------------------------------------------------------
  insert into public.messages (org_id, conversation_id, sender_id, body)
  values (v_org, v_conv, v_other, 'while you were out');

  delete from realtime.messages;
  update public.conversation_members set last_read_at = now() - interval '1 day'
   where conversation_id = v_conv and user_id = v_reader;

  select * into v_row from realtime.messages where event = 'read_state';
  if v_row is null then raise exception 'rewinding the mark broadcast nothing'; end if;
  if not (v_row.payload->>'has_unread')::boolean then
    raise exception 'a message newer than the mark left has_unread false';
  end if;

  -- -------------------------------------------------------------------------
  -- 5. The negatives. updateMember() PATCHes these three and nothing else; with
  --    `after update OF last_read_at` they never reach the function at all.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  update public.conversation_members set muted = true where conversation_id = v_conv and user_id = v_reader;
  update public.conversation_members set starred = true where conversation_id = v_conv and user_id = v_reader;
  update public.conversation_members set notify_level = 'mentions' where conversation_id = v_conv and user_id = v_reader;

  select count(*) into v_n from realtime.messages;
  if v_n <> 0 then
    raise exception 'muting/starring/renotifying broadcast % read events; every conversation setting change would wake every device', v_n;
  end if;

  -- -------------------------------------------------------------------------
  -- 6. The no-op. messages_after_insert uses greatest(), so re-sending into a conversation you are
  --    already caught up on rewrites the row with the value it already held.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  update public.conversation_members set last_read_at = last_read_at
   where conversation_id = v_conv and user_id = v_reader;

  select count(*) into v_n from realtime.messages;
  if v_n <> 0 then raise exception 'rewriting last_read_at to its own value broadcast % events', v_n; end if;

  -- -------------------------------------------------------------------------
  -- 7. Threads: the insert arm, the update arm, and the follow that is not a read.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  perform public.mark_thread_read(v_msg);   -- not followed yet: this INSERTs the row

  select count(*) into v_n from realtime.messages where event = 'thread_read_state';
  if v_n <> 1 then
    raise exception 'first read of a thread produced % thread_read_state events, expected 1 (the INSERT arm)', v_n;
  end if;
  select * into v_row from realtime.messages where event = 'thread_read_state';
  if (v_row.payload->>'message_id')::uuid <> v_msg then
    raise exception 'thread_read_state named message %, expected %', v_row.payload->>'message_id', v_msg;
  end if;

  -- Reading it again at the same instant is a genuine no-op: mark_thread_read writes now(), which
  -- is frozen for the length of a transaction, so the row does not change and nothing is sent.
  delete from realtime.messages;
  perform public.mark_thread_read(v_msg);

  select count(*) into v_n from realtime.messages where event = 'thread_read_state';
  if v_n <> 0 then
    raise exception 're-reading a thread at the same instant broadcast % events', v_n;
  end if;

  -- Rewound, the same call is a real update, and that is the UPDATE arm.
  update public.thread_follows set last_read_at = now() - interval '1 minute'
   where message_id = v_msg and user_id = v_reader;
  delete from realtime.messages;
  perform public.mark_thread_read(v_msg);

  select count(*) into v_n from realtime.messages where event = 'thread_read_state';
  if v_n <> 1 then
    raise exception 'a later read of a thread produced % thread_read_state events, expected 1 (the UPDATE arm)', v_n;
  end if;

  -- messages_thread_bookkeeping (0010) follows the parent's author on every reply, with a null
  -- mark when they are not the replier. That is the system deciding you care about a thread, not
  -- you reading it — and a null mark broadcast to the client would un-read the thread.
  --
  -- On a fresh parent, deliberately: that upsert is `on conflict do nothing`, so on the message
  -- above — which the reader has now followed twice — no row would be inserted and this would
  -- assert nothing at all. It is the mistake this file was written with, and it survived the first
  -- negative test by passing for the wrong reason.
  insert into public.messages (org_id, conversation_id, sender_id, body)
  values (v_org, v_conv, v_reader, 'a thread I have not read') returning id into v_unfollowed;

  delete from realtime.messages;
  insert into public.messages (org_id, conversation_id, sender_id, body, parent_id)
  values (v_org, v_conv, v_other, 'a reply from someone else', v_unfollowed) returning id into v_reply;

  select count(*) into v_n from realtime.messages
   where event = 'thread_read_state' and topic = 'user:' || v_reader::text;
  if v_n <> 0 then
    raise exception 'being auto-followed into a thread broadcast % read events to the parent author', v_n;
  end if;
  -- The replier's own follow does carry a mark, so that one is a read and is expected.
  select count(*) into v_n from realtime.messages
   where event = 'thread_read_state' and topic = 'user:' || v_other::text;
  if v_n <> 1 then
    raise exception 'the replier''s own follow produced % thread_read_state events, expected 1', v_n;
  end if;

  -- -------------------------------------------------------------------------
  -- 8. The activity feed, on the personal topic and nowhere else.
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  update public.profiles set activity_seen_at = now() where id = v_reader;

  select count(*) into v_n from realtime.messages where event = 'activity_seen';
  if v_n <> 1 then raise exception 'marking activity seen produced % events, expected 1', v_n; end if;
  select * into v_row from realtime.messages where event = 'activity_seen';
  if v_row.topic <> 'user:' || v_reader::text then
    raise exception 'activity_seen went to %; when someone last read their own feed is not org-wide', v_row.topic;
  end if;

  -- An ordinary profile edit broadcasts profile_changed on the org topic and no activity_seen.
  delete from realtime.messages;
  update public.profiles set display_name = 'Reader renamed' where id = v_reader;

  select count(*) into v_n from realtime.messages where event = 'activity_seen';
  if v_n <> 0 then raise exception 'renaming a profile produced % activity_seen events', v_n; end if;

  delete from realtime.messages;
  perform set_config('request.jwt.claim.sub', '', false);
  raise notice 'read state broadcast: all assertions passed';
end $check$;
