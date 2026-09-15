-- seed.sql
-- Development seed reproducing the design prototype's data (stayful-data.js).
-- Run against a fresh database after the migrations. Idempotent: every row has
-- a fixed UUID and uses ON CONFLICT DO NOTHING.
--
-- Team users get no password (they sign in with a magic link or Google).
-- Two clearly-named test accounts get a password so the RLS test-suite can
-- sign in: replace __TEST_PASSWORD__ before running, never commit the value.

begin;

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------
insert into public.organisations (id, name, slug, settings)
values ('a0000000-0000-4000-8000-000000000001', 'Stayful', 'stayful',
        '{"default": true, "team_domains": ["stayful.co.uk"], "business_hours": "Mon-Fri 9am-5:30pm"}'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (dropped at the end)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_user(uid uuid, email text, meta jsonb, password text default null)
returns void language plpgsql as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', email,
    case when password is null then null else crypt(password, gen_salt('bf')) end,
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    meta || jsonb_build_object('org_slug', 'stayful'),
    now(), now(), '', '', '', '', false
  ) on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid, uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', email, 'email_verified', true),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;
end $$;

create or replace function pg_temp.seed_conv(cid uuid, ctype public.conversation_type, cname text, ctopic text, members uuid[], muted_for_zac boolean default false)
returns void language plpgsql as $$
declare m uuid;
begin
  insert into public.conversations (id, org_id, type, name, slug, topic, is_private, created_by, created_at)
  values (cid, 'a0000000-0000-4000-8000-000000000001', ctype, cname, cname, nullif(ctopic, ''), true,
          'b0000000-0000-4000-8000-000000000001', now() - interval '120 days')
  on conflict (id) do nothing;
  foreach m in array members loop
    insert into public.conversation_members (conversation_id, user_id, org_id, muted, joined_at)
    values (cid, m, 'a0000000-0000-4000-8000-000000000001',
            muted_for_zac and m = 'b0000000-0000-4000-8000-000000000001', now() - interval '120 days')
    on conflict do nothing;
  end loop;
end $$;

create or replace function pg_temp.seed_msg(mid uuid, cid uuid, sender uuid, body text, at timestamptz,
                                            kind public.message_kind default 'text', meta jsonb default '{}'::jsonb,
                                            visibility public.message_visibility default 'public')
returns void language plpgsql as $$
begin
  insert into public.messages (id, org_id, conversation_id, sender_id, body, kind, visibility, meta, sent_via, created_at)
  values (mid, 'a0000000-0000-4000-8000-000000000001', cid, sender, body, kind, visibility, meta, 'import', at)
  on conflict (id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- Users. b…01-09 team, b…11-21 customers, b…91-92 test accounts
-- ---------------------------------------------------------------------------
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000001', 'zac@stayful.co.uk',
  '{"display_name":"Zac","full_name":"Zac Harrison","account_type":"team","role":"admin","avatar_color":"#CFD5B9","avatar_url":"/brand/stayful-logo.png"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000002', 'martyn@stayful.co.uk',
  '{"display_name":"Martyn","full_name":"Martyn","account_type":"team","role":"admin","avatar_color":"#8AA6C9"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000003', 'bien@stayful.co.uk',
  '{"display_name":"Bien","full_name":"Jose Bien Tejo","account_type":"team","role":"staff","avatar_color":"#E0603A"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000004', 'trish@stayful.co.uk',
  '{"display_name":"Trish","full_name":"Trish","account_type":"team","role":"staff","avatar_color":"#25A6B5"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000005', 'jerah@stayful.co.uk',
  '{"display_name":"Jerah Ramos","full_name":"Jerah Lyn Ramos","account_type":"team","role":"staff","avatar_color":"#9C6A46"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000006', 'romarie@stayful.co.uk',
  '{"display_name":"Romarie","full_name":"Romarie","account_type":"team","role":"staff","avatar_color":"#E28A2B"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000007', 'marie@stayful.co.uk',
  '{"display_name":"Marie T","full_name":"Marie T","account_type":"team","role":"staff","avatar_color":"#1F8C7A"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000008', 'mylyn@stayful.co.uk',
  '{"display_name":"Mylyn","full_name":"Mylyn","account_type":"team","role":"staff","avatar_color":"#5D8156"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000009', 'jason@stayful.co.uk',
  '{"display_name":"Jason Dela Cruz","full_name":"Jason Dela Cruz","account_type":"team","role":"staff","avatar_color":"#6B7DB3"}');

