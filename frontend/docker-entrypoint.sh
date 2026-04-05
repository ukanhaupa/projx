#!/bin/sh
set -e

# DOMAIN is set via docker-compose env or defaults to localhost
DOMAIN="${DOMAIN:-localhost}"
SSL_DIR="/etc/nginx/ssl"
LE_DIR="/etc/letsencrypt/live/$DOMAIN"

# If a real Let's Encrypt cert exists for this domain, symlink it
if [ -f "$LE_DIR/fullchain.pem" ] && [ -f "$LE_DIR/privkey.pem" ]; then
  echo "Using Let's Encrypt cert for $DOMAIN"
  mkdir -p "$SSL_DIR"
  ln -sf "$LE_DIR/fullchain.pem" "$SSL_DIR/fullchain.pem"
  ln -sf "$LE_DIR/privkey.pem"   "$SSL_DIR/privkey.pem"
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
