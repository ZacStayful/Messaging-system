-- What the migrations actually built, as JSON, for comparison against src/lib/database.types.ts.
--
-- Read by scripts/verify-types-fresh.ts at the end of scripts/verify-migrations.sh, against the
-- throwaway cluster the migrations were just applied to. That cluster is the only description of
-- the schema CI can have without a secret or a network call, which is what makes the check
-- possible at all.
--
-- Every predicate below mirrors one in the Supabase type generator (@supabase/postgres-meta's
-- tables.sql / columns.sql / functions.sql), and is commented with what it mirrors. That matters
-- because the generator is a moving target: when CI goes red on a schema nobody touched, the next
-- person needs to know where to look.
--
-- Deliberately narrow: names, nullability and foreign keys, and nothing about how a Postgres type
-- maps to a TypeScript one. That mapping is a large table inside the generator, and a second copy
-- of it here would drift — showing up as a failing build on a correct change, which is the fastest
-- way to get a check ignored.
select json_build_object(
  -- relkind 'r','p' is postgres-meta's tables.sql; 'v','m' its views/materialized views. Nullability
  -- is its columns.sql expression verbatim. pg_attribute rather than information_schema.columns
  -- because the latter is privilege-filtered — it would quietly tie correctness to connecting as
  -- superuser.
  --
  -- Each column carries two facts: `n`, whether it is nullable, which the Row section must match;
  -- and `i`, what the Insert section must say about it. The `i` rule was derived from the
  -- generator's output and then checked against all 337 columns of the committed types — 113
  -- predicted required against 112 actual, the single difference being
  -- conversation_members.member_side, which is a hand correction. Update is simpler: the generator
  -- makes every column optional there, so only the `never` part of `i` applies.
  'tables', coalesce((select json_object_agg(t.name, t.columns) from (
      select c.relname as name,
             json_object_agg(a.attname, json_build_object(
               'n', not (a.attnotnull or (ty.typtype = 'd' and ty.typnotnull)),
               -- GENERATED ALWAYS AS IDENTITY cannot be written at all, so the generator types the
               -- field `never` rather than merely making it optional.
               'i', case when a.attidentity = 'a' then 'never'
                         when a.atthasdef or not a.attnotnull
                              or a.attidentity <> '' or a.attgenerated <> '' then 'optional'
                         else 'required' end)) as columns
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type ty on ty.oid = a.atttypid
      where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      group by c.relname) t), '{}'::json),

  -- Views keep the plain boolean: the generator emits only a Row for a view, with no Insert or
  -- Update to compare against.
  'views', coalesce((select json_object_agg(v.name, v.columns) from (
      select c.relname as name,
             json_object_agg(a.attname, not (a.attnotnull or (ty.typtype = 'd' and ty.typnotnull))) as columns
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type ty on ty.oid = a.atttypid
      where n.nspname = 'public' and c.relkind in ('v', 'm') and a.attnum > 0 and not a.attisdropped
      group by c.relname) v), '{}'::json),

  -- Foreign keys, to compare against the Relationships arrays. Six tables carried `Relationships: []`
  -- for eight migrations because their entries were typed in by hand; that is half the reason this
  -- check exists, so it would be odd not to look.
  'foreign_keys', coalesce((select json_agg(fk order by fk->>'name') from (
      select json_build_object(
               'name', con.conname,
               'table', cl.relname,
               'columns', (select json_agg(att.attname order by k.ord)
                             from unnest(con.conkey) with ordinality as k(attnum, ord)
                             join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum),
               'referenced_table', ref.relname) as fk
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_namespace refn on refn.oid = ref.relnamespace
      -- Both ends in `public`: the generator only relates tables inside the schema it emits, so it
      -- writes no Relationship for profiles.id -> auth.users.id (the one cross-schema key here).
      where n.nspname = 'public' and refn.nspname = 'public' and con.contype = 'f') x), '[]'::json),

  -- postgres-meta's functions.sql filters on prokind = 'f'; without it an aggregate or a window
  -- function in public is a false positive. Trigger and event-trigger functions are excluded by
  -- regtype rather than by comparing the printed result type, which returns NULL for procedures and
  -- would drop them for the wrong reason.
  --
  -- The extension filter is not in postgres-meta — it has none, because hosted Supabase keeps
  -- extensions out of public. It is here because 0001_schema.sql's `create extension pgcrypto` is
  -- unqualified, and is a no-op today only because supabase_stub.sql installs it into `extensions`
  -- first. Reorder those two and ~35 pgcrypto functions land in public. classid is anchored because
  -- OIDs are unique per catalog, not globally. checks/no_extensions_in_public.sql asserts the
  -- assumption this encodes.
  --
  -- Not reproduced: the generator also drops a function with an unnamed argument that has no
  -- default. Nothing here trips it — every function in this schema has named parameters — but a
  -- migration adding `create function f(int)` would be a false positive.
  'functions', coalesce((select json_agg(distinct p.proname order by p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and p.prorettype not in ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
        and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass
                          and d.objid = p.oid
                          and d.refclassid = 'pg_extension'::regclass
                          and d.deptype = 'e')), '[]'::json),

  'enums', coalesce((select json_object_agg(e.typname, e.values) from (
      select t.typname, json_agg(en.enumlabel order by en.enumsortorder) as values
      from pg_type t
      join pg_enum en on en.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      group by t.typname) e), '{}'::json)
);
