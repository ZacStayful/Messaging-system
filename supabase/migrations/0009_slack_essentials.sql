-- 0009_slack_essentials.sql
-- Full-text search, group DMs and channel creation, attachment metadata, and
-- realtime broadcasts for reactions, pins and attachments.

-- ---------------------------------------------------------------------------
-- Search
-- ---------------------------------------------------------------------------
alter table public.messages
  add column if not exists body_tsv tsvector
    generated always as (to_tsvector('english', coalesce(body, ''))) stored;
create index if not exists messages_body_tsv_idx on public.messages using gin (body_tsv);
create index if not exists attachments_file_name_idx on public.attachments (lower(file_name));

-- Runs as the caller, so RLS decides what is searchable.
create or replace function public.search_messages(q text, max_rows int default 40)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_type public.conversation_type,
  conversation_name text,
  sender_id uuid,
  sender_name text,
  body text,
  visibility public.message_visibility,
  created_at timestamptz,
  rank real
)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('english', coalesce(q, '')) as tsq, trim(coalesce(q, '')) as raw)
  select m.id, m.conversation_id, c.type, c.name, m.sender_id, p.display_name, m.body, m.visibility, m.created_at,
         coalesce(ts_rank(m.body_tsv, query.tsq), 0) as rank
    from public.messages m
    cross join query
    join public.conversations c on c.id = m.conversation_id
    left join public.profiles p on p.id = m.sender_id
   where m.deleted_at is null
     and query.raw <> ''
     and (m.body_tsv @@ query.tsq or m.body ilike '%' || query.raw || '%')
   order by rank desc, m.created_at desc
   limit greatest(1, least(max_rows, 100))
$$;
revoke all on function public.search_messages(text, int) from public, anon;
grant execute on function public.search_messages(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Attachment metadata (duration, dimensions, voice flag)
-- ---------------------------------------------------------------------------
alter table public.attachments add column if not exists meta jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Group DMs and channels (team only; customers cannot start group conversations, D13)
-- ---------------------------------------------------------------------------
create or replace function public.create_group_dm(p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_org uuid;
  cid uuid;
  uid uuid;
  members uuid[];
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can start group messages';
  end if;
  select org_id into my_org from public.profiles where id = me;
  select array_agg(distinct x) into members
    from unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), me)) as x
    join public.profiles p on p.id = x and p.org_id = my_org and p.deactivated_at is null;
  if members is null or array_length(members, 1) < 3 then
    raise exception 'a group message needs at least two other people';
  end if;
  insert into public.conversations (org_id, type, is_private, created_by)
  values (my_org, 'group_dm', true, me) returning id into cid;
  foreach uid in array members loop
    insert into public.conversation_members (conversation_id, user_id, org_id, last_read_at)
    values (cid, uid, my_org, case when uid = me then now() else null end);
  end loop;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'group_dm.created', 'conversation', cid::text, jsonb_build_object('members', to_jsonb(members)));
  return cid;
end $$;
revoke all on function public.create_group_dm(uuid[]) from public, anon;
grant execute on function public.create_group_dm(uuid[]) to authenticated;

create or replace function public.create_channel(p_name text, p_type public.conversation_type, p_member_ids uuid[] default '{}'::uuid[], p_topic text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_org uuid;
  cid uuid;
  uid uuid;
  v_slug text;
  members uuid[];
begin
  if me is null or not public.is_team() then
    raise exception 'only Stayful team members can create groups';
  end if;
  if p_type not in ('owner', 'internal') then
    raise exception 'groups are either customer groups or internal channels';
  end if;
  select org_id into my_org from public.profiles where id = me;
  v_slug := trim(both '-' from regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    raise exception 'give the group a name';
  end if;
  if exists (select 1 from public.conversations c where c.org_id = my_org and c.slug = v_slug and c.archived_at is null) then
    raise exception 'a group called % already exists', v_slug;
  end if;
  insert into public.conversations (org_id, type, name, slug, topic, is_private, created_by)
  values (my_org, p_type, v_slug, v_slug, nullif(trim(p_topic), ''), true, me) returning id into cid;
  select array_agg(distinct x) into members
    from unnest(array_append(coalesce(p_member_ids, '{}'::uuid[]), me)) as x
    join public.profiles p on p.id = x and p.org_id = my_org and p.deactivated_at is null;
  foreach uid in array members loop
    insert into public.conversation_members (conversation_id, user_id, org_id, last_read_at)
    values (cid, uid, my_org, case when uid = me then now() else null end);
  end loop;
  insert into public.messages (org_id, conversation_id, sender_id, body, kind, meta)
  values (my_org, cid, null, format('%s created this group.', (select display_name from public.profiles where id = me)),
          'system', jsonb_build_object('event', 'channel_created', 'user_id', me::text));
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (my_org, me, 'channel.created', 'conversation', cid::text, jsonb_build_object('name', v_slug, 'type', p_type::text, 'members', to_jsonb(members)));
  return cid;
end $$;
revoke all on function public.create_channel(text, public.conversation_type, uuid[], text) from public, anon;
grant execute on function public.create_channel(text, public.conversation_type, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: reactions, pins and attachments on the conversation topic
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_reaction_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec public.reactions;
  cid uuid;
begin
  rec := coalesce(new, old);
  select conversation_id into cid from public.messages where id = rec.message_id;
  if cid is not null then
    perform realtime.broadcast_changes('conversation:' || cid::text, 'REACTION', tg_op, tg_table_name, tg_table_schema, new, old);
  end if;
  return null;
end $$;
revoke execute on function public.broadcast_reaction_changes() from public, anon, authenticated;
create trigger reactions_broadcast
  after insert or delete on public.reactions
  for each row execute function public.broadcast_reaction_changes();

create or replace function public.broadcast_pin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.pins;
begin
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, 'PIN', tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;
revoke execute on function public.broadcast_pin_changes() from public, anon, authenticated;
create trigger pins_broadcast
  after insert or delete on public.pins
  for each row execute function public.broadcast_pin_changes();

create or replace function public.broadcast_attachment_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.attachments;
begin
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, 'ATTACHMENT', tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;
revoke execute on function public.broadcast_attachment_changes() from public, anon, authenticated;
create trigger attachments_broadcast
  after insert or delete on public.attachments
  for each row execute function public.broadcast_attachment_changes();

-- Members may remove attachments from their own messages (needed for cancelled uploads).
create policy "attachments: remove from own messages"
  on public.attachments for delete to authenticated
  using (
    org_id = (select public.auth_org_id())
    and exists (select 1 from public.messages m where m.id = message_id and m.sender_id = (select auth.uid()))
  );