select pg_temp.seed_user('b0000000-0000-4000-8000-000000000011', 'nigel.hyde@example.com',
  '{"display_name":"Nigel Hyde","full_name":"Nigel Hyde","account_type":"customer","role":"owner","avatar_color":"#2BB3A3"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000012', 'rohana.bakhshi@example.com',
  '{"display_name":"Rohana Bakhshi","full_name":"Rohana Bakhshi","account_type":"customer","role":"owner","avatar_color":"#2E7D5B"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000013', 'gareth.howard@example.com',
  '{"display_name":"Gareth Howard","full_name":"Gareth Howard","account_type":"customer","role":"owner","avatar_color":"#7F4FA8"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000014', 'harry.roberts@example.com',
  '{"display_name":"Harry Roberts","full_name":"Harry Roberts","account_type":"customer","role":"owner","avatar_color":"#2E7D5B"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000015', 'kabir.singh@example.com',
  '{"display_name":"Kabir Singh","full_name":"Kabir Singh","account_type":"customer","role":"owner","avatar_color":"#2BB3A3"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000016', 'joseph.obianwu@example.com',
  '{"display_name":"Joseph","full_name":"Joseph Obianwu","account_type":"customer","role":"owner","avatar_color":"#D83A7A"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000017', 'akter.uzzaman@example.com',
  '{"display_name":"Akter","full_name":"A S M Akter Uzzaman","account_type":"customer","role":"owner","avatar_color":"#7A8C99"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000018', 'ijaz.qazi@example.com',
  '{"display_name":"Ijaz Qazi","full_name":"Ijaz Qazi","account_type":"customer","role":"owner","avatar_color":"#E28A2B"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000019', 'vanessa.wilson-wood@example.com',
  '{"display_name":"Vanessa Wilson-Wood","full_name":"Vanessa Wilson-Wood","account_type":"customer","role":"owner","avatar_color":"#2A2A2A"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000020', 'nick.clarke@example.com',
  '{"display_name":"Nick Clarke","full_name":"Nick Clarke","account_type":"customer","role":"owner","avatar_color":"#4A56C9"}');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000021', 'jason.beckhurst@example.com',
  '{"display_name":"Jason Beckhurst","full_name":"Jason Beckhurst","account_type":"customer","role":"owner","avatar_color":"#6B7DB3"}');

-- Test accounts (password sign-in enabled for the RLS suite only)
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000091', 'test-staff@stayful.test',
  '{"display_name":"Test Staff","full_name":"Test Staff","account_type":"team","role":"staff","avatar_color":"#616061"}', '__TEST_PASSWORD__');
select pg_temp.seed_user('b0000000-0000-4000-8000-000000000092', 'test-customer@stayful.test',
  '{"display_name":"Test Customer","full_name":"Test Customer","account_type":"customer","role":"owner","avatar_color":"#616061"}', '__TEST_PASSWORD__');

-- Presence as shown in the prototype
update public.profiles set presence = 'online' where id = 'b0000000-0000-4000-8000-000000000002';
update public.profiles set presence = 'away'   where id in (
  'b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000013',
  'b0000000-0000-4000-8000-000000000012','b0000000-0000-4000-8000-000000000015','b0000000-0000-4000-8000-000000000017',
  'b0000000-0000-4000-8000-000000000018','b0000000-0000-4000-8000-000000000019','b0000000-0000-4000-8000-000000000007',
  'b0000000-0000-4000-8000-000000000020','b0000000-0000-4000-8000-000000000014');

-- ---------------------------------------------------------------------------
-- Direct messages (Zac with each person). c…01-16
-- ---------------------------------------------------------------------------
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000001', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000002', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000011']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000003', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000004', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000005', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000013']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000006', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000012']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000007', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000008']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000008', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000015']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000009', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000010', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000017']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000011', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000018']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000012', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000019']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000013', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000007']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000014', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000009']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000015', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000020']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000016', 'dm', null, '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000014']::uuid[]);

