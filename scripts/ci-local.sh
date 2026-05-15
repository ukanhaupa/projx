#!/usr/bin/env bash
# scripts/ci-local.sh — run every CI gate locally, in parallel.
#
# Usage:
#   ./scripts/ci-local.sh                       # every available section
#   ./scripts/ci-local.sh changed               # only sections touched vs origin/main + working tree
#   ./scripts/ci-local.sh fastify e2e           # run named sections only
#
# Sections (auto-detected by which top-level dirs exist):
#   fastapi  fastify  express  frontend  e2e  infra

set -uo pipefail

unset VSCODE_INSPECTOR_OPTIONS NODE_OPTIONS

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT_DIR
cd "$ROOT_DIR" || exit 1

LOGS_DIR="${LOGS_DIR:-${TMPDIR:-/tmp}/projx-ci-local.$$}"
mkdir -p "$LOGS_DIR"

BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

log() { printf '%s[ci-local]%s %s\n' "$BOLD" "$RESET" "$*"; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
xfail() { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }

PIDS=()
LAST_PID=""

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    [[ -z "$pid" ]] && continue
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    pkill -TERM -P "$pid" 2>/dev/null || true
  done
  pkill -f "tsx.*src/server\\.ts" 2>/dev/null || true
  rm -rf "$LOGS_DIR"
}

trap cleanup EXIT INT TERM

run_step() {
  local label="$1"
  shift
  printf '\n==> %s\n' "$label"
  "$@"
}

start_background() {
  local label="$1"
  shift
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" >"$LOGS_DIR/$label.log" 2>&1 &
  else
    "$@" >"$LOGS_DIR/$label.log" 2>&1 &
  fi
  LAST_PID="$!"
  PIDS+=("$LAST_PID")
}

detect_pm() {
  if [ -f bun.lockb ]; then
    printf 'bun'
  elif [ -f pnpm-lock.yaml ]; then
    printf 'pnpm'
  elif [ -f yarn.lock ]; then
    printf 'yarn'
  else
    printf 'npm'
  fi
}

pm_install() {
  case "$(detect_pm)" in
    bun) bun install --frozen-lockfile ;;
    pnpm) pnpm install --frozen-lockfile ;;
    yarn) yarn --frozen-lockfile ;;
    npm) npm ci ;;
  esac
}

pm_exec() {
  case "$(detect_pm)" in
    bun) bunx "$@" ;;
    pnpm) pnpm exec "$@" ;;
    yarn) yarn "$@" ;;
    npm) npx "$@" ;;
  esac
}

pm_run() {
  case "$(detect_pm)" in
    bun) bun run "$@" ;;
    pnpm) pnpm "$@" ;;
    yarn) yarn "$@" ;;
    npm) npm run "$@" ;;
  esac
}

pm_audit() {
  case "$(detect_pm)" in
    bun) bun audit --prod 2>/dev/null || warn "bun audit unsupported in this version" ;;
    pnpm) pnpm audit --prod ;;
    yarn) yarn audit --groups dependencies ;;
    npm) npm audit --omit=dev ;;
  esac
}

run_js_component() {
  local dir="$1"
  [ -d "$ROOT_DIR/$dir" ] || return 0
  (
    cd "$ROOT_DIR/$dir" || exit 1
    run_step "$dir install" pm_install
    if [ -f prisma/schema.prisma ]; then
      run_step "$dir prisma generate" pm_exec prisma generate
    fi
    if [ -f drizzle.config.ts ] && [ -n "${DATABASE_URL:-}" ]; then
      run_step "$dir drizzle push" pm_exec drizzle-kit push --force
    fi
    run_step "$dir format" pm_exec prettier --check .
    run_step "$dir lint" pm_exec eslint .
    run_step "$dir typecheck" pm_exec tsc --noEmit
    if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null; then
      run_step "$dir build" pm_run build
    fi
    if [ -d tests ]; then
      run_step "$dir tests" pm_exec vitest run --coverage.enabled=false
    fi
    run_step "$dir audit" pm_audit
  )
}

sec_fastapi() {
  cd "$ROOT_DIR/fastapi" || exit 1
  run_step "fastapi install" uv sync --group dev
  run_step "fastapi format" uv run ruff format --check src tests
  run_step "fastapi lint" uv run ruff check src tests
  run_step "fastapi typecheck" uv run mypy
  if [ -d tests ]; then
    run_step "fastapi tests" uv run pytest
  fi
  run_step "fastapi audit" uv run pip-audit
}

