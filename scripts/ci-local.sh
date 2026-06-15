#!/usr/bin/env bash
# scripts/ci-local.sh — run every CI gate locally, in parallel.
#
# Usage:
#   ./scripts/ci-local.sh                       # every available section
#   ./scripts/ci-local.sh changed               # only sections touched vs origin/main + working tree
#   ./scripts/ci-local.sh fastify e2e           # run named sections only
#
# Sections (auto-detected by which top-level dirs exist):
#   secrets  cli  fastapi  fastify  express  vitejs  nextjs  mobile  e2e  infra
#   admin_panel  scaffold_matrix  scaffold_fuzz  scripts
#
# Environment knobs:
#   E2E_SKIP_REAL=1             skip real backend/frontend boot + Playwright in sec_e2e
#                               (default: deterministic local boot + Playwright)
#   E2E_BACKEND_PORT=auto       port the booted backend listens on (default: random free port)
#   E2E_FRONTEND_PORT=auto      port the booted frontend listens on (default: random free port)
#   E2E_HEALTH_PATH=/api/health endpoint used for readiness polling
#   E2E_BACKEND_COV_MIN=30      min %% lines for the backend E2E coverage stream
#   SCAFFOLD_FUZZ_RUNS=200      random scaffold permutations in sec_scaffold_fuzz
#   SCAFFOLD_FUZZ_JOBS=4        parallel scaffolds inside the fuzzer
#   SCAFFOLD_FUZZ_SEED=N        pin the fuzzer seed for a reproducible run
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
E2E_FRONTEND_PORT="${E2E_FRONTEND_PORT:-$(pick_free_port)}"
export E2E_BACKEND_PORT
export E2E_FRONTEND_PORT

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
  pkill -f "$ROOT_DIR/[^ ]*.*tsx.*src/server\\.ts" 2>/dev/null || true
  rm -rf "$LOGS_DIR"
  rm -rf "$ROOT_DIR"/*/coverage-ci-* 2>/dev/null || true
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
    run_step "$dir lint" pm_exec eslint . --fix
    git diff --quiet -- . || warn "$dir: formatters/linters rewrote files — commit them before push (CI checks, doesn't fix)"
    run_step "$dir typecheck" pm_exec tsc --noEmit
    if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts?.build ? 0 : 1)" 2>/dev/null; then
      run_step "$dir build" pm_run build
    fi
    if [ -d tests ]; then
      run_step "$dir tests" pm_exec vitest run --coverage --coverage.reportsDirectory="coverage-ci-$$"
    fi
    run_step "$dir audit" pm_audit
  )
}

ensure_gitleaks() {
  local version="8.24.3"
  local cache_dir="${HOME}/.cache/ci-local"
  GITLEAKS_BIN="$cache_dir/gitleaks-${version}"
  [ -x "$GITLEAKS_BIN" ] && return 0
  command -v curl >/dev/null 2>&1 || { xfail "curl required to fetch gitleaks"; return 1; }
  command -v tar >/dev/null 2>&1 || { xfail "tar required to fetch gitleaks"; return 1; }
  mkdir -p "$cache_dir"
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$(uname -m)" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *)
      xfail "unsupported arch for gitleaks: $(uname -m)"
      return 1
      ;;
  esac
  curl -sSL -o "$cache_dir/gitleaks.tar.gz" \
    "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_${os}_${arch}.tar.gz"
  tar -xzf "$cache_dir/gitleaks.tar.gz" -C "$cache_dir" gitleaks
  mv "$cache_dir/gitleaks" "$GITLEAKS_BIN"
  chmod +x "$GITLEAKS_BIN"
  rm -f "$cache_dir/gitleaks.tar.gz"
}

sec_secrets() {
  cd "$ROOT_DIR" || exit 1
  ensure_gitleaks || return 1
  local cfg="$ROOT_DIR/.gitleaks.toml"
  local args=(detect --no-banner --no-git --redact)
  [ -f "$cfg" ] && args+=(--config "$cfg")
  run_step "gitleaks (tracked + untracked)" "$GITLEAKS_BIN" "${args[@]}" --source "$ROOT_DIR"
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
  run_step "cli lint" pm_exec eslint 'src/**/*.ts' 'tests/**/*.ts' --fix
  git diff --quiet -- . || warn "cli: formatters/linters rewrote files — commit them before push (CI checks, doesn't fix)"
  run_step "cli typecheck" pm_exec tsc --noEmit
  run_step "cli build" pm_run build
  run_step "cli tests" pm_exec vitest run --coverage --coverage.reportsDirectory="$LOGS_DIR/cli-coverage"
  run_step "cli audit" pm_audit
}

