-- Do the Slack import functions keep the promises their comments make?
--
-- 0042 is three writers and a handful of bookkeeping functions, and every one of them has a
-- property that only shows up under a real Postgres: idempotency on Slack's ids, the one-customer-
-- group rule becoming an outcome rather than an abort, created_at taken from the ts, the bulk flag
-- silencing every broadcast (observable because the stub's realtime.send records), no notification
-- ever queued for an imported message, and the two fixes to functions that predate it —
-- next_available_slug against an archived slug, and the properties index PostgREST can target.
--
-- The cluster is shared and cumulative with checks/0040 and checks/0041, hence the distinct
-- organisation and addresses below, and the GUC reset at the end.
do $check$
declare
  v_org      uuid;
  v_admin    uuid;
  v_guest    uuid;
  v_guest2   uuid;
  v_bot      uuid;
  v_linked   uuid;
  v_conv     uuid;
  v_conv2    uuid;
  v_out      jsonb;
  v_n        int;
  v_msg      public.messages%rowtype;
  v_link     public.slack_conversations%rowtype;
  v_slug     text;
begin
  insert into public.organisations (name, slug, settings)
  values ('Slack sync org', 'slack-sync-org', '{"team_domains":["slack-sync.test"]}'::jsonb)
  returning id into v_org;

  -- An admin to act as. handle_new_user (0001/0029) creates the profile; it is moved into the org.
  v_admin := gen_random_uuid();
  insert into auth.users (id, email) values (v_admin, 'admin@slack-sync.test');
  update public.profiles set org_id = v_org, display_name = 'Zac', account_type = 'team', role = 'admin'
   where id = v_admin;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- -------------------------------------------------------------------------
  -- 1. import_slack_account: dormant, idempotent, links an existing address
  -- -------------------------------------------------------------------------
  v_guest := public.import_slack_account('U1', 'guest@slack-sync.test', 'Guest Person', 'Guest',
                                         'customer', 'owner', 'Europe/London', null, false, false);
  if v_guest is null then raise exception 'import_slack_account returned nothing'; end if;
  if public.import_slack_account('U1', 'guest@slack-sync.test', 'Guest Person', 'Guest',
                                 'customer', 'owner', 'Europe/London', null, false, false) <> v_guest then
    raise exception 'a second import of the same Slack id made a second account';
  end if;
  if (select banned_until from auth.users where id = v_guest) is null then
    raise exception 'an imported guest can sign in';
  end if;
  if (select portal_access or email_notifications <> 'off' or whatsapp_notifications <> 'off'
        from public.profiles where id = v_guest) then
    raise exception 'an imported guest is reachable';
  end if;
  if (select slack_user_id from public.profiles where id = v_guest) <> 'U1' then
    raise exception 'slack_user_id was not recorded';
  end if;

  v_bot := public.import_slack_account('B1', null, 'Granola', 'Granola', 'team', 'staff', null, null, false, true);
  if (select email from public.profiles where id = v_bot) not like 'slack-bot-%@bots.stayful.invalid' then
    raise exception 'a bot did not get a placeholder address';
  end if;
  if (select deactivated_at from public.profiles where id = v_bot) is null then
    raise exception 'a bot profile is not deactivated';
  end if;

  v_linked := public.import_slack_account('UZ', 'admin@slack-sync.test', 'Zachary Someone', 'Zachary',
                                          'team', 'admin', null, null, false, false);
  if v_linked <> v_admin then raise exception 'an existing address was not linked'; end if;
  if (select display_name from public.profiles where id = v_admin) <> 'Zac' then
    raise exception 'linking renamed an existing account';
  end if;
  if (select banned_until from auth.users where id = v_admin) is not null then
    raise exception 'linking banned an existing account';
  end if;

  v_guest2 := public.import_slack_account('U2', 'guest2@slack-sync.test', 'Second Guest', 'Second',
                                          'customer', 'owner', null, null, true, false);
  if (select deactivated_at from public.profiles where id = v_guest2) is null then
    raise exception 'a deleted Slack member was not deactivated';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Members: the one-customer-group rule is an outcome, not an abort
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', false);  -- the worker is the service role
  insert into public.conversations (org_id, type, name, slug, is_private, created_by, created_at)
  values (v_org, 'owner', 'guest-person', 'guest-person', true, v_admin, now() - interval '400 days')
  returning id into v_conv;
  v_out := public.import_slack_members(v_conv, jsonb_build_array(
    jsonb_build_object('user_id', v_guest, 'member_side', 'external'),
    jsonb_build_object('user_id', v_admin, 'member_side', 'internal')));
  if v_out->>(v_guest::text) <> 'added' or v_out->>(v_admin::text) <> 'added' then
    raise exception 'members were not added: %', v_out;
  end if;
  v_out := public.import_slack_members(v_conv, jsonb_build_array(
    jsonb_build_object('user_id', v_guest, 'member_side', 'external')));
  if v_out->>(v_guest::text) <> 'already' then raise exception 'a re-run did not say already: %', v_out; end if;

  insert into public.conversations (org_id, type, name, slug, is_private, created_by)
  values (v_org, 'owner', 'guest-cleaning', 'guest-cleaning', true, v_admin)
  returning id into v_conv2;
  v_out := public.import_slack_members(v_conv2, jsonb_build_array(
    jsonb_build_object('user_id', v_guest, 'member_side', 'external')));
  if v_out->>(v_guest::text) <> 'member_conflict' then
    raise exception 'a second customer group should be member_conflict, got %', v_out;
  end if;
  if exists (select 1 from public.conversation_members where conversation_id = v_conv2 and user_id = v_guest) then
    raise exception 'the conflicting membership was written anyway';
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Messages: created_at from ts, replies, orphans, edits on re-read, silence
  -- -------------------------------------------------------------------------
  delete from realtime.messages;
  v_out := public.import_slack_messages(v_conv, jsonb_build_array(
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000000.000100', 'sender_id', v_admin, 'body', 'hello',
                       'kind', 'text', 'meta', jsonb_build_object('slack', jsonb_build_object('user', 'UZ')),
                       'reactions', jsonb_build_array(jsonb_build_object('user_id', v_guest, 'emoji', '👍')),
                       'pinned', true, 'pinned_by', v_admin, 'pinned_ts', '1700000500.000000'),
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000010.000200', 'thread_ts', '1700000000.000100',
                       'sender_id', v_guest, 'body', 'a reply', 'kind', 'text', 'edited_ts', '1700000020.000000'),
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000030.000300', 'thread_ts', '1699999999.000000',
                       'sender_id', null, 'body', 'orphan', 'kind', 'text')
  ), true);
  if jsonb_array_length(v_out) <> 3 then raise exception 'expected three outcomes, got %', v_out; end if;
  if v_out->0->>'outcome' <> 'inserted' or v_out->1->>'outcome' <> 'inserted' or v_out->2->>'outcome' <> 'orphan' then
    raise exception 'unexpected outcomes: %', v_out;
  end if;
  select count(*) into v_n from realtime.messages;
  if v_n <> 0 then raise exception 'bulk import broadcast % realtime events', v_n; end if;
  select count(*) into v_n from public.notification_outbox o
   join public.messages m on m.id = (o.payload->>'message_id')::uuid where m.conversation_id = v_conv;
  if v_n <> 0 then raise exception 'an imported message queued % notifications', v_n; end if;

  select * into v_msg from public.messages where sent_via = 'slack' and external_ref = 'C1:1700000000.000100';
  if v_msg.id is null then raise exception 'the parent was not stored under its external_ref'; end if;
  if v_msg.created_at <> to_timestamp(1700000000.000100) then
    raise exception 'created_at was not taken from ts: %', v_msg.created_at;
  end if;
  if v_msg.reply_count <> 1 then raise exception 'reply_count is % rather than 1', v_msg.reply_count; end if;
  if coalesce(v_msg.meta->>'mirrored', '') <> 'true' then raise exception 'meta.mirrored is not set'; end if;
  if (select parent_id from public.messages where external_ref = 'C1:1700000010.000200') <> v_msg.id then
    raise exception 'the reply did not find its parent';
  end if;
  if (select edited_at from public.messages where external_ref = 'C1:1700000010.000200') <> to_timestamp(1700000020) then
    raise exception 'edited_at was not taken from edited_ts';
  end if;
  if not exists (select 1 from public.reactions where message_id = v_msg.id and user_id = v_guest and emoji = '👍') then
    raise exception 'the reaction was not written';
  end if;
  if not exists (select 1 from public.pins where message_id = v_msg.id and conversation_id = v_conv) then
    raise exception 'the pin was not written';
  end if;

  -- A re-read: the edit lands, the unchanged row is left alone, edited_at is Slack's not now().
  v_out := public.import_slack_messages(v_conv, jsonb_build_array(
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000000.000100', 'sender_id', v_admin, 'body', 'hello edited',
                       'kind', 'text', 'edited_ts', '1700000600.000000'),
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000010.000200', 'thread_ts', '1700000000.000100',
                       'sender_id', v_guest, 'body', 'a reply', 'kind', 'text')
  ), true);
  if v_out->0->>'outcome' <> 'updated' or v_out->1->>'outcome' <> 'unchanged' then
    raise exception 'a re-read gave %', v_out;
  end if;
  select * into v_msg from public.messages where id = v_msg.id;
  if v_msg.body <> 'hello edited' then raise exception 'the edit did not land'; end if;
  if v_msg.edited_at <> to_timestamp(1700000600) then raise exception 'edited_at is % rather than Slack''s', v_msg.edited_at; end if;
  if (select count(*) from public.messages where sent_via = 'slack' and conversation_id = v_conv) <> 2 then
    raise exception 'a re-read made new rows';
  end if;

  -- Live mode (p_bulk = false) does broadcast: open tabs must hear about a daily catch-up.
  delete from realtime.messages;
  perform public.import_slack_messages(v_conv, jsonb_build_array(
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000040.000400', 'sender_id', v_admin, 'body', 'live', 'kind', 'text')
  ), false);
  select count(*) into v_n from realtime.messages;
  if v_n = 0 then raise exception 'a non-bulk import broadcast nothing'; end if;

  -- Deletion detection.
  if public.mark_slack_deleted('C1', array['1700000010.000200']) <> 1 then
    raise exception 'mark_slack_deleted did not mark the reply';
  end if;
  if (select deleted_at from public.messages where external_ref = 'C1:1700000010.000200') is null then
    raise exception 'the reply is not deleted';
  end if;

  -- -------------------------------------------------------------------------
  -- 4. The worker's lease, claim and finish
  -- -------------------------------------------------------------------------
  if not public.slack_acquire_lease('check-worker', 'a', interval '2 minutes') then raise exception 'lease refused to a'; end if;
  if public.slack_acquire_lease('check-worker', 'b', interval '2 minutes') then raise exception 'lease given to b while a holds it'; end if;
  if not public.slack_acquire_lease('check-worker', 'a', interval '2 minutes') then raise exception 'a could not renew'; end if;

  insert into public.slack_conversations (org_id, slack_channel_id, kind, name, decision, status, conversation_id)
  values (v_org, 'C1', 'group', 'guest-person', 'create', 'history', v_conv);
  v_link := public.slack_claim_conversation(interval '10 minutes');
  if v_link.slack_channel_id is distinct from 'C1' then raise exception 'the row was not claimed'; end if;
  v_link := public.slack_claim_conversation(interval '10 minutes');
  if v_link.slack_channel_id is not null then raise exception 'a claimed row was claimed again'; end if;

  -- The backfill's finish marks the imported history read, and says nothing while doing it:
  -- every one of those read-state rows would otherwise broadcast to its owner (0041).
  delete from realtime.messages;
  perform public.slack_finish_backfill(v_conv);
  select * into v_link from public.slack_conversations where slack_channel_id = 'C1';
  if v_link.status <> 'complete' or v_link.next_sync_at <= now() or v_link.claimed_at is not null then
    raise exception 'finish did not complete the row: % % %', v_link.status, v_link.next_sync_at, v_link.claimed_at;
  end if;
  if exists (select 1 from public.conversation_members where conversation_id = v_conv and last_read_at is null) then
    raise exception 'a member was left with the whole history unread';
  end if;
  select count(*) into v_n from realtime.messages;
  if v_n <> 0 then raise exception 'the read-state sweep broadcast % events', v_n; end if;

  -- The daily catch-up calls the same function and must NOT touch read state: clearing it would
  -- hide both what the team posted here and what the catch-up just brought over.
  update public.conversation_members set last_read_at = now() - interval '1 day'
   where conversation_id = v_conv;
  perform public.slack_finish_backfill(v_conv, false);
  if exists (select 1 from public.conversation_members
              where conversation_id = v_conv and last_read_at > now() - interval '1 hour') then
    raise exception 'the catch-up marked the conversation read';
  end if;

  -- A re-read whose body differs only because a display name changed is not an edit.
  perform public.import_slack_messages(v_conv, jsonb_build_array(
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000050.000500', 'sender_id', v_admin,
                       'body', 'hello @Zac', 'kind', 'text')
  ), true);
  perform public.import_slack_messages(v_conv, jsonb_build_array(
    jsonb_build_object('channel_id', 'C1', 'ts', '1700000050.000500', 'sender_id', v_admin,
                       'body', 'hello @Zachary', 'kind', 'text')
  ), true);
  if (select edited_at from public.messages where external_ref = 'C1:1700000050.000500') is not null then
    raise exception 're-rendering a mention stamped the message as edited';
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Property anchors are idempotent and dated as asked
  -- -------------------------------------------------------------------------
  perform public.add_property_anchors(v_conv2, v_admin, now() - interval '300 days');
  perform public.add_property_anchors(v_conv2, v_admin, now() - interval '300 days');
  if (select count(*) from public.property_threads where conversation_id = v_conv2) <> 2 then
    raise exception 'anchors are not idempotent';
  end if;
  if (select min(created_at) from public.messages where conversation_id = v_conv2 and meta ? 'property_thread') > now() - interval '299 days' then
    raise exception 'anchors were not dated at the channel''s creation';
  end if;

  -- -------------------------------------------------------------------------
  -- 6. The two fixes
  -- -------------------------------------------------------------------------
  insert into public.conversations (org_id, type, name, slug, is_private, created_by, archived_at)
  values (v_org, 'internal', 'old-room', 'old-room', true, v_admin, now());
  v_slug := public.next_available_slug(v_org, 'old-room');
  if v_slug <> 'old-room-2' then
    raise exception 'next_available_slug offered % though an archived room holds the slug', v_slug;
  end if;

  insert into public.properties (org_id, address, monday_item_id) values (v_org, '1 Check Street', 'M-42')
  on conflict (org_id, monday_item_id) do update set address = excluded.address;
  insert into public.properties (org_id, address, monday_item_id) values (v_org, '1 Check Street, Town', 'M-42')
  on conflict (org_id, monday_item_id) do update set address = excluded.address;
  if (select count(*) from public.properties where org_id = v_org and monday_item_id = 'M-42') <> 1 then
    raise exception 'the properties upsert did not find its index';
  end if;

  -- -------------------------------------------------------------------------
  -- 7. Cutover: grant_portal_access lifts the ban
  -- -------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_admin::text, false);
  perform public.grant_portal_access(v_guest, 'a-long-password-123');
  if (select banned_until from auth.users where id = v_guest) is not null then
    raise exception 'grant_portal_access left the ban in place';
  end if;
  if not (select portal_access from public.profiles where id = v_guest) then
    raise exception 'grant_portal_access left portal_access false';
  end if;

  perform set_config('request.jwt.claim.sub', '', false);
end $check$;
