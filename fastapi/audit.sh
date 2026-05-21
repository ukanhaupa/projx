#!/usr/bin/env bash
# Single source of truth for the fastapi dependency audit.
# Reads .pip-audit-ignore (one id per line, # comments) and invokes pip-audit.
# Called from scripts/ci-local.sh sec_fastapi and .github/workflows/ci.yml.
set -euo pipefail

cd "$(dirname "$0")"

IGNORE_FILE=".pip-audit-ignore"
flags=()
if [[ -f "$IGNORE_FILE" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line//[[:space:]]/}"
    [[ -n "$line" ]] && flags+=(--ignore-vuln "$line")
  done < "$IGNORE_FILE"
fi

exec uv run pip-audit "${flags[@]}"