sec_fastify() { run_js_component fastify; }

express_boot_smoke() {
  cd "$ROOT_DIR/express" || exit 1
  [ -f .env.test ] || {
    xfail "express/.env.test missing — cannot boot express for smoke"
    return 1
  }
  command -v curl >/dev/null 2>&1 || {
    xfail "curl required for express boot smoke"
    return 1
  }
  if [ -f prisma/schema.prisma ]; then
    run_step "express prisma db push" bash -c \
      "set -a; . ./.env.test; set +a; $(declare -f pm_exec detect_pm); pm_exec prisma db push --skip-generate --accept-data-loss"
  elif [ -f drizzle.config.ts ]; then
    run_step "express drizzle push" bash -c \
      "set -a; . ./.env.test; set +a; $(declare -f pm_exec detect_pm); pm_exec drizzle-kit push --force"
  elif [ -f scripts/db-sync.ts ]; then
    run_step "express db sync" bash -c \
      "set -a; . ./.env.test; set +a; $(declare -f pm_exec detect_pm); pm_exec tsx scripts/db-sync.ts"
  fi
  local port
  port="$(pick_free_port)"
  printf '\n==> %s\n' "express boot smoke (:$port/api/health)"
  start_background "express-boot" bash -c \
    "cd '$ROOT_DIR/express' && set -a && . ./.env.test && set +a && $(declare -f pm_exec detect_pm); PORT='$port' HOST='127.0.0.1' pm_exec tsx src/server.ts"
  local boot_pid="$LAST_PID"
  local tries=60
  local rc=0
  until curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do
    if ! kill -0 "$boot_pid" 2>/dev/null; then
      xfail "express boot smoke: server exited before becoming healthy"
      tail -25 "$LOGS_DIR/express-boot.log" >&2 || true
      return 1
    fi
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      xfail "express boot smoke: never healthy on :$port/api/health"
      tail -25 "$LOGS_DIR/express-boot.log" >&2 || true
      rc=1
      break
    fi
    sleep 1
  done
  kill -- "-$boot_pid" 2>/dev/null || kill "$boot_pid" 2>/dev/null || true
  return "$rc"
}

sec_express() {
  run_js_component express || return 1
  express_boot_smoke
}

sec_go() {
  [ -d "$ROOT_DIR/go" ] || return 0
  cd "$ROOT_DIR/go" || exit 1
  run_step "go install" go mod download
  gofmt -w .
  local go_unformatted
  go_unformatted="$(gofmt -l .)"
  if [ -n "$go_unformatted" ]; then
    xfail "gofmt could not normalize: $go_unformatted"
    return 1
  fi
  run_step "go vet" go vet ./...
  run_step "go build" go build ./...
  if command -v golangci-lint >/dev/null 2>&1; then
    run_step "go lint" golangci-lint run ./...
  else
    warn "golangci-lint not installed — skipping (install: brew install golangci-lint)"
  fi
  run_step "go test" go test -race -coverprofile=coverage.out ./...
  run_step "go coverage" bash scripts/check-coverage.sh
}

sec_rust() {
  [ -d "$ROOT_DIR/rust" ] || return 0
  if ! command -v cargo >/dev/null 2>&1; then
    warn "rust toolchain not installed, skipping (install: https://rustup.rs)"
    return 0
  fi
  cd "$ROOT_DIR/rust" || exit 1
  run_step "rust format" cargo fmt
  run_step "rust lint" cargo clippy --fix --allow-dirty --allow-staged -- -D warnings
  git diff --quiet -- . 2>/dev/null || warn "rust: cargo fmt/clippy rewrote files — commit them before push (CI runs check-mode on the committed tree)"
  run_step "rust test" cargo test --all-features
}

