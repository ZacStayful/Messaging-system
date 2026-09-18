-- 0038_sidebar_sections.sql
-- Sections of the sidebar that a person makes for themselves.
--
-- Every heading in the sidebar today is computed: Starred from conversation_members.starred,
-- Customers and Channels from conversations.type, and the two lead sub-lists from
-- profiles.lead_category. None of that can express "these six groups are the ones I am working on
-- this week", so a team member with thirty groups scrolls past twenty-nine of them to reach one.
--
-- These two tables let them name a section and file groups into it by dragging. They are private:
-- organising your own sidebar must never move anybody else's, which is the same rule starring and
-- muting already follow.
--
-- Shaped after saved_items (0010) rather than after a column on conversation_members, for two
-- reasons:
--
--   * conversation_members is writable by its owner through "members: update own read state"
--     (0002, tightened by 0005 and 0029) with no restriction on which columns move. A section id
--     there could be pointed at someone else's section by one PATCH, so it would need its own
--     BEFORE UPDATE guard — and 0029 exists precisely because that table was abused that way.
--     Here the privacy is a WITH CHECK on an insert policy and there is nothing to guard.
--
--   * it would mean dropping and recreating my_conversations() to widen its return type. That is a
--     real precedent (0034) but it is the riskiest edit available in this schema, and a preference
--     nobody else can see does not justify it. The sidebar reads these two tables directly.

-- ---------------------------------------------------------------------------
-- The sections
-- ---------------------------------------------------------------------------
create table if not exists public.sidebar_sections (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organisations (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  -- Spaced by 1000 the way conversation_bookmarks.position is (0015), so a later drag to reorder
  -- the sections themselves can insert at (prev + next) / 2 without rewriting the column.
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sidebar_sections_name_check check (length(btrim(name)) between 1 and 60)
);

-- Two sections with the same name would be indistinguishable in the sidebar and in the "move to"
-- menu, and dropping into the wrong one would look like the drop failing.
create unique index if not exists sidebar_sections_user_name_idx
  on public.sidebar_sections (user_id, lower(btrim(name)));
create index if not exists sidebar_sections_user_idx
  on public.sidebar_sections (user_id, position, created_at);
create index if not exists sidebar_sections_org_idx on public.sidebar_sections (org_id);

alter table public.sidebar_sections enable row level security;

-- No is_team() or is_admin() branch anywhere below: a section is the person's own and an admin has
-- no more business reading it than anyone else.
create policy "sections: own rows" on public.sidebar_sections for select to authenticated
  using (user_id = (select auth.uid()));
create policy "sections: create own" on public.sidebar_sections for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy "sections: update own" on public.sidebar_sections for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()));
create policy "sections: remove own" on public.sidebar_sections for delete to authenticated
  using (user_id = (select auth.uid()));

drop trigger if exists sidebar_sections_updated_at on public.sidebar_sections;
create trigger sidebar_sections_updated_at
  before update on public.sidebar_sections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- What is filed where
-- ---------------------------------------------------------------------------
-- The primary key is (user_id, conversation_id), not an id column: a conversation is in at most
-- one of my sections, so dropping it somewhere new is an upsert on a row that already exists
-- rather than a delete followed by an insert. Dragging it back out is a delete.
create table if not exists public.sidebar_section_items (
  org_id          uuid not null references public.organisations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- Cascade, so deleting a section un-files its groups and they fall back to the computed section
  -- they came from. Deleting a section must never make a conversation disappear from the sidebar.
  section_id      uuid not null references public.sidebar_sections (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
create index if not exists sidebar_section_items_section_idx
  on public.sidebar_section_items (user_id, section_id);
create index if not exists sidebar_section_items_conversation_idx
  on public.sidebar_section_items (conversation_id);
create index if not exists sidebar_section_items_org_idx on public.sidebar_section_items (org_id);

alter table public.sidebar_section_items enable row level security;

create policy "section items: own rows" on public.sidebar_section_items for select to authenticated
  using (user_id = (select auth.uid()));

-- The whole privacy story is these two WITH CHECKs, in the shape of "saved: save visible messages"
-- (0010): the section has to be mine, and I have to be in the conversation I am filing. Without
-- the first, a row could name someone else's section id; without the second, the sidebar would
-- become a way to note down conversations you cannot read.
create policy "section items: file own" on public.sidebar_section_items for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and exists (select 1 from public.sidebar_sections s
                 where s.id = section_id and s.user_id = (select auth.uid()))
    and public.is_member(conversation_id)
  );

create policy "section items: refile own" on public.sidebar_section_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id = (select public.auth_org_id())
    and exists (select 1 from public.sidebar_sections s
                 where s.id = section_id and s.user_id = (select auth.uid()))
    and public.is_member(conversation_id)
  );

create policy "section items: unfile own" on public.sidebar_section_items for delete to authenticated
  using (user_id = (select auth.uid()));
