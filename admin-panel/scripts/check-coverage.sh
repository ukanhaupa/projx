#!/usr/bin/env bash
set -euo pipefail

profile="${1:-cover.out}"
threshold="${2:-80}"

filtered="$(mktemp)"
trap 'rm -f "$filtered"' EXIT

grep -v 'adminpanel/cmd/admin/' "$profile" >"$filtered"
pct="$(go tool cover -func="$filtered" | awk '/^total:/ {print $3}' | tr -d '%')"
echo "admin-panel coverage (excl entrypoint): ${pct}%"
awk -v p="$pct" -v t="$threshold" 'BEGIN { exit (p + 0 >= t + 0 ? 0 : 1) }'