sec_laravel() {
  [ -d "$ROOT_DIR/laravel" ] || return 0
  if ! command -v php >/dev/null 2>&1 || ! command -v composer >/dev/null 2>&1; then
    warn "php/composer not installed, skipping (install: https://www.php.net + https://getcomposer.org)"
    return 0
  fi
  cd "$ROOT_DIR/laravel" || exit 1
  run_step "laravel install" composer install --no-interaction
  run_step "laravel format" ./vendor/bin/pint
  git diff --quiet -- . 2>/dev/null || warn "laravel: pint rewrote files — commit them before push (CI runs check-mode on the committed tree)"
  run_step "laravel lint" ./vendor/bin/phpstan analyse --no-progress --memory-limit=512M
  run_step "laravel tests" ./vendor/bin/pest --no-coverage
}

sec_vitejs() {
  export VITE_OIDC_URL="${VITE_OIDC_URL:-http://localhost:8080}"
  export VITE_OIDC_REALM="${VITE_OIDC_REALM:-master}"
  export VITE_OIDC_CLIENT_ID="${VITE_OIDC_CLIENT_ID:-frontend}"
  run_js_component vitejs
  if [ -d "$ROOT_DIR/vitejs/dist/assets" ] && [ -x "$ROOT_DIR/scripts/check-bundle-size.sh" ]; then
    (cd "$ROOT_DIR/vitejs" && run_step "vitejs bundle-size" bash "$ROOT_DIR/scripts/check-bundle-size.sh")
  fi
}

sec_nextjs() { run_js_component nextjs; }

