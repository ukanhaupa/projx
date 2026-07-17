#!/usr/bin/env bash
# scripts/projx-dirs.test.sh — unit tests for the component-directory resolver.
#
# Usage:
#   bash scripts/projx-dirs.test.sh
#
# Exit 0 on pass, non-zero on first failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/projx-dirs.sh disable=SC1091
. "$SCRIPT_DIR/projx-dirs.sh"

pass=0
fail=0

expect_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ✓ %s\n' "$label"
    pass=$((pass + 1))
  else
    printf '  ✗ %s — expected [%s], got [%s]\n' "$label" "$expected" "$actual" >&2
    fail=$((fail + 1))
  fi
}

FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT
export ROOT_DIR="$FIXTURE"

mkdir -p "$FIXTURE"/{backend,api,web,svc,fastapi,docs,deploy}
printf '{"component":"fastify","skip":[],"orm":"prisma"}' >"$FIXTURE/backend/.projx-component"
printf '{"component":"fastify","skip":[]}' >"$FIXTURE/api/.projx-component"
printf '{"component":"vitejs"}' >"$FIXTURE/web/.projx-component"
printf 'laravel' >"$FIXTURE/svc/.projx-component"
printf '{"component":"infra"}' >"$FIXTURE/deploy/.projx-component"

csv() { tr '\n' ',' ; }

expect_eq "JSON marker + multi-instance resolves both, sorted" \
  "api,backend," "$(projx_dirs_of_type fastify | csv)"
expect_eq "first-of-type returns the sorted head" \
  "api" "$(projx_first_dir_of_type fastify)"
expect_eq "JSON marker resolves a renamed frontend" \
  "web," "$(projx_dirs_of_type vitejs | csv)"
expect_eq "legacy plain-text marker resolves" \
  "svc," "$(projx_dirs_of_type laravel | csv)"
expect_eq "conventional fallback resolves an unmarked component dir" \
  "fastapi," "$(projx_dirs_of_type fastapi | csv)"
expect_eq "infra marker resolves a renamed dir" \
  "deploy," "$(projx_dirs_of_type infra | csv)"
expect_eq "a non-component dir resolves to nothing" \
  "" "$(projx_dirs_of_type docs | csv)"

projx_has_type fastify && rc=0 || rc=1
expect_eq "has-type true for a present type" "0" "$rc"
projx_has_type express && rc=0 || rc=1
expect_eq "has-type false for an absent type" "1" "$rc"

expect_eq "primary backend honours fastapi-first priority" \
  "fastapi" "$(projx_primary_backend_kind)"
expect_eq "primary frontend resolves the renamed vitejs dir" \
  "web" "$(projx_primary_frontend_dir)"

serialized_conventional="$(bash -c "$(declare -f); projx_first_dir_of_type fastapi" 2>/dev/null)"
expect_eq "conventional resolution survives a declare -f-only subshell (ci-local run_wave path)" \
  "fastapi" "$serialized_conventional"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
