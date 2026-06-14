#!/usr/bin/env bash
set -euo pipefail

LIMIT_BYTES="${BUNDLE_ENTRY_LIMIT_BYTES:-100000}" 
DIST_DIR="${1:-$(dirname "$0")/../dist}"

if [ ! -d "$DIST_DIR/assets" ]; then
  echo "check-bundle-size: $DIST_DIR/assets not found. Run vite build first." >&2
  exit 2
fi

shopt -s nullglob
entries=("$DIST_DIR"/assets/index-*.js)

if [ ${#entries[@]} -eq 0 ]; then
  echo "check-bundle-size: no dist/assets/index-*.js found. Is this a vite build output?" >&2
  exit 2
fi

status=0
for f in "${entries[@]}"; do
  size=$(wc -c < "$f" | tr -d ' ')
  rel=${f#"$DIST_DIR/"}
  if [ "$size" -gt "$LIMIT_BYTES" ]; then
    printf "FAIL  %-50s %8d bytes (limit %d)\n" "$rel" "$size" "$LIMIT_BYTES"
    status=1
  else
    printf "ok    %-50s %8d bytes (limit %d)\n" "$rel" "$size" "$LIMIT_BYTES"
  fi
done

exit "$status"
