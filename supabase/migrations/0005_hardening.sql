-- 0005_hardening.sql
-- Fixes raised by the Supabase security and performance advisors after 0001-0004.

-- 1. Pin search_path on every function
alter function public.set_updated_at() set search_path = public;
alter function public.messages_before_update() set search_path = public;
alter function public.topic_conversation_id(text) set search_path = public;
alter function public.storage_path_conversation_id(text) set search_path = public;

-- 2. Trigger functions are never called over the API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.messages_after_insert() from public, anon, authenticated;
revoke execute on function public.broadcast_message_changes() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.messages_before_update() from public, anon, authenticated;

-- 3. Helpers and RPCs: signed-in users only
revoke execute on function public.auth_org_id() from anon;
revoke execute on function public.is_team() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_member(uuid) from anon;
revoke execute on function public.shares_conversation_with(uuid) from anon;
revoke execute on function public.dm_between(uuid) from anon;
revoke execute on function public.mark_read(uuid) from anon;
revoke execute on function public.my_conversations() from anon;
revoke execute on function public.my_activity(timestamptz, int) from anon;
revoke execute on function public.topic_conversation_id(text) from anon;
revoke execute on function public.storage_path_conversation_id(text) from anon;

-- 4. Covering indexes for foreign keys
create index if not exists attachments_org_idx on public.attachments (org_id);
create index if not exists conversation_members_org_idx on public.conversation_members (org_id);
create index if not exists conversations_assignee_idx on public.conversations (assignee_id);
create index if not exists conversations_created_by_idx on public.conversations (created_by);
create index if not exists conversations_owner_idx on public.conversations (owner_user_id);
create index if not exists pins_message_idx on public.pins (message_id);
create index if not exists pins_org_idx on public.pins (org_id);
create index if not exists pins_pinned_by_idx on public.pins (pinned_by);
create index if not exists reactions_org_idx on public.reactions (org_id);
create index if not exists reactions_user_idx on public.reactions (user_id);

-- 5. One select policy on profiles instead of three permissive ones
drop policy "profiles: read own" on public.profiles;
drop policy "profiles: team reads org" on public.profiles;
drop policy "profiles: customers read shared" on public.profiles;
create policy "profiles: read"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      org_id = (select public.auth_org_id())
      and ((select public.is_team()) or public.shares_conversation_with(id))
    )
  );

-- 6. Evaluate auth.uid() and the helpers once per statement, not per row
alter policy "profiles: update own" on public.profiles
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and account_type = (select account_type from public.profiles p where p.id = (select auth.uid()))
    and role = (select role from public.profiles p where p.id = (select auth.uid()))
  );

alter policy "org: members read their org" on public.organisations
  using (id = (select public.auth_org_id()));
alter policy "org: admins update settings" on public.organisations
  using (id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (id = (select public.auth_org_id()));

alter policy "conversations: members read" on public.conversations
  using (org_id = (select public.auth_org_id()) and public.is_member(id));
alter policy "conversations: team creates" on public.conversations
  with check (org_id = (select public.auth_org_id()) and (select public.is_team()) and created_by = (select auth.uid()));
alter policy "conversations: team members update" on public.conversations
  using (org_id = (select public.auth_org_id()) and (select public.is_team()) and public.is_member(id))
  with check (org_id = (select public.auth_org_id()));

alter policy "members: members read membership" on public.conversation_members
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));
alter policy "members: team adds people" on public.conversation_members
  with check (
    org_id = (select public.auth_org_id())
    and (select public.is_team())
    and (public.is_member(conversation_id) or (select public.is_admin())
         or exists (select 1 from public.conversations c where c.id = conversation_id and c.created_by = (select auth.uid())))
  );
alter policy "members: update own read state" on public.conversation_members
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
alter policy "members: team removes people" on public.conversation_members
  using (org_id = (select public.auth_org_id()) and (select public.is_team()) and (public.is_member(conversation_id) or (select public.is_admin())));

alter policy "messages: members read (internal notes team-only)" on public.messages
  using (
    org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
    and (visibility = 'public' or (select public.is_team()))
  );
alter policy "messages: members post as themselves" on public.messages
  with check (
    org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
    and sender_id = (select auth.uid())
    and kind in ('text', 'document')
    and (visibility = 'public' or (select public.is_team()))
  );
alter policy "messages: edit own (customers within 15 minutes)" on public.messages
  using (
    org_id = (select public.auth_org_id())
    and sender_id = (select auth.uid())
    and ((select public.is_team()) or created_at > now() - interval '15 minutes')
  )
  with check (
    org_id = (select public.auth_org_id())
    and sender_id = (select auth.uid())
    and conversation_id = (select m.conversation_id from public.messages m where m.id = messages.id)
  );

alter policy "attachments: members read" on public.attachments
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));
alter policy "attachments: members attach to own messages" on public.attachments
  with check (
    org_id = (select public.auth_org_id())
    and public.is_member(conversation_id)
    and exists (select 1 from public.messages m where m.id = message_id and m.sender_id = (select auth.uid()) and m.conversation_id = attachments.conversation_id)
  );

alter policy "pins: members read" on public.pins
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));
alter policy "pins: members pin" on public.pins
  with check (org_id = (select public.auth_org_id()) and public.is_member(conversation_id) and pinned_by = (select auth.uid()));
alter policy "pins: members unpin" on public.pins
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));

alter policy "reactions: members read" on public.reactions
  using (org_id = (select public.auth_org_id()) and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
alter policy "reactions: react as yourself" on public.reactions
  with check (org_id = (select public.auth_org_id()) and user_id = (select auth.uid()) and exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.conversation_id)));
alter policy "reactions: remove own" on public.reactions
  using (user_id = (select auth.uid()));

alter policy "audit: anyone records their own actions" on public.audit_log
  with check (org_id = (select public.auth_org_id()) and actor_id = (select auth.uid()));
alter policy "audit: admins read" on public.audit_log
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()));

alter policy "realtime: own user topic" on realtime.messages
  using (realtime.topic() = 'user:' || (select auth.uid())::text);
alter policy "realtime: org presence receive" on realtime.messages
  using (realtime.topic() = 'org:' || (select public.auth_org_id())::text);
alter policy "realtime: org presence send" on realtime.messages
  with check (realtime.topic() = 'org:' || (select public.auth_org_id())::text);

alter policy "attachments: members read files" on storage.objects
  using (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and public.is_member(public.storage_path_conversation_id(name))
  );
alter policy "attachments: members upload files" on storage.objects
  with check (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and public.is_member(public.storage_path_conversation_id(name))
  );
alter policy "attachments: uploader removes own files" on storage.objects
  using (bucket_id = 'attachments' and owner = (select auth.uid()));