sec_e2e() {
  if [ ! -d "$ROOT_DIR/e2e" ]; then return 0; fi
  if [ -n "${E2E_SKIP_REAL:-}" ]; then
    run_js_component e2e
    return $?
  fi

  export VITE_OIDC_URL="${VITE_OIDC_URL:-http://localhost:8080}"
  export VITE_OIDC_REALM="${VITE_OIDC_REALM:-master}"
  export VITE_OIDC_CLIENT_ID="${VITE_OIDC_CLIENT_ID:-frontend}"

  local backend_kind=""
  local port="$E2E_BACKEND_PORT"
  local frontend_port="$E2E_FRONTEND_PORT"
  local health_path="${E2E_HEALTH_PATH:-/api/health}"
  local e2e_jwt_secret="${E2E_JWT_SECRET:-}" # pragma: allowlist secret

  if [ -d "$ROOT_DIR/fastapi" ]; then
    backend_kind="fastapi"
  elif [ -d "$ROOT_DIR/fastify" ]; then
    backend_kind="fastify"
  elif [ -d "$ROOT_DIR/express" ]; then
    backend_kind="express"
  fi

  if [ -z "$backend_kind" ]; then
    xfail "no backend directory found for e2e (expected fastapi, fastify, or express)"
    return 1
  fi

  if [ "$backend_kind" = "fastapi" ]; then
    if ! command -v uv >/dev/null 2>&1; then
      xfail "uv not installed — cannot boot fastapi backend for e2e"
      return 1
    fi
    [ -f "$ROOT_DIR/fastapi/.env.test" ] || {
      xfail "fastapi/.env.test missing — cannot boot fastapi backend for e2e"
      return 1
    }
    (cd "$ROOT_DIR/fastapi" && uv sync --group dev) || return 1
    if [ -z "$e2e_jwt_secret" ]; then
      e2e_jwt_secret="$(
        bash -c "set -a; . '$ROOT_DIR/fastapi/.env.test'; set +a; printf '%s' \"\${JWT_SECRET:-}\""
      )"
    fi
    local base_uri e2e_uri
    base_uri="$(bash -c "set -a; . '$ROOT_DIR/fastapi/.env.test'; set +a; printf '%s' \"\${SQLALCHEMY_DATABASE_URI:-}\"")"
    e2e_uri="${base_uri%/*}/projx_test_e2e"
    createdb -U "${PGUSER:-$(whoami)}" -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" projx_test_e2e 2>/dev/null || true
    bash -c "cd '$ROOT_DIR/fastapi' && set -a && . ./.env.test && set +a && export SQLALCHEMY_DATABASE_URI='$e2e_uri' && exec uv run python migrate.py" || return 1
    rm -f "$ROOT_DIR/fastapi"/.coverage*
    start_background "e2e-backend" bash -c \
      "cd '$ROOT_DIR/fastapi' && set -a && . ./.env.test && set +a && export SQLALCHEMY_DATABASE_URI='$e2e_uri' && export CORS_ALLOW_ORIGINS='http://127.0.0.1:$frontend_port' && exec uv run coverage run --parallel-mode --source=src -m uvicorn src.app:app --host 127.0.0.1 --port '$port'"
  elif [ "$backend_kind" = "fastify" ]; then
    (cd "$ROOT_DIR/fastify" && pm_install) || return 1
    if [ -f "$ROOT_DIR/fastify/prisma/schema.prisma" ]; then
      (cd "$ROOT_DIR/fastify" && pm_exec prisma generate) || return 1
      (cd "$ROOT_DIR/fastify" && pm_exec prisma db push --skip-generate --accept-data-loss) || return 1
    fi
    [ -f "$ROOT_DIR/fastify/.env" ] || {
      xfail "fastify/.env missing — cannot boot fastify backend for e2e"
      return 1
    }
    if [ -z "$e2e_jwt_secret" ]; then
      e2e_jwt_secret="$(
        bash -c "set -a; . '$ROOT_DIR/fastify/.env'; set +a; printf '%s' \"\${JWT_SECRET:-}\""
      )"
    fi
    start_background "e2e-backend" bash -c \
      "cd '$ROOT_DIR/fastify' && $(declare -f pm_exec detect_pm); PORT='$port' pm_exec tsx --env-file=.env src/server.ts"
  else
    (cd "$ROOT_DIR/express" && pm_install) || return 1
    if [ -f "$ROOT_DIR/express/prisma/schema.prisma" ]; then
      (cd "$ROOT_DIR/express" && pm_exec prisma generate) || return 1
      (cd "$ROOT_DIR/express" && pm_exec prisma db push --skip-generate --accept-data-loss) || return 1
    fi
    start_background "e2e-backend" bash -c \
      "cd '$ROOT_DIR/express' && $(declare -f pm_exec detect_pm); PORT='$port' pm_exec tsx src/server.ts"
  fi
  local backend_pid="$LAST_PID"

  if ! command -v curl >/dev/null 2>&1; then
    warn "curl missing — skipping backend healthcheck"
  else
    local tries=60
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

  [ -d "$ROOT_DIR/vitejs" ] || {
    xfail "frontend directory missing — cannot run e2e"
    kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
    return 1
  }

  (
    cd "$ROOT_DIR/vitejs" || exit 1
    run_step "frontend install (e2e)" pm_install
    run_step "frontend build (e2e)" bash -c \
      "$(declare -f pm_exec detect_pm); VITE_API_URL='http://127.0.0.1:$port' VITE_COVERAGE=1 pm_exec vite build --outDir dist-e2e"
  ) || {
    kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
    return 1
  }

  start_background "e2e-frontend" bash -c \
    "cd '$ROOT_DIR/vitejs' && $(declare -f pm_exec detect_pm); pm_exec vite preview --outDir dist-e2e --host 127.0.0.1 --port '$frontend_port' --strictPort"
  local frontend_pid="$LAST_PID"

  if command -v curl >/dev/null 2>&1; then
    local ui_tries=60
    until curl -fsS "http://127.0.0.1:$frontend_port" >/dev/null 2>&1; do
      ui_tries=$((ui_tries - 1))
      if [ "$ui_tries" -le 0 ]; then
        xfail "e2e frontend never became healthy on :$frontend_port"
        kill -- "-$frontend_pid" 2>/dev/null || kill "$frontend_pid" 2>/dev/null || true
        kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
        return 1
      fi
      sleep 1
    done
  fi

  rm -rf "$ROOT_DIR/e2e/.nyc_output"
  local rc=0
  (
    cd "$ROOT_DIR/e2e" || exit 1
    run_step "e2e install" pm_install
    run_step "e2e playwright install" pm_exec playwright install --with-deps chromium firefox webkit
    run_step "e2e format" pm_exec prettier --write .
    run_step "e2e lint" pm_exec eslint '**/*.ts' --fix
    git diff --quiet -- . || warn "e2e: formatters/linters rewrote files — commit them before push (CI checks, doesn't fix)"
    run_step "e2e typecheck" pm_exec tsc --noEmit
    export CI=1
    export BASE_URL="http://127.0.0.1:$frontend_port"
    export E2E_JWT_SECRET="$e2e_jwt_secret"
    run_step "e2e playwright" pm_exec playwright test
  ) || rc=$?

  kill -- "-$frontend_pid" 2>/dev/null || kill "$frontend_pid" 2>/dev/null || true
  kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
  sleep 3
  kill -9 -- "-$frontend_pid" 2>/dev/null || kill -9 "$frontend_pid" 2>/dev/null || true
  kill -9 -- "-$backend_pid" 2>/dev/null || kill -9 "$backend_pid" 2>/dev/null || true

  if [ "$rc" -eq 0 ]; then
    local cov="$LOGS_DIR/e2e-coverage"
    mkdir -p "$cov/fe"
    if [ -d "$ROOT_DIR/e2e/.nyc_output" ]; then
      (cd "$ROOT_DIR/e2e" && pm_exec nyc report --cwd "$ROOT_DIR" --temp-dir "$ROOT_DIR/e2e/.nyc_output" --reporter=lcovonly --report-dir "$cov/fe") || true
      if [ ! -s "$cov/fe/lcov.info" ] || ! grep -q '^SF:' "$cov/fe/lcov.info"; then
        xfail "e2e frontend coverage empty — instrumented __coverage__ scrape produced no lcov"
        rc=1
      else
        run_step "e2e frontend reachability" bash "$ROOT_DIR/e2e/scripts/check-coverage.sh" "$cov/fe/lcov.info" "$ROOT_DIR/vitejs/src/pages" || rc=1
      fi
    else
      xfail "e2e frontend coverage missing — no .nyc_output (frontend not instrumented)"
      rc=1
    fi
    if [ "$backend_kind" = "fastapi" ]; then
      (cd "$ROOT_DIR/fastapi" && uv run coverage combine && uv run coverage lcov -o "$cov/e2e-backend.lcov") || true
      if [ ! -s "$cov/e2e-backend.lcov" ] || ! grep -q '^SF:' "$cov/e2e-backend.lcov"; then
        xfail "e2e backend coverage empty — coverage.py produced no lcov (did the server flush on SIGTERM?)"
        rc=1
      else
        run_step "e2e backend coverage" bash -c "cd '$ROOT_DIR/fastapi' && uv run coverage report --fail-under=${E2E_BACKEND_COV_MIN:-30}" || rc=1
      fi
    fi
  fi
  return "$rc"
}

