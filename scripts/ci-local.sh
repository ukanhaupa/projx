#!/usr/bin/env bash
# scripts/ci-local.sh — run every CI gate locally, in parallel.
#
# Usage:
#   ./scripts/ci-local.sh                       # every available section
#   ./scripts/ci-local.sh changed               # only sections touched vs origin/main + working tree
#   ./scripts/ci-local.sh fastify e2e           # run named sections only
#
# Sections (auto-detected by which top-level dirs exist):
#   secrets  cli  fastapi  fastify  express  frontend  e2e  infra  scaffold_matrix
#
# Environment knobs:
#   E2E_REAL_BACKEND=1          boot fastify/express + run Playwright in sec_e2e
#                               (default: typecheck only)
#   E2E_BACKEND_PORT=auto       port the booted backend listens on (default: random free port)
#   E2E_HEALTH_PATH=/api/health endpoint used for readiness polling
#   LOGS_DIR=/tmp/foo           override per-section log directory

set -uo pipefail

unset VSCODE_INSPECTOR_OPTIONS NODE_OPTIONS

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT_DIR
cd "$ROOT_DIR" || exit 1

LOGS_DIR="${LOGS_DIR:-${TMPDIR:-/tmp}/projx-ci-local.$$}"
mkdir -p "$LOGS_DIR"
export LOGS_DIR

pick_free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'
}
E2E_BACKEND_PORT="${E2E_BACKEND_PORT:-$(pick_free_port)}"
export E2E_BACKEND_PORT

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
    run_step "$dir format" pm_exec prettier --write .
    run_step "$dir lint" pm_exec eslint .
    run_step "$dir typecheck" pm_exec tsc --noEmit
    if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null; then
      run_step "$dir build" pm_run build
    fi
    if [ -d tests ]; then
      run_step "$dir tests" pm_exec vitest run --coverage
    fi
    run_step "$dir audit" pm_audit
  )
}

sec_secrets() {
  cd "$ROOT_DIR" || exit 1
  if ! command -v gitleaks >/dev/null 2>&1; then
    warn "gitleaks not installed — skipping secret scan (install via 'brew install gitleaks' or download a release)"
    return 0
  fi
  local cfg="$ROOT_DIR/.gitleaks.toml"
  local args=(detect --no-banner --no-git --redact)
  [ -f "$cfg" ] && args+=(--config "$cfg")
  run_step "gitleaks (tracked + untracked)" gitleaks "${args[@]}" --source "$ROOT_DIR"
}

sec_fastapi() {
  cd "$ROOT_DIR/fastapi" || exit 1
  run_step "fastapi install" uv sync --group dev
  run_step "fastapi format" uv run ruff format src tests
  run_step "fastapi lint" uv run ruff check src tests
  run_step "fastapi typecheck" uv run mypy
  if [ -d tests ]; then
    run_step "fastapi tests" uv run pytest
  fi
  run_step "fastapi audit" bash audit.sh
}

sec_cli() {
  cd "$ROOT_DIR/cli" || exit 1
  run_step "cli install" pm_install
  run_step "cli format" pm_exec prettier --write .
  run_step "cli lint" pm_exec eslint 'src/**/*.ts' 'tests/**/*.ts'
  run_step "cli typecheck" pm_exec tsc --noEmit
  run_step "cli build" pm_run build
  run_step "cli tests" pm_exec vitest run --coverage
  run_step "cli audit" pm_audit
}

sec_fastify() { run_js_component fastify; }
sec_express() { run_js_component express; }

go_format_check() {
  local out
  out="$(gofmt -l .)"
  if [ -n "$out" ]; then
    echo "gofmt found unformatted files:" >&2
    echo "$out" >&2
    return 1
  fi
}

sec_go() {
  [ -d "$ROOT_DIR/go" ] || return 0
  cd "$ROOT_DIR/go" || exit 1
  run_step "go install" go mod download
  run_step "go format" go_format_check
  run_step "go vet" go vet ./...
  run_step "go build" go build ./...
  if command -v golangci-lint >/dev/null 2>&1; then
    run_step "go lint" golangci-lint run ./...
  else
    warn "golangci-lint not installed — skipping (install: brew install golangci-lint)"
  fi
  run_step "go test" go test -race -coverprofile=coverage.out -short ./...
  run_step "go coverage" bash scripts/check-coverage.sh
}

sec_frontend() {
  run_js_component frontend
  if [ -d "$ROOT_DIR/frontend/dist/assets" ] && [ -x "$ROOT_DIR/scripts/check-bundle-size.sh" ]; then
    (cd "$ROOT_DIR/frontend" && run_step "frontend bundle-size" bash "$ROOT_DIR/scripts/check-bundle-size.sh")
  fi
}

