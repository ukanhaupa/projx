#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required"
    exit 1
fi

if [ ! -d ent/schema ]; then
    echo "ent/schema directory not found"
    exit 1
fi

echo "==> go generate (ent generate)"
go generate ./...

if [ ! -f ent/client.go ]; then
    echo "ent generation produced no client; check ent/schema for errors"
    exit 1
fi

echo "==> ent schema migrate (auto-create tables)"
go run . -migrate

echo "Done."