-- ---------------------------------------------------------------------------
-- Customer groups and property channels. c…21-39
-- ---------------------------------------------------------------------------
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000021', 'internal', '1-lyndhurst-road-ng24fw', '1 Lyndhurst Road, Newark NG24 4FW',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000022', 'owner', 'nigel-hyde', 'Set up in progress',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000003']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000023', 'owner', 'rohana-bakhshi', '',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000012']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000024', 'owner', 'alex-hk2uk', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000025', 'owner', 'alexander-thomas', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000026', 'owner', 'brian-kaw', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000027', 'owner', 'christian-dowse', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000028', 'owner', 'christopher-elphick', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000029', 'owner', 'doug-purser', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000030', 'owner', 'emma-agyekum', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000031', 'owner', 'emma-delaney', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000032', 'owner', 'fei-lui', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000033', 'owner', 'gareth-howard', '',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000013']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000034', 'owner', 'harry-roberts', '',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000014']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000035', 'owner', 'jack-potts', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[], true);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000036', 'owner', 'jason-beckhurst', '',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000021']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000037', 'owner', 'joe-durrant', '', array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000038', 'owner', 'joseph-obianwu', 'Apartment 8 Burgess Mill 20 Manchester Street DE23 6XL',
  array['b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000016','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000001']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000039', 'owner', 'kabir-singh', '',
  array['b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000015']::uuid[]);

-- Test fixtures for the RLS suite: a group the test customer is in (with an
-- internal note) and a team-only channel they are not in.
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000041', 'owner', 'test-customer', 'RLS fixture',
  array['b0000000-0000-4000-8000-000000000091','b0000000-0000-4000-8000-000000000092']::uuid[]);
select pg_temp.seed_conv('c0000000-0000-4000-8000-000000000042', 'internal', 'test-internal', 'RLS fixture',
  array['b0000000-0000-4000-8000-000000000091','b0000000-0000-4000-8000-000000000001']::uuid[]);

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
-- Zac <> Martyn
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
  'Working With Stayful.pdf https://drive.google.com/file/d/1UlRiP8Uqg0a5WJOODSrQIoF8hJ5bfC_z/view?usp=sharing', '2024-08-20 13:43+01');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  'Harrison Accommodations Ltd 90 main street swannington LE678QN that would be great cheers bud', '2024-07-05 11:13+01');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  'i would get your hard hat on mate because this does not look good 😂 what we do have working for us is all 5 stars since they joined on Airbnb and they even mention how clean it is', date_trunc('day', now()) - interval '1 day' + time '11:20');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
  'haha yeah fair. I think in the grand scheme of things its not a major issue but yeah he clearly doesnt feel that way', date_trunc('day', now()) - interval '1 day' + time '11:25');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  E'Hi mate can you make me an admin in slack\n\nI want to explore creating our own slack I think it will work better with ur dashboard and also can show much more features easily if we own the channel but I need to export all the chat history only admin can do that', date_trunc('day', now()) + time '07:44');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
  'Yeah I was looking at this, there are open source versions of if slack. Designed to be like it anyway. So we wouldnt really have to rebuild from the ground up. I''ve not properly tried it yet but I think if we can make the sign up easier and wrap it up in one process people would find it easier. Maybe we could add some sort of WhatsApp integration for people', date_trunc('day', now()) + time '07:48');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000007', 'c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  'yeah we can do both these things only thing i am thinking of is the back fill so people login and have all prior messages', date_trunc('day', now()) + time '07:55');

-- Nigel
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000011',
  'please can you tell me what is happening re set up. Have you selected a cleaning group to visit. I have found a local company who can quote this week if that helps.', date_trunc('day', now()) - interval '1 day' + time '16:12');
-- Bien
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000012', 'c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
  'Can you chase the Peterborough cleaner quotes today please', date_trunc('day', now()) - interval '1 day' + time '09:02');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000013', 'c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003',
  'Got it. Will do.', date_trunc('day', now()) - interval '1 day' + time '09:05');
-- Zac (self)
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000014', 'c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001',
  'Trade sourcing run — 14 Sep 2026 — Peterborough × Cleaner. 4 contacted, 2 replied, 1 site visit booked Thursday.', date_trunc('day', now()) - interval '1 day' + time '18:40');