sec_infra() {
  cd "$ROOT_DIR/infra/stack" || exit 1
  run_step "terraform fmt" terraform fmt -check -recursive
  run_step "terraform init" terraform init -backend=false -reconfigure
  run_step "terraform validate" terraform validate
}

sec_mobile() {
  cd "$ROOT_DIR/mobile" || exit 1
  if ! command -v flutter >/dev/null 2>&1; then
    warn "flutter not installed — skipping mobile section (install Flutter SDK)"
    return 0
  fi
  run_step "mobile pub get" flutter pub get
  run_step "mobile format" dart format --set-exit-if-changed .
  run_step "mobile analyze" dart analyze --fatal-infos
  run_step "mobile tests" flutter test --coverage
  run_step "mobile coverage" bash scripts/check-coverage.sh 80
  warn "mobile integration_test SKIPPED — requires a connected device or simulator."
  warn "Run manually: cd mobile && flutter test integration_test/"
}

sec_admin_panel() {
  cd "$ROOT_DIR/admin-panel" || exit 1
  if ! command -v go >/dev/null 2>&1; then
    warn "go not installed — skipping admin-panel section (install Go from go.dev)"
    return 0
  fi
  run_step "admin-panel gofmt" bash scripts/check-gofmt.sh
  run_step "admin-panel vet" go vet ./...
  run_step "admin-panel build" go build ./...
  local pg_user pg_host pg_port db
  pg_user="${PGUSER:-$(whoami)}"
  pg_host="${PGHOST:-localhost}"
  pg_port="${PGPORT:-5432}"
  createdb -U "$pg_user" -h "$pg_host" -p "$pg_port" projx_test_admin_panel 2>/dev/null || true
  db="postgresql://${pg_user}@${pg_host}:${pg_port}/projx_test_admin_panel?sslmode=disable"
  local cover="$LOGS_DIR/admin-panel-cover.out"
  run_step "admin-panel tests" env TEST_DATABASE_URL="$db" bash scripts/test.sh "$cover"
  run_step "admin-panel coverage" bash scripts/check-coverage.sh "$cover" 80
  rm -f "$cover"
}

