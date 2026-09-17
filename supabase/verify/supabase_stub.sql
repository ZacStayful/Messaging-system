-- supabase_stub.sql
-- The smallest stand-in for a Supabase project that lets the migrations in ../migrations run
-- against a plain PostgreSQL cluster.
--
-- This is NOT a Supabase emulator and is not used at runtime. It exists so the migration chain
-- can be applied and the RPCs exercised without Docker, which CI does not have — see
-- ../../scripts/verify-migrations.sh. The real thing is `supabase start && supabase db reset`.
--
-- Everything here is a stub with the right shape and no behaviour: auth.uid() reads a GUC rather
-- than a JWT, realtime.broadcast_changes does nothing, storage holds no files. That is enough to
-- prove the SQL parses, the function bodies compile, the constraints hold and the triggers fire.

-- Minimal stand-in for the parts of a Supabase project the migrations lean on.
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists realtime;
create schema if not exists storage;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm;

do $r$ begin create role anon; exception when duplicate_object then null; end $r$;
do $r$ begin create role authenticated; exception when duplicate_object then null; end $r$;
do $r$ begin create role service_role; exception when duplicate_object then null; end $r$;
do $r$ begin create role supabase_auth_admin; exception when duplicate_object then null; end $r$;
do $r$ begin create role authenticator; exception when duplicate_object then null; end $r$;
do $r$ begin create role supabase_realtime_admin; exception when duplicate_object then null; end $r$;
do $r$ begin create role supabase_storage_admin; exception when duplicate_object then null; end $r$;

create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz,
  confirmation_token text, recovery_token text, email_change_token_new text,
  email_change text, is_sso_user boolean default false
);
create table auth.identities (
  id uuid primary key, user_id uuid references auth.users(id) on delete cascade,
  provider_id text, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
);

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz default now()
);
alter table storage.objects enable row level security;

create table realtime.messages (
  topic text, extension text, payload jsonb, event text, private boolean,
  inserted_at timestamptz default now(), id uuid default gen_random_uuid()
);
alter table realtime.messages enable row level security;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void language sql as $$ select null::void $$;

-- publication the realtime migration adds tables to
create publication supabase_realtime;
create or replace function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
create or replace function realtime.broadcast_changes(
  topic_name text, event_name text, operation text, table_name text, table_schema text,
  new_record record, old_record record, level text default 'ROW')
returns void language plpgsql as $$ begin return; end $$;