-- Gareth
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000015', 'c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001',
  'Morning Gareth, are you free for a quick call this afternoon?', date_trunc('week', now()) + interval '3 days' + time '09:15');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000016', 'c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000013',
  'yes 4pm today would be great', date_trunc('week', now()) + interval '3 days' + time '09:31');
-- Joins (system messages)
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000017', 'c0000000-0000-4000-8000-000000000006', null,
  'Rohana Bakhshi has accepted your invitation to join Stayful – take a second to say hello.', date_trunc('week', now()) + interval '2 days' + time '14:10', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000012"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000018', 'c0000000-0000-4000-8000-000000000008', null,
  'Kabir Singh has accepted your invitation to join Stayful – take a second to say hello.', '2026-08-25 10:44+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000015"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000019', 'c0000000-0000-4000-8000-000000000010', null,
  'A S M Akter Uzzaman has accepted your invitation to join Stayful – take a second to say hello.', '2026-08-07 15:20+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000017"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000020', 'c0000000-0000-4000-8000-000000000011', null,
  'Ijaz Qazi has accepted your invitation to join Stayful – take a second to say hello.', '2026-08-03 13:12+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000018"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000012', null,
  'Vanessa Wilson-Wood has accepted your invitation to join Stayful – take a second to say hello.', '2026-07-24 09:48+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000019"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000015', null,
  'Nick Clarke has accepted your invitation to join Stayful – take a second to say hello.', '2026-07-08 16:01+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000020"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000016', null,
  'Harry Roberts has accepted your invitation to join Stayful – take a second to say hello.', '2026-07-07 10:15+01', 'system', '{"event":"member_joined","user_id":"b0000000-0000-4000-8000-000000000014"}');
-- Mylyn
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000024', 'c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000008',
  'Hi Zac, is the 9am still happening?', date_trunc('week', now()) + interval '1 day' + time '08:02');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000025', 'c0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000001',
  'It''s cancelled today no worries', date_trunc('week', now()) + interval '1 day' + time '08:05');
-- Trish
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000026', 'c0000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000004',
  'Hi Zac, sorry I missed the scheduled meeting. I honestly thought it was at 10:30am and I just checked the calendar now. I can join the next available slot if that works for you.', '2026-08-25 11:02+01');
-- Marie
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000027', 'c0000000-0000-4000-8000-000000000013', 'b0000000-0000-4000-8000-000000000007',
  'he says you sent him a presentation and he''s been trying to reach you', '2026-07-10 14:36+01');
-- Jason Dela Cruz (mention)
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000028', 'c0000000-0000-4000-8000-000000000014', 'b0000000-0000-4000-8000-000000000009',
  'Hi @Zac sorry to bother you, this client already fill out the lead form, he already called twice today and really wanted to speak to someone about the onboarding.', '2026-07-10 11:20+01', 'text', '{"mentions":["b0000000-0000-4000-8000-000000000001"]}');

-- #joseph-obianwu welcome
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000038', null,
E'Welcome to Stayful! This software is the main channel we use when with our clients. If you have any questions or concerns about your listing or Stayful then put them in this chat and we aim to get back to you in 24 hours with the exception of weekends & bank holidays.

