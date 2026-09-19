#!/usr/bin/env bash
# Regenerates src/lib/database.types.ts from the hosted Supabase project.
#
# Why this exists: the script this replaced was a single shell redirect —
#   supabase gen types typescript --project-id … > src/lib/database.types.ts
# — which has two faults, and the second is worse than the first.
#
# The shell opens the redirect target before running the command, so the file is empty from the
# instant the script starts. The Supabase CLI is not a dependency of this repo, so on most machines
# "command not found" fires after the file has already been destroyed. That is not hypothetical; it
# happened during migration 0040 and the file had to be recovered from git.
#
# And the generator cannot derive everything. Postgres records no nullability for the columns of a
# RETURNS TABLE function, never marks an RPC argument nullable, and cannot see the trigger that
# fills conversation_members.member_side — so a plain regeneration silently discarded three dozen
# hand corrections, plus the type aliases the app imports everywhere. The list of those corrections
# that the old file's header pointed at did not exist. It does now, in
# scripts/types-corrections.ts, and this script applies it.
#
# Nothing is written to src/lib/database.types.ts until the corrected file has been formatted and
# has passed `tsc --noEmit`. Every failure before that point leaves the repository untouched.
#
#   ./scripts/gen-types.sh          # regenerate, correct, verify, replace
#   ./scripts/gen-types.sh --keep   # leave the working files behind to inspect
#
# Tunables:
#   SUPABASE_CLI=/path/to/supabase   use this binary instead of fetching one
#   SUPABASE_VERSION=2.117.0         the version `pnpm dlx` fetches when there is no binary
#   SUPABASE_PROJECT_ID=…            which project to read
#   GEN_TYPES_INPUT=/path/raw.ts     skip generation; correct and verify this file instead.
#                                    This is the way through when there is no CLI and no login —
#                                    generate with the Supabase MCP `generate_typescript_types`
#                                    and point this at the result.
#   GEN_TYPES_SKIP_TYPECHECK=1       skip the verification step (you had better have a reason)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPABASE_CLI="${SUPABASE_CLI:-}"
SUPABASE_VERSION="${SUPABASE_VERSION:-2.117.0}"
SUPABASE_PROJECT_ID="${SUPABASE_PROJECT_ID:-dqgdhmlgojhiidxlxzsr}"
GEN_TYPES_INPUT="${GEN_TYPES_INPUT:-}"
GEN_TYPES_SKIP_TYPECHECK="${GEN_TYPES_SKIP_TYPECHECK:-0}"
KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

TARGET="$ROOT/src/lib/database.types.ts"
BAK="$TARGET.bak"
WORK=""
SWAPPED=0

cleanup() {
  # Order matters: put the original back before removing anything.
  if [ "$SWAPPED" = "1" ]; then
    cp "$BAK" "$TARGET"
    rm -f "$BAK"
    echo "restored $TARGET" >&2
  fi
  if [ -n "$WORK" ]; then
    if [ "$KEEP" = "1" ]; then
      echo "working files left in $WORK" >&2
    else
      rm -rf "$WORK"
    fi
  fi
}
trap cleanup EXIT INT TERM

# A leftover backup means a previous run was killed between swapping the candidate in and
# verifying it — the one window where the target holds an unverified file. Refuse rather than
# overwrite it, because the backup is the only copy of what was there before.
if [ -e "$BAK" ]; then
  echo "FAILED  a previous run was interrupted while swapping the file." >&2
  echo "        \`mv $BAK $TARGET\` to undo it, or delete the backup to keep what is there now." >&2
  exit 1
fi

for bin in tsx prettier tsc; do
  if [ ! -x "$ROOT/node_modules/.bin/$bin" ]; then
    echo "Need $bin from node_modules (run \`pnpm install\`)." >&2
    exit 1
  fi
done

# Worth knowing before the file is replaced, but not worth refusing over: the corrections belong in
# scripts/types-corrections.ts now, so a local edit here is probably one someone is about to lose.
if ! git -C "$ROOT" diff --quiet -- "$TARGET" 2>/dev/null; then
  echo "  note  $TARGET has uncommitted changes; they will be replaced" >&2
fi

WORK="$(mktemp -d)"
RAW="$WORK/raw.ts"
CANDIDATE="$WORK/candidate.ts"

# ---- generate ------------------------------------------------------------------------------
# Into the temp directory, never the target. Everything up to the swap below can fail freely.
if [ -n "$GEN_TYPES_INPUT" ]; then
  cp "$GEN_TYPES_INPUT" "$RAW"
  echo "  ok  using $GEN_TYPES_INPUT (generation skipped)"
