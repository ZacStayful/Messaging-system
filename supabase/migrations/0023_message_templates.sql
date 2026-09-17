-- 0023_message_templates.sql
-- The standard messages Stayful posts automatically, stored where they can be edited.
--
-- The welcome message a customer group opens with has lived in a Slack snippet and been pasted
-- by hand until now. Automating the group creation (0026) without automating the message would
-- just move the pasting, so the body lives here: one row per named template, editable by an
-- admin at /settings/templates, rendered with a few placeholders at the moment it is posted.
--
-- This deliberately copies bookmark_templates (0021) rather than inventing a second mechanism:
-- same (org_id, key) primary key, same applies_to array, same active flag, same two policies.
-- Anyone who understands one understands the other.
--
-- What it does NOT copy is the reapply trigger. A bookmark is a property of a group and should
-- change everywhere when the catalogue changes; a message is an event that happened at a moment
-- in time. Editing the welcome text must never rewrite what a customer already read.

create table if not exists public.message_templates (
  org_id      uuid not null references public.organisations (id) on delete cascade,
  key         text not null,
  title       text not null,
  description text,
  -- Plain text in the markdown subset src/lib/richtext.ts parses, because that is exactly what
  -- messages.body holds (body_json is written null by the composer). A template that stored
  -- anything richer would need a second renderer that could drift from the first.
  body        text not null,
  applies_to  public.conversation_type[] not null default array['owner']::public.conversation_type[],
  active      boolean not null default true,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (org_id, key)
);

alter table public.message_templates enable row level security;
create policy "message templates: team reads"
  on public.message_templates for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_team()));
create policy "message templates: admins write"
  on public.message_templates for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_admin()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Rendering