If you have not already, we need you to complete the onboarding form before your property can go live. You can find it [here](https://www.stayful.co.uk/onboarding).

**Our Next steps**
- Book your kick off call [here](https://calendly.com/stayful/kick-off)
- Inspect your property and carry out a deep clean to ensure it is ready for guests. The cost of this will vary depending on what condition your property is in.
- Receive professional photos of the property (If you have arranged these through us then this is in hand.)
- Communicate with team members to ensure everyone is briefed and all records are up to date.
- Setup your listings on all the online platforms ([Booking.com](https://www.booking.com), Stayful & Airbnb.)
- Arrange our first web meeting.

**What we need from you**
- Onboarding details filled out.
- Confirmation that WiFi is installed at the property and working. Please put the WIFI Network name & password on the onboarding form.
- Bin collection days (if your property is a house you will need to set up commercial waste collection before we can go live.)
- Details of anything to do with parking at the property we need to be made aware of for example parking permits. This can be added to the onboarding form.
- Key safe location & code. You will need a main key and a spare kept in a separate safe location for the housekeepers.', '2026-09-02 09:00+01', 'system', '{"event":"welcome"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000038', 'b0000000-0000-4000-8000-000000000005',
  'Onboarding pack and photos folder: https://drive.google.com/drive/folders/1MaZ7dbxHDdPQ8HHS-7YllylE_s7dsEWa?usp=sharing and the signed agreement https://drive.google.com/file/d/15L228OO22KydWTvT9v-zylLuWQMlegzb/view', '2026-09-02 09:20+01');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000033', 'c0000000-0000-4000-8000-000000000038', 'b0000000-0000-4000-8000-000000000016',
  'Thanks, onboarding form is done. WiFi is live at the apartment and the key safe is fitted by the front door.', date_trunc('day', now()) - interval '1 day' + time '18:12');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000034', 'c0000000-0000-4000-8000-000000000038', 'b0000000-0000-4000-8000-000000000002',
  'Brilliant, thanks Joseph. Photos are booked for Thursday morning and the cleaner will do the first deep clean on Wednesday.', date_trunc('day', now()) + time '07:30');

-- Other channels
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000035', 'c0000000-0000-4000-8000-000000000021', null,
  'Booking confirmed: 3 nights from Fri 18 Sep via Airbnb. Check-in instructions sent to the guest.', date_trunc('day', now()) + time '06:50', 'system', '{"event":"booking_confirmed"}');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000036', 'c0000000-0000-4000-8000-000000000022', 'b0000000-0000-4000-8000-000000000011',
  'Also posting here so the team can see – any update on the cleaning group visit?', date_trunc('day', now()) - interval '1 day' + time '16:15');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000037', 'c0000000-0000-4000-8000-000000000023', 'b0000000-0000-4000-8000-000000000012',
  'Hello all, looking forward to getting started.', date_trunc('week', now()) + interval '2 days' + time '14:14');

-- RLS fixtures
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000041', 'c0000000-0000-4000-8000-000000000041', 'b0000000-0000-4000-8000-000000000091',
  'Hello from the team (public)', now() - interval '2 hours');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000042', 'c0000000-0000-4000-8000-000000000041', 'b0000000-0000-4000-8000-000000000091',
  'Internal note: owner is price sensitive', now() - interval '1 hour', 'text', '{}', 'internal');
select pg_temp.seed_msg('d0000000-0000-4000-8000-000000000043', 'c0000000-0000-4000-8000-000000000042', 'b0000000-0000-4000-8000-000000000091',
  'Team-only channel message', now() - interval '1 hour');

-- ---------------------------------------------------------------------------
-- Pins
-- ---------------------------------------------------------------------------
insert into public.pins (conversation_id, message_id, org_id, pinned_by, pinned_at) values
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', '2024-08-20 13:45+01'),
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '2024-07-05 11:14+01'),
  ('c0000000-0000-4000-8000-000000000038', 'd0000000-0000-4000-8000-000000000031', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', '2026-09-02 09:01+01')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Read state for Zac: everything read except the conversations the prototype
-- shows as unread (Rohana DM, Kabir DM, #1-lyndhurst, #nigel-hyde, #rohana-bakhshi, #joseph-obianwu).
-- ---------------------------------------------------------------------------
update public.conversation_members set last_read_at = now()
 where user_id = 'b0000000-0000-4000-8000-000000000001';
update public.conversation_members set last_read_at = '2026-06-01 00:00+01'
 where user_id = 'b0000000-0000-4000-8000-000000000001'
   and conversation_id in ('c0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000008',
                           'c0000000-0000-4000-8000-000000000021','c0000000-0000-4000-8000-000000000022',
                           'c0000000-0000-4000-8000-000000000023');
update public.conversation_members set last_read_at = date_trunc('day', now()) + time '06:00'
 where user_id = 'b0000000-0000-4000-8000-000000000001'
   and conversation_id = 'c0000000-0000-4000-8000-000000000038';
-- Everyone else has read everything up to now
update public.conversation_members set last_read_at = now()
 where user_id <> 'b0000000-0000-4000-8000-000000000001' and last_read_at is null;

drop function pg_temp.seed_user(uuid, text, jsonb, text);
drop function pg_temp.seed_conv(uuid, public.conversation_type, text, text, uuid[], boolean);
drop function pg_temp.seed_msg(uuid, uuid, uuid, text, timestamptz, public.message_kind, jsonb, public.message_visibility);

commit;
