#!/usr/bin/env bash
set -euo pipefail

THRESHOLD="${1:-${COVERAGE_THRESHOLD:-80}}"
PROFILE="${COVERAGE_PROFILE:-coverage.out}"

if [ ! -f "$PROFILE" ]; then
  echo "ERROR: $PROFILE not found. Run 'go test -coverprofile=$PROFILE ./...' first." >&2
  exit 1
fi

SUMMARY=$(go tool cover -func="$PROFILE" | tail -1)
PCT=$(echo "$SUMMARY" | awk '{print $NF}' | tr -d '%')

if [ -z "$PCT" ]; then
  echo "ERROR: could not parse coverage from: $SUMMARY" >&2
  exit 1
fi

PASS=$(awk -v pct="$PCT" -v th="$THRESHOLD" 'BEGIN { print (pct + 0 >= th + 0) ? 1 : 0 }')

if [ "$PASS" = "1" ]; then
  printf "Coverage: %s%% (threshold %s%%) PASS\n" "$PCT" "$THRESHOLD"
  exit 0
fi

printf "Coverage: %s%% (threshold %s%%) FAIL\n" "$PCT" "$THRESHOLD" >&2
exit 1