sec_e2e() {
  if [ ! -d "$ROOT_DIR/e2e" ]; then return 0; fi
  local backend_dir=""
  for candidate in fastify express; do
    [ -d "$ROOT_DIR/$candidate" ] && backend_dir="$candidate" && break
  done

  if [ -z "$backend_dir" ] || [ -z "${E2E_REAL_BACKEND:-}" ]; then
    run_js_component e2e
    return $?
  fi

  (cd "$ROOT_DIR/$backend_dir" && pm_install) || return 1
  if [ -f "$ROOT_DIR/$backend_dir/prisma/schema.prisma" ]; then
    (cd "$ROOT_DIR/$backend_dir" && pm_exec prisma generate) || return 1
  fi

  cd "$ROOT_DIR/$backend_dir" || return 1
  start_background "e2e-backend" bash -c \
    "$(declare -f pm_exec detect_pm); PORT=$E2E_BACKEND_PORT pm_exec tsx src/server.ts"
  local backend_pid="$LAST_PID"
  cd "$ROOT_DIR" || return 1

  local port="$E2E_BACKEND_PORT"
  local health_path="${E2E_HEALTH_PATH:-/api/health}"
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl missing — skipping backend healthcheck"
  else
    local tries=30
    until curl -fsS "http://127.0.0.1:$port$health_path" >/dev/null 2>&1; do
      tries=$((tries - 1))
      if [ "$tries" -le 0 ]; then
        xfail "e2e backend never became healthy on :$port$health_path"
        kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
        return 1
      fi
      sleep 1
    done
  fi

  local rc=0
  (
    cd "$ROOT_DIR/e2e" || exit 1
    run_step "e2e install" pm_install
    run_step "e2e playwright install" pm_exec playwright install --with-deps chromium
    run_step "e2e format" pm_exec prettier --write .
    run_step "e2e lint" pm_exec eslint '**/*.ts'
    run_step "e2e typecheck" pm_exec tsc --noEmit
    run_step "e2e playwright" pm_exec playwright test
  ) || rc=$?

  kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
  sleep 1
  kill -9 -- "-$backend_pid" 2>/dev/null || kill -9 "$backend_pid" 2>/dev/null || true
  return "$rc"
}

sec_infra() {
  cd "$ROOT_DIR/infra/stack" || exit 1
  run_step "terraform fmt" terraform fmt -check -recursive
  run_step "terraform init" terraform init -backend=false -reconfigure
  run_step "terraform validate" terraform validate
}

sec_scaffold_matrix() {
  cd "$ROOT_DIR/cli" || exit 1
  run_step "cli build for matrix" pm_run build
  cd "$ROOT_DIR" || exit 1
  run_step "scaffold-matrix" "$ROOT_DIR/scripts/ci-scaffold-matrix.sh" all
}

sec_scripts() {
  cd "$ROOT_DIR" || exit 1
  shopt -s nullglob
  local tests=("$ROOT_DIR"/scripts/*.test.sh)
  shopt -u nullglob
  if [ ${#tests[@]} -eq 0 ]; then
    return 0
  fi
  for t in "${tests[@]}"; do
    run_step "$(basename "$t")" bash "$t"
  done
}

available_sections() {
  local -a found=("secrets")
  [ -d "$ROOT_DIR/cli" ] && found+=("cli")
  [ -d "$ROOT_DIR/fastapi" ] && found+=("fastapi")
  [ -d "$ROOT_DIR/fastify" ] && found+=("fastify")
  [ -d "$ROOT_DIR/express" ] && found+=("express")
  [ -d "$ROOT_DIR/go" ] && found+=("go")
  [ -d "$ROOT_DIR/frontend" ] && found+=("frontend")
  [ -d "$ROOT_DIR/e2e" ] && found+=("e2e")
  [ -d "$ROOT_DIR/infra/stack" ] && found+=("infra")
  { [ -d "$ROOT_DIR/addons" ] || [ -d "$ROOT_DIR/features" ]; } && found+=("scaffold_matrix")
  compgen -G "$ROOT_DIR/scripts/*.test.sh" >/dev/null 2>&1 && found+=("scripts")
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
      secrets) SECTIONS+=("$s") ;;
      infra) has_changes_in "infra/" && SECTIONS+=("$s") ;;
      scaffold_matrix)
        { has_changes_in "addons/" || has_changes_in "features/" || has_changes_in "cli/"; } && SECTIONS+=("$s") ;;
      scripts) has_changes_in "scripts/" && SECTIONS+=("$s") ;;
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

declare -a WAVE1=()
declare -a WAVE2=()
has_fastapi=0
for s in "${SECTIONS[@]}"; do
  [[ "$s" == "fastapi" ]] && has_fastapi=1
done
for s in "${SECTIONS[@]}"; do
  if [[ "$s" == "cli" && $has_fastapi -eq 1 ]]; then
    WAVE2+=("$s")
  else
    WAVE1+=("$s")
  fi
done

OVERALL_START=$(date +%s)
declare -a NAMES=()

run_wave() {
  local -a wave=("$@")
  [[ ${#wave[@]} -eq 0 ]] && return 0
  for s in "${wave[@]}"; do
    fn="sec_$s"
    if ! declare -F "$fn" >/dev/null; then
      xfail "unknown section: $s (valid: ${AVAILABLE[*]})"
      exit 2
    fi
    start_background "$s" bash -c "set -e; $(declare -f "$fn" run_step run_js_component pm_install pm_exec pm_run pm_audit detect_pm start_background xfail warn go_format_check); $fn"
    NAMES+=("$s")
    printf '  %s↳%s %s started (pid %s) → %s/%s.log\n' "$DIM" "$RESET" "$s" "$LAST_PID" "$LOGS_DIR" "$s"
  done
}

run_wave "${WAVE1[@]}"

ANY_FAIL=0
REMAINING=${#PIDS[@]}
WAVE2_STARTED=0

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
  if ((REMAINING == 0 && WAVE2_STARTED == 0 && ${#WAVE2[@]} > 0)); then
    WAVE2_STARTED=1
    run_wave "${WAVE2[@]}"
    REMAINING=${#WAVE2[@]}
  fi
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
