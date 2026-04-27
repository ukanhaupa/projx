#!/usr/bin/env bash
# Enforces line-coverage threshold against coverage/lcov.info.
# Usage: bash scripts/check-coverage.sh [threshold]
#
# Excludes integration-only files from the unit-coverage gate:
#   - generated code (*.g.dart, *.freezed.dart)
#   - Isar storage layer (entities/base/offline/) — needs in-memory Isar
#   - app entry points (main.dart, app.dart)
#
set -euo pipefail

THRESHOLD="${1:-${COVERAGE_THRESHOLD:-80}}"
LCOV="${LCOV_PATH:-coverage/lcov.info}"

if [ ! -f "$LCOV" ]; then
  echo "ERROR: $LCOV not found. Run 'flutter test --coverage' first." >&2
  exit 1
fi

EXCLUDE_PATTERNS='\.g\.dart$|\.freezed\.dart$|/entities/base/offline/|/main\.dart$|/app\.dart$|/core/providers/core_providers\.dart$|/core/network/.*_interceptor\.dart$|/entities/base/base_repository\.dart$|/entities/base/entity_providers\.dart$'

LF=$(awk -v exc="$EXCLUDE_PATTERNS" '
  /^SF:/ { skip = ($0 ~ exc); next }
  /^LF:/ && !skip { sub("LF:", ""); sum += $0 }
  END { print sum + 0 }
' "$LCOV")
LH=$(awk -v exc="$EXCLUDE_PATTERNS" '
  /^SF:/ { skip = ($0 ~ exc); next }
  /^LH:/ && !skip { sub("LH:", ""); sum += $0 }
  END { print sum + 0 }
' "$LCOV")

if [ "$LF" -eq 0 ]; then
  echo "ERROR: no lines found in $LCOV" >&2
  exit 1
fi

PCT=$(awk -v lh="$LH" -v lf="$LF" 'BEGIN { printf "%.2f", (lh / lf) * 100 }')
PASS=$(awk -v pct="$PCT" -v th="$THRESHOLD" 'BEGIN { print (pct + 0 >= th + 0) ? 1 : 0 }')

if [ "$PASS" -eq 1 ]; then
  echo "Coverage ${PCT}% (lines ${LH}/${LF}) — meets ${THRESHOLD}% threshold"
  exit 0
fi

echo "FAIL: coverage ${PCT}% (lines ${LH}/${LF}) below ${THRESHOLD}% threshold" >&2
exit 1
