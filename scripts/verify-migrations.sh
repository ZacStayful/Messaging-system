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
#   ./scripts/verify-migrations.sh            # apply the chain
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

psql() { command psql -h "$DIR" -p "$PORT" -U postgres -d verify -v ON_ERROR_STOP=1 -q "$@"; }
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
exit "$failed"
