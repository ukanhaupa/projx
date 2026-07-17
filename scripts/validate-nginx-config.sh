#!/usr/bin/env bash
# Validate each vitejs frontend's nginx.conf against the same nginx runtime
# image the Dockerfile uses. Catches unknown directives (like `brotli on;`
# without ngx_brotli installed) BEFORE deploy — the gate that would have
# prevented the 2026-06-01 brotli-induced outage.
#
# Mechanism: pulls the nginx image declared in the frontend Dockerfile, mounts
# nginx.conf + security-headers.inc + a dummy self-signed cert pair into the
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

# shellcheck source=scripts/projx-dirs.sh disable=SC1091
. "$REPO_ROOT/scripts/projx-dirs.sh"

validate_frontend_dir() {
  local frontend_dir="$1"
  local dockerfile="$frontend_dir/Dockerfile"
  local nginx_conf="$frontend_dir/nginx.conf"
  local security_headers="$frontend_dir/security-headers.inc"

  if [[ ! -f "$dockerfile" || ! -f "$nginx_conf" ]]; then
    echo "validate-nginx-config: $frontend_dir has no Dockerfile or nginx.conf — nothing to validate"
    return 0
  fi

  local nginx_image
  nginx_image=$(awk '
    /^FROM .*nginx:/ { line = $0 }
    END {
      sub(/^FROM /, "", line)
      sub(/ AS .*/, "", line)
      print line
    }
  ' "$dockerfile")
  if [[ -z "${nginx_image:-}" ]]; then
    echo "ERROR validate-nginx-config: could not extract nginx image from $dockerfile" >&2
    return 1
  fi

  if grep -qE 'apk add[^&]*nginx-mod-|--add-module' "$dockerfile"; then
    cat >&2 <<EOF
ERROR validate-nginx-config: $dockerfile installs nginx modules via apk or --add-module.
      This gate validates against stock $nginx_image only and would miss those modules.
      Replace it with:
        docker build --target runtime -t frontend-nginx-validate $frontend_dir
        docker run --rm -v ... frontend-nginx-validate nginx -t
EOF
    return 2
  fi

  echo "validate-nginx-config: validating $nginx_conf against $nginx_image"

  local ssl_dir
  ssl_dir=$(mktemp -d)
  openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout "$ssl_dir/privkey.pem" \
    -out "$ssl_dir/fullchain.pem" \
    -subj "/CN=test.local" -batch >/dev/null 2>&1

  local rc=0
  if [[ -f "$security_headers" ]]; then
    docker run --rm \
      -v "$nginx_conf:/etc/nginx/conf.d/default.conf:ro" \
      -v "$security_headers:/etc/nginx/conf.d/security-headers.inc:ro" \
      -v "$ssl_dir:/etc/nginx/ssl:ro" \
      "$nginx_image" \
      nginx -t || rc=$?
  else
    docker run --rm \
      -v "$nginx_conf:/etc/nginx/conf.d/default.conf:ro" \
      -v "$ssl_dir:/etc/nginx/ssl:ro" \
      "$nginx_image" \
      nginx -t || rc=$?
  fi
  rm -rf "$ssl_dir"
  return "$rc"
}

FRONTENDS="$(projx_dirs_of_type vitejs "$REPO_ROOT" || true)"
if [[ -z "$FRONTENDS" ]]; then
  echo "validate-nginx-config: no vitejs frontend component — nothing to validate"
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

rc=0
while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  validate_frontend_dir "$REPO_ROOT/$rel" || rc=$?
done <<EOF
$FRONTENDS
EOF
exit "$rc"
