#!/usr/bin/env bash
# Applies every migration in supabase/migrations, in order, to a throwaway PostgreSQL cluster.
#
# Why this exists: CI has no database, so a migration that does not parse — or a plpgsql body
# with a typo in it, or a reserved word used as a column name — is only discovered when someone
# runs `supabase db push` against a real project. This catches all three in a few seconds, with
# nothing but the postgresql-16 server package.
#
# It is a syntax and structure check, not a substitute for `supabase start && supabase db reset`:
# supabase/verify/supabase_stub.sql fakes auth, realtime and storage rather than running them.
#
# It then runs supabase/verify/checks/*.sql, which assert behaviour rather than syntax — the
# things worth proving about a plpgsql function that no amount of parsing shows. Last, it checks
# that src/lib/database.types.ts still describes the schema those migrations just built, which is
# the one place CI can ask that question without a secret or a network call.
#
# So this is no longer only a syntax check: `pnpm db:verify` is a compound gate, and a red run may
# be a migration that does not parse, an assertion that does not hold, or types that need
# regenerating.
#
#   ./scripts/verify-migrations.sh            # apply the chain, then run the checks
#   ./scripts/verify-migrations.sh --keep     # leave the cluster running to poke at it
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="${PGVERIFY_DIR:-/var/lib/postgresql/verify-migrations}"
PORT="${PGVERIFY_PORT:-5433}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

if [ ! -x "$PGBIN/initdb" ]; then
  echo "Need the PostgreSQL 16 server binaries (set PGBIN, or apt install postgresql-16)." >&2
  exit 1
fi

# initdb refuses to run as root, so the cluster is owned by the postgres system user.
AS_PG=""
[ "$(id -u)" = "0" ] && AS_PG="su postgres -c"

run_pg() { if [ -n "$AS_PG" ]; then su postgres -c "PATH=$PGBIN:\$PATH $*"; else PATH="$PGBIN:$PATH" bash -c "$*"; fi; }

cleanup() {
  [ "$KEEP" = "1" ] && { echo "Cluster left running on $DIR:$PORT"; return; }
  run_pg "pg_ctl -D $DIR/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

rm -rf "$DIR"; mkdir -p "$DIR"
[ -n "$AS_PG" ] && chown postgres:postgres "$DIR"
run_pg "initdb -D $DIR/data -U postgres --auth=trust" >/dev/null
run_pg "pg_ctl -D $DIR/data -o '-k $DIR -p $PORT -c listen_addresses=' -l $DIR/log start" >/dev/null
sleep 1

# -X because a developer with `\timing on` or a \pset in ~/.psqlrc would otherwise have its output
# interleaved with query results — which, for the JSON the types check reads, means a parse error
# reported as "the types are out of date". CI has no psqlrc, so that failure would only ever happen
# on someone's laptop, which makes it worse rather than better.
psql() { command psql -X -h "$DIR" -p "$PORT" -U postgres -d verify -v ON_ERROR_STOP=1 -q "$@"; }
command psql -h "$DIR" -p "$PORT" -U postgres -d postgres -q -c "create database verify;" >/dev/null

psql -f "$ROOT/supabase/verify/supabase_stub.sql" 2>&1 | grep -vE "WARNING|HINT|NOTICE" || true

failed=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if out=$(psql -f "$f" 2>&1); then
    echo "  ok  $name"
  else
    echo "FAILED  $name"
    echo "$out" | grep -v "^psql.*NOTICE" | head -15
    failed=1
    break
  fi
done

[ "$failed" = "0" ] && echo "All migrations applied."

# Behaviour checks, once the schema is up. The migration loop above proves a file parses; these
# prove a function does what its comment claims, against a real Postgres with no network and
# nothing to clean up afterwards. Each file raises an exception on a failed assertion, and
# ON_ERROR_STOP turns that into a non-zero exit.
if [ "$failed" = "0" ] && compgen -G "$ROOT/supabase/verify/checks/*.sql" > /dev/null; then
  for f in "$ROOT"/supabase/verify/checks/*.sql; do
    name="$(basename "$f")"
    if out=$(psql -f "$f" 2>&1); then
      echo "  ok  check $name"
    else
      echo "FAILED  check $name"
      echo "$out" | grep -v "^psql.*NOTICE" | head -20
      failed=1
      break
    fi
  done
  [ "$failed" = "0" ] && echo "All checks passed."
fi

# Finally: do the committed types still describe this schema? `pnpm db:types` is safe to run now,
# but nothing made anyone run it, and stale types fail nothing — tsc is perfectly happy with a table
# it has never heard of, because nothing references it. The cluster above is the only description of
# the schema CI can have without a secret or a network call, so the question gets answered here or
# not at all.
if [ "$failed" = "0" ]; then
  if [ ! -x "$ROOT/node_modules/.bin/tsx" ]; then
    # A check that quietly switches itself off is the same failure as types that quietly go stale,
    # so under CI this is an error. Locally it is a note: someone poking at migrations without an
    # installed tree still gets the migration and behaviour checks, which stand on their own.
    if [ -n "${CI:-}" ]; then
      echo "FAILED  the types check needs node_modules; run \`pnpm install\` before db:verify"
      failed=1
    else
      echo "  note  skipping the types check (no node_modules; run \`pnpm install\`)"
    fi
  elif ! out=$(psql -At -f "$ROOT/supabase/verify/schema-inventory.sql" 2>&1 >"$DIR/inventory.json"); then
    echo "FAILED  reading the schema inventory"
    echo "$out" | head -10
    failed=1
  elif ! out=$("$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/verify-types-fresh.ts" \
                 "$DIR/inventory.json" "$ROOT/src/lib/database.types.ts" 2>&1); then
    # Captured and printed in one go, like the phases above: verify-types-fresh.ts owns the whole
    # message, headline included, so the reader never gets detail before the thing it is detail of.
    echo "$out"
    failed=1
  else
    echo "$out"
  fi
fi

exit "$failed"
