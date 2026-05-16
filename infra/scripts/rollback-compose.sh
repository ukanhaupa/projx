#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <service> <ecr-repository-url> <image-tag> [health-url]"
}

if [ "$#" -lt 3 ]; then
  usage
  exit 2
fi

SERVICE="$1"
REPOSITORY_URL="$2"
IMAGE_TAG="$3"
HEALTH_URL="${4:-}"
REGION="${AWS_REGION:-${TARGET_AWS_REGION:-}}"

if [ -z "$REGION" ]; then
  echo "AWS_REGION or TARGET_AWS_REGION must be set."
  exit 2
fi

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$(echo "$REPOSITORY_URL" | cut -d/ -f1)"

docker pull "$REPOSITORY_URL:$IMAGE_TAG"
docker tag "$REPOSITORY_URL:$IMAGE_TAG" "$REPOSITORY_URL:latest"
docker-compose -f /opt/docker-compose.yml up -d --no-deps "$SERVICE"

if [ -n "$HEALTH_URL" ]; then
  healthy=false
  for attempt in 1 2 3 4 5; do
    status="$(curl -kfsSL -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/tmp/projx-rollback-health.err || true)"
    case "$status" in
      2*|3*) echo "$SERVICE rollback health check OK ($status)"; healthy=true; break ;;
    esac
    echo "$SERVICE rollback health check attempt $attempt failed: HTTP ${status:-000}"
    sleep $((attempt * 5))
  done
  if [ "$healthy" != "true" ]; then
    exit 1
  fi
fi
