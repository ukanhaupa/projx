#!/bin/sh
set -e

# DOMAIN is set via docker-compose env or defaults to localhost
DOMAIN="${DOMAIN:-localhost}"
SSL_DIR="/etc/nginx/ssl"
LIVE_DIR="/etc/letsencrypt/live"

resolve_real_cert_dir() {
  find "$LIVE_DIR" -maxdepth 1 -type d \( -name "$DOMAIN" -o -name "$DOMAIN-*" \) 2>/dev/null \
    | while IFS= read -r dir; do
        if [ -f "$dir/fullchain.pem" ] && [ -f "$dir/privkey.pem" ]; then
          echo "$dir"
        fi
      done \
    | sort -V \
    | tail -n 1
}

REAL_LE_DIR="$(resolve_real_cert_dir)"

if [ -n "$REAL_LE_DIR" ] && [ -f "$REAL_LE_DIR/fullchain.pem" ] && [ -f "$REAL_LE_DIR/privkey.pem" ]; then
  echo "Using Let's Encrypt cert for $DOMAIN"
  mkdir -p "$SSL_DIR"
  ln -sf "$REAL_LE_DIR/fullchain.pem" "$SSL_DIR/fullchain.pem"
  ln -sf "$REAL_LE_DIR/privkey.pem" "$SSL_DIR/privkey.pem"
else
  echo "No cert found — generating self-signed certificate for $DOMAIN"
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "$SSL_DIR/privkey.pem" \
    -out    "$SSL_DIR/fullchain.pem" \
    -subj   "/CN=$DOMAIN" 2>/dev/null
fi

exec nginx -g "daemon off;"
