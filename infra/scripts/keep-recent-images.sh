#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <repository-url> [keep-count]"
  exit 2
fi

REPOSITORY_URL="$1"
KEEP_COUNT="${2:-5}"

docker images "$REPOSITORY_URL" --format '{{.ID}}' \
  | awk -v keep="$KEEP_COUNT" 'NR > keep { print }' \
  | sort -u \
  | xargs -r docker rmi || true

docker image prune --filter "until=168h" -f || true
