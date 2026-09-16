-- 0021_mandatory_bookmarks.sql
-- Two links every customer group must carry: the quarterly review call, and Stayful
-- Intelligence. Bookmarks themselves already exist (0015); this is what makes a set of them
-- required, applied automatically, and expandable without a deploy.

alter table public.conversation_bookmarks
  add column if not exists is_mandatory boolean not null default false,
  add column if not exists template_key text;

-- NULLS DISTINCT (the default): many ad-hoc bookmarks, at most one row per template.
create unique index if not exists conversation_bookmarks_template_idx
  on public.conversation_bookmarks (conversation_id, template_key);

-- The catalogue. Adding a third mandatory bookmark later is an INSERT here and nothing else:
-- the reapply trigger below pushes it to every existing group.
create table if not exists public.bookmark_templates (
  org_id       uuid not null references public.organisations (id) on delete cascade,
  key          text not null,
  title        text not null,
  url          text not null check (url ~* '^https?://'),
  emoji        text,
  note         text,
  position     int  not null default 0,
  is_mandatory boolean not null default true,
  applies_to   public.conversation_type[] not null default array['owner']::public.conversation_type[],
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  primary key (org_id, key)
);
alter table public.bookmark_templates enable row level security;
create policy "bookmark templates: team reads"
  on public.bookmark_templates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
create policy "bookmark templates: admins write"
  on public.bookmark_templates for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Making "mandatory" mean something
-- ---------------------------------------------------------------------------
-- RLS alone is not enough. add_bookmark and move_bookmark are SECURITY DEFINER, and
-- DELETE /api/v1/bookmarks/{id} and the MCP remove_bookmark tool reach this table through
-- src/lib/api/service.ts. A policy would be bypassed by all three; a trigger is not.
-- auth.uid() is null for the service role, so migrations and apply_bookmark_templates pass.
create or replace function public.conversation_bookmarks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_mandatory and auth.uid() is not null then
      raise exception 'that bookmark is on every Stayful customer group and cannot be removed';
    end if;
    return old;
  end if;
  -- Reordering stays allowed so the team can arrange the bar; renaming or re-pointing does not,
  -- for anyone. bookmark_templates is the single source of truth, and apply_bookmark_templates
  -- overwrites title and url from it — so an edit made here would quietly revert the next time a
  -- template changed. Admins change the template instead, which fans the change out everywhere.
  if old.is_mandatory and auth.uid() is not null
     and (new.title is distinct from old.title or new.url is distinct from old.url
          or new.is_mandatory is distinct from old.is_mandatory) then
    raise exception 'this bookmark is set for every customer group; change it in bookmark_templates';
  end if;
  return new;
end $$;
revoke execute on function public.conversation_bookmarks_guard() from public, anon, authenticated;
drop trigger if exists conversation_bookmarks_guard on public.conversation_bookmarks;
create trigger conversation_bookmarks_guard
  before update or delete on public.conversation_bookmarks
  for each row execute function public.conversation_bookmarks_guard();

-- Defence in depth, and it gives the UI a cleaner refusal than a raised exception.
alter policy "bookmarks: team or author remove" on public.conversation_bookmarks
  using (org_id = (select public.auth_org_id())
         and public.is_member(conversation_id)
         and not is_mandatory
         and ((select public.is_team()) or created_by = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Applying the catalogue
-- ---------------------------------------------------------------------------
create or replace function public.apply_bookmark_templates(p_conversation_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; n int := 0;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null then return 0; end if;
  insert into public.conversation_bookmarks
    (org_id, conversation_id, title, url, emoji, note, position, is_mandatory, template_key)
  select c.org_id, c.id, t.title, t.url, t.emoji, t.note, t.position, t.is_mandatory, t.key
    from public.bookmark_templates t
   where t.org_id = c.org_id and t.active and c.type = any (t.applies_to)
  on conflict (conversation_id, template_key) do update
    set title = excluded.title, url = excluded.url, emoji = excluded.emoji,
        note = excluded.note, position = excluded.position,
        is_mandatory = excluded.is_mandatory, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.apply_bookmark_templates(uuid) from public, anon, authenticated;

-- Every creation path ends in an INSERT on conversations — create_channel, create_group_dm, and
-- the direct insert in customers/new/actions.ts — so one trigger covers all three with no
-- application change. applies_to keeps DMs clean.
create or replace function public.conversations_apply_bookmarks()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.apply_bookmark_templates(new.id); return null; end $$;
revoke execute on function public.conversations_apply_bookmarks() from public, anon, authenticated;
drop trigger if exists conversations_apply_bookmarks on public.conversations;
create trigger conversations_apply_bookmarks
  after insert on public.conversations
  for each row execute function public.conversations_apply_bookmarks();

-- This is both the backfill and the expansion mechanism: inserting a template fans it out to
-- every existing group, so growing the mandatory set needs no deploy.
create or replace function public.bookmark_templates_reapply()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  for c in select id from public.conversations
            where org_id = new.org_id and type = any (new.applies_to) and archived_at is null
  loop perform public.apply_bookmark_templates(c.id); end loop;
  return null;
end $$;
revoke execute on function public.bookmark_templates_reapply() from public, anon, authenticated;
drop trigger if exists bookmark_templates_reapply on public.bookmark_templates;
create trigger bookmark_templates_reapply
  after insert or update on public.bookmark_templates
  for each row execute function public.bookmark_templates_reapply();

-- ---------------------------------------------------------------------------
-- The two required bookmarks, and the backfill they trigger
-- ---------------------------------------------------------------------------
-- Positions 10 and 20 sit below the 1000-spaced positions add_bookmark assigns, so these always
-- lead the bar however many bookmarks a group collects.
insert into public.bookmark_templates (org_id, key, title, url, emoji, position, is_mandatory, applies_to)
select o.id, v.key, v.title, v.url, v.emoji, v.position, true, array['owner']::public.conversation_type[]
  from public.organisations o
 cross join (values
   ('quarterly_review', 'Book a quarterly review call',
    'https://calendly.com/d/cxp8-p9n-99v/quaterly-review-call', '📅', 10),
   ('stayful_intelligence', 'Stayful Intelligence',
    'https://intelligence.stayful.co.uk/', '📊', 20)
 ) as v(key, title, url, emoji, position)
on conflict (org_id, key) do update
  set title = excluded.title, url = excluded.url, emoji = excluded.emoji,
      position = excluded.position, is_mandatory = excluded.is_mandatory, active = true;
-- bookmark_templates_reapply fires on that insert and backfills every existing owner group.
