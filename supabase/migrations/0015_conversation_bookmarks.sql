-- 0015_conversation_bookmarks.sql
-- Slack-style bookmarks: per-conversation links to third-party sites and important
-- information, shown as a bar under the conversation header and managed in a Bookmarks tab.
-- Any member may add one; the team (or the person who added it) may edit, reorder and remove.

create table if not exists public.conversation_bookmarks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organisations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  title           text not null,
  url             text not null,
  emoji           text,
  note            text,
  position        int  not null default 0,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- http/https only. The TypeScript side (src/lib/urls.ts) also rejects private hosts; this is
  -- the backstop that holds however the row arrives, including over the API.
  constraint conversation_bookmarks_url_check check (url ~* '^https?://'),
  constraint conversation_bookmarks_title_check check (length(btrim(title)) between 1 and 120)
);
create index if not exists conversation_bookmarks_conv_idx
  on public.conversation_bookmarks (conversation_id, position, created_at);
create index if not exists conversation_bookmarks_org_idx on public.conversation_bookmarks (org_id);
alter table public.conversation_bookmarks enable row level security;

-- Policies mirror public.pins (0002_rls.sql, as hardened in 0005) so bookmark visibility can
-- never drift from the pins the same people already see. The difference is UPDATE, which pins
-- do not have, and that a customer is held to their own rows while the team can tidy any.
create policy "bookmarks: members read"
  on public.conversation_bookmarks for select to authenticated
  using (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));

create policy "bookmarks: members add"
  on public.conversation_bookmarks for insert to authenticated
  with check (org_id = (select public.auth_org_id())
              and public.is_member(conversation_id)
              and created_by = (select auth.uid()));

create policy "bookmarks: team or author edit"
  on public.conversation_bookmarks for update to authenticated
  using (org_id = (select public.auth_org_id())
         and public.is_member(conversation_id)
         and ((select public.is_team()) or created_by = (select auth.uid())))
  with check (org_id = (select public.auth_org_id()) and public.is_member(conversation_id));

create policy "bookmarks: team or author remove"
  on public.conversation_bookmarks for delete to authenticated
  using (org_id = (select public.auth_org_id())
         and public.is_member(conversation_id)
         and ((select public.is_team()) or created_by = (select auth.uid())));

drop trigger if exists conversation_bookmarks_updated_at on public.conversation_bookmarks;
create trigger conversation_bookmarks_updated_at
  before update on public.conversation_bookmarks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Add and reorder
-- ---------------------------------------------------------------------------
-- Positions are integers spaced by 1000, so a reorder rewrites two rows and never needs
-- rebalancing; a later drag-and-drop can insert at (prev + next) / 2 for a good while.
create or replace function public.add_bookmark(
  p_conversation_id uuid,
  p_title text,
  p_url text,
  p_emoji text default null,
  p_note text default null
) returns public.conversation_bookmarks
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); conv public.conversations%rowtype; row public.conversation_bookmarks;
begin
  select * into conv from public.conversations where id = p_conversation_id;
  if conv.id is null or not public.is_member(conv.id) then raise exception 'not allowed'; end if;
  if conv.archived_at is not null then raise exception 'this group is archived'; end if;
  if p_url !~* '^https?://' then raise exception 'a bookmark must be an http or https link'; end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'a bookmark needs a title'; end if;

  insert into public.conversation_bookmarks
    (org_id, conversation_id, title, url, emoji, note, position, created_by)
  values (
    conv.org_id, conv.id, left(btrim(p_title), 120), btrim(p_url),
    nullif(btrim(coalesce(p_emoji, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    coalesce((select max(position) from public.conversation_bookmarks where conversation_id = conv.id), 0) + 1000,
    me)
  returning * into row;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, diff)
  values (conv.org_id, me, 'bookmark.added', 'conversation', conv.id::text,
          jsonb_build_object('bookmark_id', row.id, 'title', row.title, 'url', row.url));
  return row;
end $$;
revoke all on function public.add_bookmark(uuid, text, text, text, text) from public, anon;
grant execute on function public.add_bookmark(uuid, text, text, text, text) to authenticated;

-- Swap with the neighbour above (-1) or below (+1). Team only, like the other tidying RPCs.
create or replace function public.move_bookmark(p_id uuid, p_delta int)
returns void language plpgsql security definer set search_path = public as $$
declare a public.conversation_bookmarks; b public.conversation_bookmarks;
begin
  select * into a from public.conversation_bookmarks where id = p_id;
  if a.id is null or not public.is_member(a.conversation_id) then raise exception 'not allowed'; end if;
  if not public.is_team() then raise exception 'only the Stayful team can reorder bookmarks'; end if;
  if p_delta = 0 then return; end if;

  if p_delta < 0 then
    select * into b from public.conversation_bookmarks
     where conversation_id = a.conversation_id and position < a.position
     order by position desc limit 1;
  else
    select * into b from public.conversation_bookmarks
     where conversation_id = a.conversation_id and position > a.position
     order by position asc limit 1;
  end if;
  if b.id is null then return; end if;   -- already at the end

  update public.conversation_bookmarks set position = b.position where id = a.id;
  update public.conversation_bookmarks set position = a.position where id = b.id;
end $$;
revoke all on function public.move_bookmark(uuid, int) from public, anon;
grant execute on function public.move_bookmark(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Mirrors broadcast_pin_changes (0009_slack_essentials.sql) and rides the same
-- conversation:<id> topic. No new realtime policy is needed: "realtime: members receive
-- conversation events" (0003_realtime.sql) authorises the topic by membership and does not
-- look at the event name. Unlike pins, bookmarks are edited and reordered, so UPDATE counts.
create or replace function public.broadcast_bookmark_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare rec public.conversation_bookmarks;
begin
  rec := coalesce(new, old);
  perform realtime.broadcast_changes('conversation:' || rec.conversation_id::text, 'BOOKMARK',
                                     tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;
revoke execute on function public.broadcast_bookmark_changes() from public, anon, authenticated;
drop trigger if exists conversation_bookmarks_broadcast on public.conversation_bookmarks;
create trigger conversation_bookmarks_broadcast
  after insert or update or delete on public.conversation_bookmarks
  for each row execute function public.broadcast_bookmark_changes();