else
  if [ -n "$SUPABASE_CLI" ]; then
    GEN=("$SUPABASE_CLI")
    echo "  ok  supabase CLI: $SUPABASE_CLI"
  elif command -v supabase >/dev/null 2>&1; then
    GEN=(supabase)
    echo "  ok  supabase CLI: $(command -v supabase) (on PATH, version not pinned — output may differ)"
  else
    # Deliberately not a devDependency: the npm package is a shim that downloads a ~30MB platform
    # binary on install, which every CI `pnpm install` would pay for a script CI never runs.
    GEN=(pnpm dlx "supabase@$SUPABASE_VERSION")
    echo "  ok  supabase CLI: pnpm dlx supabase@$SUPABASE_VERSION"
  fi

  if ! "${GEN[@]}" gen types typescript --project-id "$SUPABASE_PROJECT_ID" >"$RAW" 2>"$WORK/gen.err"; then
    echo "FAILED  generating types" >&2
    head -20 "$WORK/gen.err" >&2
    echo "        Usually this is authentication: \`supabase login\`, or set SUPABASE_ACCESS_TOKEN." >&2
    echo "        With no CLI and no login, generate with the Supabase MCP and pass the file as" >&2
    echo "        GEN_TYPES_INPUT instead." >&2
    exit 1
  fi
fi

# A CLI that exits 0 having printed an error page would otherwise sail through the parser below
# and produce a plausible-looking file with most of the schema missing.
if [ "$(wc -c <"$RAW")" -lt 1024 ] || ! grep -q "export type Database" "$RAW"; then
  echo "FAILED  the generator's output does not look like a schema (no \`export type Database\`)." >&2
  head -10 "$RAW" >&2
  exit 1
fi
echo "  ok  generated $(wc -l <"$RAW" | tr -d ' ') lines"

# ---- correct and format --------------------------------------------------------------------
"$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/apply-types-corrections.ts" "$RAW" "$CANDIDATE"

# --config is not optional. Prettier searches upward from the file it is formatting, and the
# candidate lives in /tmp — without this it would quietly use the default printWidth of 80 instead
# of this repo's 120, and the file would land and fail `pnpm format:check` in CI.
"$ROOT/node_modules/.bin/prettier" --config "$ROOT/.prettierrc" --write "$CANDIDATE" >/dev/null
echo "  ok  prettier"

if cmp -s "$CANDIDATE" "$TARGET"; then
  echo "  ok  already up to date"
  echo "Types unchanged."
  exit 0
fi

# ---- verify, then keep -----------------------------------------------------------------------
if [ "$GEN_TYPES_SKIP_TYPECHECK" = "1" ]; then
  cp "$CANDIDATE" "$TARGET.new" && mv "$TARGET.new" "$TARGET"
  echo "  note  typecheck skipped"
  echo "Types regenerated."
  exit 0
fi

# Verified in place rather than through a tsconfig with a remapped path, so that what is checked is
# the exact configuration `pnpm typecheck` and CI use. A path remap would keep the target untouched,
# but it would stop covering any file that imported the types by a relative path — silently, and
# for as long as it took someone to notice. The interruption this opens is handled by the backup
# and the refusal at the top; silent drift could not be handled at all.
cp "$TARGET" "$BAK"
cp "$CANDIDATE" "$TARGET.new" && mv "$TARGET.new" "$TARGET"
SWAPPED=1

if "$ROOT/node_modules/.bin/tsc" -p "$ROOT/tsconfig.json" --noEmit >"$WORK/tsc.out" 2>&1; then
  SWAPPED=0
  rm -f "$BAK"
  echo "  ok  tsc --noEmit"
  echo "Types regenerated."
  exit 0
fi

# The candidate is worth keeping when it fails, and so is the reason: a break here is either the
# schema having moved under the app, or a tree that was already broken. Saying which is the
# difference between a useful script and a confusing one.
KEEP=1
echo "FAILED  the regenerated types do not typecheck" >&2
head -20 "$WORK/tsc.out" >&2

cp "$BAK" "$TARGET"
SWAPPED=0
rm -f "$BAK"
if "$ROOT/node_modules/.bin/tsc" -p "$ROOT/tsconfig.json" --noEmit >/dev/null 2>&1; then
  echo "        The tree typechecked before this, so the schema has moved under the app." >&2
  echo "        Fix the call sites above, or add a correction to scripts/types-corrections.ts." >&2
else
  echo "        The tree did not typecheck before this either — fix that first, then re-run." >&2
fi
echo "        The rejected file is in $WORK/candidate.ts." >&2
exit 1
