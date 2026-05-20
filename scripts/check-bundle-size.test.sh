#!/usr/bin/env bash
# scripts/check-bundle-size.test.sh — unit tests for check-bundle-size.sh.
#
# Usage:
#   bash scripts/check-bundle-size.test.sh
#
# Exit 0 on pass, non-zero on first failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/check-bundle-size.sh"

if [ ! -x "$TARGET" ]; then
  echo "FAIL: $TARGET missing or not executable" >&2
  exit 1
fi

pass=0
fail=0

assert() {
  local label="$1"
  local expected_rc="$2"
  local actual_rc="$3"
  if [ "$expected_rc" = "$actual_rc" ]; then
    printf '  ✓ %s\n' "$label"
    pass=$((pass + 1))
  else
    printf '  ✗ %s — expected exit %s, got %s\n' "$label" "$expected_rc" "$actual_rc" >&2
    fail=$((fail + 1))
  fi
}

make_assets() {
  local dir="$1"
  shift
  mkdir -p "$dir/assets"
  while [ $# -gt 0 ]; do
    local name="$1"
    local kb="$2"
    shift 2
    dd if=/dev/zero of="$dir/assets/$name" bs=1024 count="$kb" status=none
  done
}

run_in() {
  local dir="$1"
  shift
  (cd "$dir" && BUNDLE_DIST_DIR="dist/assets" "$@") >/dev/null 2>&1
  echo "$?"
}

# 1. happy path — every chunk under budget
tmp1="$(mktemp -d)"
make_assets "$tmp1/dist" "index-abc.js" 100 "vendor-def.js" 200
assert "passes when every chunk is under budget" 0 "$(run_in "$tmp1" bash "$TARGET")"
rm -rf "$tmp1"

# 2. initial chunk over budget — fails
tmp2="$(mktemp -d)"
make_assets "$tmp2/dist" "index-big.js" 600
assert "fails when initial chunk exceeds default 500KB" 1 "$(run_in "$tmp2" bash "$TARGET")"
rm -rf "$tmp2"

# 3. async chunk over its (larger) budget — fails
tmp3="$(mktemp -d)"
make_assets "$tmp3/dist" "lazy-foo.js" 900
assert "fails when async chunk exceeds default 800KB" 1 "$(run_in "$tmp3" bash "$TARGET")"
rm -rf "$tmp3"

# 4. async chunk under its budget but over initial — still passes (correct routing)
tmp4="$(mktemp -d)"
make_assets "$tmp4/dist" "vendor-react.js" 700
assert "passes when async chunk under async budget but over initial budget" 0 "$(run_in "$tmp4" bash "$TARGET")"
rm -rf "$tmp4"

# 5. env override raises budget — formerly-failing now passes
tmp5="$(mktemp -d)"
make_assets "$tmp5/dist" "index-big.js" 600
(cd "$tmp5" && BUNDLE_DIST_DIR="dist/assets" BUNDLE_BUDGET_INITIAL_KB=1000 bash "$TARGET") >/dev/null 2>&1
assert "respects BUNDLE_BUDGET_INITIAL_KB override" 0 "$?"
rm -rf "$tmp5"

# 6. missing dist dir → fails fast
tmp6="$(mktemp -d)"
(cd "$tmp6" && BUNDLE_DIST_DIR="dist/assets" bash "$TARGET") >/dev/null 2>&1
assert "fails fast when dist directory is missing" 1 "$?"
rm -rf "$tmp6"

# 7. empty dist (no JS files) → passes (nothing to violate)
tmp7="$(mktemp -d)"
mkdir -p "$tmp7/dist/assets"
assert "passes when dist/assets is empty (no chunks)" 0 "$(run_in "$tmp7" bash "$TARGET")"
rm -rf "$tmp7"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