sec_scaffold_matrix() {
  cd "$ROOT_DIR/cli" || exit 1
  run_step "cli build for matrix" pm_run build
  cd "$ROOT_DIR" || exit 1
  run_step "scaffold-matrix" "$ROOT_DIR/scripts/ci-scaffold-matrix.sh" all
}

sec_scaffold_fuzz() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not found — scaffold-fuzz requires it"
    return 1
  fi
  cd "$ROOT_DIR/cli" || exit 1
  run_step "cli build for fuzz" pm_exec tsup src/index.ts --format esm --target node18 --clean --out-dir dist-fuzz
  cd "$ROOT_DIR" || exit 1
  local runs="${SCAFFOLD_FUZZ_RUNS:-200}"
  local jobs="${SCAFFOLD_FUZZ_JOBS:-4}"
  local args=(--runs "$runs" --jobs "$jobs" --cli "$ROOT_DIR/cli/dist-fuzz/index.js")
  [ -n "${SCAFFOLD_FUZZ_SEED:-}" ] && args+=(--seed "$SCAFFOLD_FUZZ_SEED")
  run_step "scaffold-fuzz ($runs runs)" python3 "$ROOT_DIR/scripts/scaffold-fuzz.py" "${args[@]}"
}

sec_gen_compile() {
  cd "$ROOT_DIR/cli" || exit 1
  run_step "cli build for gen-compile" pm_run build
  cd "$ROOT_DIR" || exit 1
  local backend="${GEN_COMPILE_BACKEND:-all}"
  run_step "gen-compile ($backend)" "$ROOT_DIR/scripts/ci-gen-compile.sh" "$backend"
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
  [ -d "$ROOT_DIR/rust" ] && found+=("rust")
  [ -d "$ROOT_DIR/laravel" ] && found+=("laravel")
  [ -d "$ROOT_DIR/vitejs" ] && found+=("vitejs")
  [ -d "$ROOT_DIR/nextjs" ] && found+=("nextjs")
  [ -d "$ROOT_DIR/mobile" ] && found+=("mobile")
  [ -d "$ROOT_DIR/e2e" ] && found+=("e2e")
  [ -d "$ROOT_DIR/infra/stack" ] && found+=("infra")
  [ -d "$ROOT_DIR/admin-panel" ] && found+=("admin_panel")
  { [ -d "$ROOT_DIR/addons" ] || [ -d "$ROOT_DIR/features" ]; } && found+=("scaffold_matrix")
  [ -f "$ROOT_DIR/scripts/scaffold-fuzz.py" ] && found+=("scaffold_fuzz")
  [ -f "$ROOT_DIR/scripts/ci-gen-compile.sh" ] && found+=("gen_compile")
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
      admin_panel) has_changes_in "admin-panel/" && SECTIONS+=("$s") ;;
      scaffold_matrix)
        { has_changes_in "addons/" || has_changes_in "features/" || has_changes_in "cli/"; } && SECTIONS+=("$s") ;;
      scaffold_fuzz)
        { has_changes_in "cli/" || has_changes_in "addons/" || has_changes_in "features/"; } && SECTIONS+=("$s") ;;
      gen_compile)
        { has_changes_in "cli/" || has_changes_in "addons/" || has_changes_in "features/" ||
          has_changes_in "go/" || has_changes_in "rust/" || has_changes_in "laravel/" ||
          has_changes_in "fastapi/" || has_changes_in "fastify/" ||
          has_changes_in "scripts/ci-gen-compile.sh"; } && SECTIONS+=("$s") ;;
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
    start_background "$s" bash -c "set -e; $(declare -f "$fn" run_step run_js_component pm_install pm_exec pm_run pm_audit detect_pm start_background ensure_gitleaks xfail warn express_boot_smoke pick_free_port); $fn"
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
