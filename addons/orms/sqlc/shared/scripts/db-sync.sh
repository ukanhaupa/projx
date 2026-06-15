#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v sqlc >/dev/null 2>&1; then
    echo "sqlc not installed. Install via: go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest"
    exit 1
fi

if ! command -v migrate >/dev/null 2>&1; then
    echo "migrate not installed. Install via: go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest"
    exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required"
    exit 1
fi

echo "==> sqlc generate"
sqlc generate

echo "==> migrate up"
migrate -path migrations -database "$DATABASE_URL" up

echo "Done."
