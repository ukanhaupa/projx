#!/usr/bin/env bash
# Scaffolds a project for one (framework, orm) combo and runs gates inside.
# Catches breakage in addons/orms/ overlays and features/auth/ ports together —
# the same overlay surface that users hit at scaffold time.
#
# Usage:
#   ci-scaffold-matrix.sh <framework> <orm>           # one combo
#   ci-scaffold-matrix.sh all                         # iterate every covered combo
#
# Frameworks: fastify | express | fastapi
# ORMs:       prisma | drizzle | sequelize | typeorm | none  (none = fastapi)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli/dist/index.js"

if [ ! -f "$CLI" ]; then
  echo "Building CLI..."
  pnpm --dir "$ROOT_DIR/cli" build >/dev/null
fi

run_combo() {
  local framework="$1"
  local orm="$2"
  local label="$framework${orm:+/$orm}"
  local workdir
  workdir="$(mktemp -d -t "projx-matrix-${framework}-${orm}-XXXXXX")"
  local rc=0

  _check_combo "$framework" "$orm" "$workdir" "$label" || rc=$?
  cd "$ROOT_DIR" 2>/dev/null || true
  rm -rf "$workdir"
  return "$rc"
}

_check_combo() {
  local framework="$1" orm="$2" workdir="$3" label="$4"
  local args=(
    "$workdir/app"
    --components "$framework"
    --no-install
    --no-git
    --local "$ROOT_DIR"
    "--auth=$framework"
  )
  if [ -n "$orm" ] && [ "$orm" != "none" ]; then
    args+=(--orm "$orm")
  fi

  echo "→ scaffold: $label"
  node "$CLI" "${args[@]}" >/dev/null

  if [ "$framework" = "fastapi" ]; then
    cd "$workdir/app/fastapi"
    local ruff="$ROOT_DIR/fastapi/.venv/bin/ruff"
    if [ ! -x "$ruff" ]; then
      echo "  ! fastapi venv missing — run \`cd fastapi && uv sync --group dev\` first"
      return 1
    fi
    echo "  - ruff format --check"
    "$ruff" format --check src tests >/dev/null
    echo "  - ruff check"
    "$ruff" check src tests >/dev/null
  else
    cd "$workdir/app/$framework"
    echo "  - pnpm install"
    pnpm install --ignore-scripts --prefer-offline --silent
    if [ "$orm" = "prisma" ] || [ -z "$orm" ]; then
      echo "  - prisma generate"
      pnpm exec prisma generate >/dev/null
    fi
    echo "  - tsc --noEmit"
    pnpm exec tsc --noEmit
    echo "  - eslint"
    pnpm exec eslint src/ tests/ >/dev/null
  fi
  echo "✓ $label"
}

if [ $# -eq 0 ] || [ "$1" = "all" ]; then
  combos=(
    "fastify drizzle"
    "fastify sequelize"
    "fastify typeorm"
    "express drizzle"
    "express sequelize"
    "express typeorm"
    "fastapi none"
  )
  failed=()
  for c in "${combos[@]}"; do
    read -r f o <<<"$c"
    if ! run_combo "$f" "$o"; then
      failed+=("$f/$o")
    fi
  done
  if [ ${#failed[@]} -gt 0 ]; then
    echo "FAILED: ${failed[*]}"
    exit 1
  fi
  echo "all combos passed"
else
  framework="$1"
  orm="${2:-}"
  run_combo "$framework" "$orm"
fi
