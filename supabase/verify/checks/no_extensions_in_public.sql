-- No extension may live in the `public` schema.
--
-- schema-inventory.sql filters extension-owned functions out of `public` before comparing them
-- against the generated types, because the throwaway cluster would otherwise report pgcrypto's and
-- pg_trgm's functions as missing from the types. That filter is only *correct* while no extension
-- is in `public` on the hosted project either — the Supabase generator has no extension filter at
-- all, so anything it did find there it would emit, and our filter would hide it. A false negative
-- in the direction nobody would think to look.
--
-- So the assumption gets asserted rather than left implicit. It also catches the more ordinary
-- mistake: `create extension foo;` without `with schema extensions`, which is what
-- 0001_schema.sql does for pgcrypto and what supabase_stub.sql used to do for pg_trgm.
do $check$
declare
  v_names text;
begin
  select string_agg(e.extname, ', ' order by e.extname) into v_names
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where n.nspname = 'public';

  if v_names is not null then
    raise exception
      'extension(s) installed in public: %. Add `with schema extensions`, or the types check will hide their functions',
      v_names;
  end if;
end $check$;
