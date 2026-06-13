#!/usr/bin/env bash
set -euo pipefail

lcov="${1:?usage: check-coverage.sh <lcov> <pages-dir>}"
pages_dir="${2:?usage: check-coverage.sh <lcov> <pages-dir>}"

if [[ ! -s "$lcov" ]] || ! grep -q '^SF:' "$lcov"; then
  echo "reachability: '$lcov' is empty or has no SF: entries"
  exit 1
fi

orphans=()
total=0
while IFS= read -r page; do
  total=$((total + 1))
  base="$(basename "$page")"
  if ! grep -qE "^SF:.*${base//./\\.}\$" "$lcov"; then
    orphans+=("$page")
  fi
done < <(find "$pages_dir" -name '*.tsx')

if [[ ${#orphans[@]} -gt 0 ]]; then
  echo "E2E reachability FAILED — page(s) never reached by any spec (0 orphans required):"
  printf '  %s\n' "${orphans[@]}"
  exit 1
fi

echo "E2E reachability OK — all ${total} page(s) reached"
