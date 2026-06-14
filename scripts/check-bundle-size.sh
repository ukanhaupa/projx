#!/usr/bin/env bash
# scripts/check-bundle-size.sh — fail the build if a frontend chunk exceeds a budget.
#
# Usage (from vitejs/ workdir):
#   bash ../scripts/check-bundle-size.sh                 # default budgets
#   BUNDLE_BUDGET_INITIAL_KB=600 bash ../scripts/check-bundle-size.sh
#
# Defaults: initial entry chunks ≤ 500KB minified, async chunks ≤ 800KB.

set -euo pipefail

DIST_DIR="${BUNDLE_DIST_DIR:-dist/assets}"
INITIAL_KB="${BUNDLE_BUDGET_INITIAL_KB:-500}"
ASYNC_KB="${BUNDLE_BUDGET_ASYNC_KB:-800}"

if [ ! -d "$DIST_DIR" ]; then
  echo "check-bundle-size: $DIST_DIR not found (build first)." >&2
  exit 1
fi

shopt -s nullglob
fail=0
total_kb=0

print_row() {
  printf '  %s %s  %s\n' "$1" "$2" "$3"
}

for f in "$DIST_DIR"/*.js; do
  bytes=$(wc -c <"$f" | tr -d ' ')
  kb=$(( (bytes + 1023) / 1024 ))
  total_kb=$((total_kb + kb))
  base=$(basename "$f")

  case "$base" in
    index-*|main-*|app-*)
      budget=$INITIAL_KB
      kind=initial
      ;;
    *)
      budget=$ASYNC_KB
      kind=async
      ;;
  esac

  if [ "$kb" -gt "$budget" ]; then
    print_row "✗" "$(printf '%4dKB' "$kb")" "$base (over $budget KB $kind budget)"
    fail=1
  else
    print_row "✓" "$(printf '%4dKB' "$kb")" "$base"
  fi
done

echo "  ----"
echo "  total JS: ${total_kb}KB"

if [ "$fail" -ne 0 ]; then
  echo "check-bundle-size: at least one chunk exceeds its budget." >&2
  exit 1
fi
