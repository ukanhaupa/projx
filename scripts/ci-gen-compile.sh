#!/usr/bin/env bash
# Scaffolds a backend, runs `gen entity` with a comprehensive mixed-type field
# set (every FieldType, required + optional), then COMPILES the generated code.
# Closes the gap where gen-entity tests only assert file contents and never
# build the output — which is how non-compiling gen'd code (ent SetNillable,
# rust Option<T>, sqlc null types, date/json) shipped undetected.
#
# Usage:
#   ci-gen-compile.sh <backend>     # one backend
#   ci-gen-compile.sh all           # every backend
#
# Backends: go-gorm go-sqlc go-ent rust node-prisma node-drizzle
#           node-sequelize node-typeorm fastapi laravel

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli/dist/index.js"
FIELDS="title:string,note?:text,amount:number,qty?:number,paid:boolean,active?:boolean,due:date,seen?:datetime,meta:json,extra?:json"

if [ ! -f "$CLI" ]; then
  echo "Building CLI..."
  pnpm --dir "$ROOT_DIR/cli" build >/dev/null
fi

scaffold() {
  local dir="$1"
  shift
  (cd "$dir" && node "$CLI" genapp --no-install --no-git --local "$ROOT_DIR" "$@" >/dev/null)
}

gen() {
  local dir="$1"
  shift
  (cd "$dir/genapp" && node "$CLI" gen entity invoice --fields "$FIELDS" --local "$ROOT_DIR" "$@" >/dev/null)
}

check_go() {
  local orm="$1" dir="$2"
  scaffold "$dir" --components go --orm "$orm"
  gen "$dir"
  cd "$dir/genapp/go" || return 1
  go mod download >/dev/null 2>&1
  if [ "$orm" = "ent" ]; then
    go generate ./ent/... >/dev/null 2>&1
  fi
  go mod tidy >/dev/null 2>&1
  go build ./... && go vet ./...
}

check_rust() {
  local dir="$1"
  scaffold "$dir" --components rust
  gen "$dir"
  cd "$dir/genapp/rust" || return 1
  cargo check --all-features
}

check_node() {
  local orm="$1" dir="$2"
  if [ "$orm" = "prisma" ]; then
    scaffold "$dir" --components fastify
  else
    scaffold "$dir" --components fastify --orm "$orm"
  fi
  gen "$dir"
  cd "$dir/genapp/fastify" || return 1
  pnpm install --ignore-scripts --prefer-offline --silent
  [ "$orm" = "prisma" ] && pnpm exec prisma generate >/dev/null
  pnpm exec tsc --noEmit
}

check_fastapi() {
  local dir="$1"
  scaffold "$dir" --components fastapi
  gen "$dir" --backend fastapi
  cd "$dir/genapp/fastapi" || return 1
  uv sync --group dev >/dev/null 2>&1
  uv run mypy
}

check_laravel() {
  local dir="$1"
  scaffold "$dir" --components laravel
  gen "$dir"
  cd "$dir/genapp/laravel" || return 1
  composer install --no-interaction --quiet >/dev/null 2>&1
  ./vendor/bin/phpstan analyse --level=8 --memory-limit=512M
}

run_backend() {
  local backend="$1" dir rc=0
  dir="$(mktemp -d -t "projx-gencompile-${backend}-XXXXXX")"
  echo "→ gen-compile: $backend"
  case "$backend" in
    go-gorm) check_go gorm "$dir" || rc=$? ;;
    go-sqlc) check_go sqlc "$dir" || rc=$? ;;
    go-ent) check_go ent "$dir" || rc=$? ;;
    rust) check_rust "$dir" || rc=$? ;;
    node-prisma) check_node prisma "$dir" || rc=$? ;;
    node-drizzle) check_node drizzle "$dir" || rc=$? ;;
    node-sequelize) check_node sequelize "$dir" || rc=$? ;;
    node-typeorm) check_node typeorm "$dir" || rc=$? ;;
    fastapi) check_fastapi "$dir" || rc=$? ;;
    laravel) check_laravel "$dir" || rc=$? ;;
    *)
      echo "unknown backend: $backend"
      rc=2
      ;;
  esac
  cd "$ROOT_DIR" 2>/dev/null || true
  rm -rf "$dir"
  if [ "$rc" -eq 0 ]; then
    echo "✓ $backend"
  else
    echo "✗ $backend (exit $rc)"
  fi
  return "$rc"
}

ALL_BACKENDS=(
  go-gorm go-sqlc go-ent rust
  node-prisma node-drizzle node-sequelize node-typeorm
  fastapi laravel
)

if [ $# -eq 0 ] || [ "$1" = "all" ]; then
  failed=()
  for b in "${ALL_BACKENDS[@]}"; do
    run_backend "$b" || failed+=("$b")
  done
  if [ ${#failed[@]} -gt 0 ]; then
    echo "FAILED: ${failed[*]}"
    exit 1
  fi
  echo "all backends gen-compile clean"
else
  run_backend "$1"
fi
