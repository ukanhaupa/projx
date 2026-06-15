#!/usr/bin/env bash
# Validate frontend/nginx.conf against the same nginx runtime image the
# Dockerfile uses. Catches unknown directives (like `brotli on;` without
# ngx_brotli installed) BEFORE deploy — the gate that would have prevented
# the 2026-06-01 brotli-induced outage.
#
# Mechanism: pulls the nginx image declared in frontend/Dockerfile, mounts
# nginx.conf + security-headers.conf + a dummy self-signed cert pair into the
# expected paths, then runs `nginx -t`. `nginx -t` parses the full config and
# validates every directive against the binary's compiled-in module set. If a
# directive requires a module the image doesn't ship (e.g. ngx_brotli on stock
# nginx:1.27-alpine), the test exits non-zero before the change can land.
#
# Usage:   bash scripts/validate-nginx-config.sh
# Exit:    0 = pass (or skipped — see warnings)
#          1 = config invalid against runtime image
#          2 = Dockerfile installs nginx modules; this gate is no longer sufficient

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
DOCKERFILE="$FRONTEND_DIR/Dockerfile"
NGINX_CONF="$FRONTEND_DIR/nginx.conf"
SECURITY_HEADERS="$FRONTEND_DIR/security-headers.conf"

if [[ ! -f "$DOCKERFILE" || ! -f "$NGINX_CONF" ]]; then
  echo "validate-nginx-config: no frontend/Dockerfile or frontend/nginx.conf — nothing to validate"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "WARN  validate-nginx-config: docker not installed; skipping (CI's self-hosted runner will still run this)" >&2
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  echo "WARN  validate-nginx-config: docker daemon not running; skipping" >&2
  exit 0
fi

NGINX_IMAGE=$(awk '
  /^FROM .*nginx:/ { line = $0 }
  END {
    sub(/^FROM /, "", line)
    sub(/ AS .*/, "", line)
    print line
  }
' "$DOCKERFILE")
if [[ -z "${NGINX_IMAGE:-}" ]]; then
  echo "ERROR validate-nginx-config: could not extract nginx image from $DOCKERFILE" >&2
  exit 1
fi

if grep -qE 'apk add[^&]*nginx-mod-|--add-module' "$DOCKERFILE"; then
  cat >&2 <<EOF
ERROR validate-nginx-config: $DOCKERFILE installs nginx modules via apk or --add-module.
      This gate validates against stock $NGINX_IMAGE only and would miss those modules.
      Replace it with:
        docker build --target runtime -t frontend-nginx-validate $FRONTEND_DIR
        docker run --rm -v ... frontend-nginx-validate nginx -t
EOF
  exit 2
fi

echo "validate-nginx-config: validating $NGINX_CONF against $NGINX_IMAGE"

SSL_DIR=$(mktemp -d)
trap 'rm -rf "$SSL_DIR"' EXIT
openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
  -keyout "$SSL_DIR/privkey.pem" \
  -out "$SSL_DIR/fullchain.pem" \
  -subj "/CN=test.local" -batch >/dev/null 2>&1

if [[ -f "$SECURITY_HEADERS" ]]; then
  docker run --rm \
    -v "$NGINX_CONF:/etc/nginx/conf.d/default.conf:ro" \
    -v "$SECURITY_HEADERS:/etc/nginx/conf.d/security-headers.inc:ro" \
    -v "$SSL_DIR:/etc/nginx/ssl:ro" \
    "$NGINX_IMAGE" \
    nginx -t
else
  docker run --rm \
    -v "$NGINX_CONF:/etc/nginx/conf.d/default.conf:ro" \
    -v "$SSL_DIR:/etc/nginx/ssl:ro" \
    "$NGINX_IMAGE" \
    nginx -t
fi
