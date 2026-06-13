#!/usr/bin/env bash
set -euo pipefail

profile="${1:-cover.out}"

# -p 1: db + web suites share one Postgres and reset the same admin_panel schema; running packages in parallel races on DROP SCHEMA.
go test ./... -p 1 -coverpkg=./... -coverprofile="$profile"