sec_fastify() { run_js_component fastify; }
sec_express() { run_js_component express; }
sec_frontend() { run_js_component frontend; }
sec_e2e() { run_js_component e2e; }

sec_infra() {
  cd "$ROOT_DIR/infra/stack" || exit 1
  run_step "terraform fmt" terraform fmt -check -recursive
  run_step "terraform init" terraform init -backend=false -reconfigure
  run_step "terraform validate" terraform validate
}

available_sections() {
  local -a found=()
  [ -d "$ROOT_DIR/fastapi" ] && found+=("fastapi")
  [ -d "$ROOT_DIR/fastify" ] && found+=("fastify")
  [ -d "$ROOT_DIR/express" ] && found+=("express")
  [ -d "$ROOT_DIR/frontend" ] && found+=("frontend")
  [ -d "$ROOT_DIR/e2e" ] && found+=("e2e")
  [ -d "$ROOT_DIR/infra/stack" ] && found+=("infra")
  printf '%s\n' "${found[@]}"
}

changed_files() {
  {
    git diff --name-only origin/main...HEAD 2>/dev/null || true
    git diff --name-only HEAD 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u
}

has_changes_in() { changed_files | grep -qE "^$1"; }

declare -a SECTIONS
declare -a AVAILABLE=()
while IFS= read -r line; do
  [[ -n "$line" ]] && AVAILABLE+=("$line")
done < <(available_sections)

if [[ $# -eq 0 || "${1:-}" == "all" ]]; then
  SECTIONS=("${AVAILABLE[@]}")
elif [[ "${1:-}" == "changed" ]]; then
  SECTIONS=()
  for s in "${AVAILABLE[@]}"; do
    case "$s" in
      infra) has_changes_in "infra/" && SECTIONS+=("$s") ;;
      *) has_changes_in "$s/" && SECTIONS+=("$s") ;;
    esac
  done
else
  SECTIONS=("$@")
fi

if [[ ${#SECTIONS[@]} -eq 0 ]]; then
  log "nothing to run (no matching sections)"
  exit 0
fi

log "plan: ${SECTIONS[*]}"
log "logs: $LOGS_DIR"

OVERALL_START=$(date +%s)
declare -a NAMES=()

for s in "${SECTIONS[@]}"; do
  fn="sec_$s"
  if ! declare -F "$fn" >/dev/null; then
    xfail "unknown section: $s (valid: ${AVAILABLE[*]})"
    exit 2
  fi
  start_background "$s" bash -c "set -e; $(declare -f "$fn" run_step run_js_component pm_install pm_exec pm_run pm_audit detect_pm); $fn"
  NAMES+=("$s")
  printf '  %s↳%s %s started (pid %s) → %s/%s.log\n' "$DIM" "$RESET" "$s" "$LAST_PID" "$LOGS_DIR" "$s"
done

ANY_FAIL=0
REMAINING=${#PIDS[@]}

while ((REMAINING > 0)); do
  for i in "${!PIDS[@]}"; do
    pid="${PIDS[$i]}"
    [[ -z "$pid" ]] && continue
    if ! kill -0 "$pid" 2>/dev/null; then
      if wait "$pid"; then
        ok "${NAMES[$i]} passed"
      else
        xfail "${NAMES[$i]} FAILED → tail of $LOGS_DIR/${NAMES[$i]}.log:"
        tail -25 "$LOGS_DIR/${NAMES[$i]}.log" | sed 's/^/    /' >&2
        ANY_FAIL=1
      fi
      PIDS[i]=""
      REMAINING=$((REMAINING - 1))
    fi
  done
  sleep 1
done

TOTAL=$(($(date +%s) - OVERALL_START))
if ((ANY_FAIL == 0)); then
  printf '\n%sall gates passed in %ds%s — safe to push\n' "$GREEN" "$TOTAL" "$RESET"
else
  printf '\n%sone or more gates failed (%ds total)%s — logs in %s\n' "$RED" "$TOTAL" "$RESET" "$LOGS_DIR"
  trap - EXIT
  exit 1
fi