-- ---------------------------------------------------------------------------
-- {{placeholder}} substitution and nothing else. No conditionals, no loops: a template a
-- non-developer edits in a textarea should not be able to fail at render time.
--
-- An unknown placeholder is left in the body on purpose. Silently blanking it hides the mistake
-- until a customer reads it; leaving "{{proprty_address}}" visible in the preview does not.
--
-- src/lib/templates/render.ts is the TypeScript twin of this. The webhook uses that one (it is
-- already holding the values); this exists so the same template is renderable from SQL, MCP or
-- n8n later without a round trip through the app.
create or replace function public.render_message_template(p_org uuid, p_key text, p_vars jsonb default '{}'::jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_body text; k text; v text;
begin
  select body into v_body from public.message_templates
   where org_id = p_org and key = p_key and active;
  if v_body is null then return null; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_vars, '{}'::jsonb)) loop
    v_body := replace(v_body, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return v_body;
end $$;
revoke all on function public.render_message_template(uuid, text, jsonb) from public, anon;
grant execute on function public.render_message_template(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The welcome message
-- ---------------------------------------------------------------------------
-- Converted into the markdown subset richtext.ts actually parses:
--   "* item"            -> "- item"        (a leading * is italic syntax, not a bullet)
--   a section heading   -> "**Heading**"   (a fully bold line renders as a heading)
--   [text](url)         kept as-is, already supported
--
-- The four team introductions are bold rather than @mentions. A mention chip is matched against
-- display names by my_conversations, so mentioning all four in every new group would put a
-- mention badge on four people's sidebars for every client we onboard. Whoever wants that can
-- edit the template and use @[Full Name].
-- The catalogue itself, as a function rather than a bare INSERT, because two places need it:
-- the seed below for organisations that exist now, and the trigger after it for organisations
-- created later. On a fresh local stack that second path is the only one that fires at all —
-- `supabase db reset` applies migrations before seed.sql creates the organisation, so a plain
-- `select from organisations` seeds nothing and a customer group would come up with no welcome
-- message and nothing to say why. (bookmark_templates, 0021, has the same gap; it is just less
-- visible there, because a missing bookmark is a missing link rather than a missing message.)
create or replace function public.default_message_templates()
returns table (key text, title text, description text, body text, applies_to public.conversation_type[])
language sql immutable set search_path = public as $fn$
  select 'customer_welcome',
         'Customer group welcome',
         'Posted automatically when a customer group is created. Placeholders: {{customer_name}}, {{first_name}}, {{property_address}}, {{account_manager}}.',
         $welcome$Welcome to Stayful! This software is the main channel of communication we use with our clients. If you have any questions or concerns about your listing or Stayful then put them in this chat and we aim to get back to you in 24 hours with the exception of weekends & bank holidays.

If you have not already, we need you to complete the onboarding form before your property can go live. You can find it [here](https://www.stayful.co.uk/onboarding).

**Our next steps**

- Book your kick off call [here](https://calendly.com/d/cxpp-2q7-6xz/stayful-kick-off-call)
- Inspect your property and carry out a deep clean to ensure it is ready for guests. The cost of this will vary depending on what condition your property is in.
- Receive professional photos of the property (if you have arranged these through us then this is in hand).
- Communicate with team members to ensure everyone is briefed and all records are up to date.
- Set up your listings on all the online platforms (Booking.com, Stayful and Airbnb).
- Arrange our first web meeting.

**What we need from you**

- Onboarding details filled out.
- Confirmation that WiFi is installed at the property and working. Please put the WiFi network name & password on the onboarding form.
- Bin collection days (if your property is a house you will need to set up commercial waste collection before we can go live).
- Details of anything to do with parking at the property we need to be made aware of, for example parking permits. This can be added to the onboarding form.
- Key safe's location & code (you will need a main key and a spare, kept in separate safe locations or lock boxes). Plus the locations of any others.
- Set up utilities if not already. Meters will need to be credit, not pre-payment.
- Set up council tax/business rates if not already.

**Meet the team**

We have a few members inside of this channel just to make some introductions.

**Jerah** (Admin assistant) - Jerah will be sending you your client statements and work with Martyn to help answer questions.

**Bien** (Maintenance manager) - Bien is responsible for sorting out any and all maintenance work needed for your property. We have permission to sort out expenses up until £200 per property; if we go above this Bien will be getting in touch.

**Martyn** (Operations manager) - Martyn is the co-owner at Stayful and the ops manager. He will be on hand to assist with any questions you have regarding the service.

**Zac** (Sales manager) - Zac runs the sales and marketing side of Stayful. If you have any questions regarding a new property, wanting to leave our services or updates on the onboarding process, Zac will be able to help.

**Important note:** we require 10-15 working days to set up your listing, so be expecting things to take this long. We will be in touch if there is any snagging needed to take place which could delay this process.

If you have questions please put them in this chat and not anywhere else. This chat is monitored and you will get a response in our agreed timeframe; any communication outside of this channel we can't guarantee a response time.$welcome$,
         array['owner']::public.conversation_type[]
$fn$;
revoke all on function public.default_message_templates() from public, anon;
grant execute on function public.default_message_templates() to authenticated;

-- do nothing, never do update: re-running a migration must not overwrite an edited welcome
-- message. The template is the team's to change once it exists.
insert into public.message_templates (org_id, key, title, description, body, applies_to)
select o.id, d.key, d.title, d.description, d.body, d.applies_to
  from public.organisations o cross join public.default_message_templates() d
on conflict (org_id, key) do nothing;

create or replace function public.default_bookmark_templates()
-- `position` is reserved in a RETURNS TABLE column list, hence pos.
returns table (key text, title text, url text, emoji text, pos int, applies_to public.conversation_type[])
language sql immutable set search_path = public as $fn$
  values ('quarterly_review', 'Book a quarterly review call',
          'https://calendly.com/d/cxp8-p9n-99v/quaterly-review-call', '📅', 10,
          array['owner']::public.conversation_type[]),
         ('stayful_intelligence', 'Stayful Intelligence',
          'https://intelligence.stayful.co.uk/', '📊', 20,
          array['owner']::public.conversation_type[])
$fn$;
revoke all on function public.default_bookmark_templates() from public, anon;
grant execute on function public.default_bookmark_templates() to authenticated;

-- 0021 seeded bookmark_templates the same way — `select from organisations` — and so has the
-- same hole: an organisation created after that migration ran gets no mandatory bookmarks at
-- all, and conversations_apply_bookmarks then faithfully applies an empty catalogue to every
-- group it creates. Catching it up here rather than leaving two seeding mechanisms that behave
-- differently; on production, where the organisation already exists, this is a no-op.
insert into public.bookmark_templates (org_id, key, title, url, emoji, position, is_mandatory, applies_to)
select o.id, d.key, d.title, d.url, d.emoji, d.pos, true, d.applies_to
  from public.organisations o cross join public.default_bookmark_templates() d
on conflict (org_id, key) do nothing;

create or replace function public.organisations_seed_catalogues()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.message_templates (org_id, key, title, description, body, applies_to)
  select new.id, d.key, d.title, d.description, d.body, d.applies_to
    from public.default_message_templates() d
  on conflict (org_id, key) do nothing;

  insert into public.bookmark_templates (org_id, key, title, url, emoji, position, is_mandatory, applies_to)
  select new.id, d.key, d.title, d.url, d.emoji, d.pos, true, d.applies_to
    from public.default_bookmark_templates() d
  on conflict (org_id, key) do nothing;
  return null;
end $$;
revoke execute on function public.organisations_seed_catalogues() from public, anon, authenticated;
drop trigger if exists organisations_seed_templates on public.organisations;
drop trigger if exists organisations_seed_catalogues on public.organisations;
create trigger organisations_seed_catalogues
  after insert on public.organisations
  for each row execute function public.organisations_seed_catalogues();
