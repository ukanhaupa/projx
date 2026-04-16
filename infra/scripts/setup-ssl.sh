#!/usr/bin/env bash
# Provisions a Let's Encrypt certificate for a domain using Certbot.
# Usage: ./setup-ssl.sh <domain> [email]
#
# Prerequisites:
#   - Docker and docker compose must be running
#   - Port 80 must be accessible from the internet
#   - DNS for <domain> must point to this server's public IP
#
# The certificate is stored in the letsencrypt Docker volume and picked up
# automatically by the frontend container's docker-entrypoint.sh.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" ]]; then
  echo "Usage: $0 <domain> [email]"
  echo "  domain: The domain to provision a certificate for (e.g., app.example.com)"
  echo "  email:  Contact email for Let's Encrypt notifications (optional but recommended)"
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "error: $COMPOSE_FILE not found. Run this script from the project root."
  exit 1
fi

echo "Requesting Let's Encrypt certificate for $DOMAIN..."

CERTBOT_ARGS=(
  "certonly"
  "--webroot"
  "--webroot-path=/var/www/certbot"
  "--cert-name" "$DOMAIN"
  "--agree-tos"
  "--non-interactive"
  "-d" "$DOMAIN"
)

if [[ -n "$EMAIL" ]]; then
  CERTBOT_ARGS+=("--email" "$EMAIL")
else
  CERTBOT_ARGS+=("--register-unsafely-without-email")
fi

docker compose -f "$COMPOSE_FILE" run --rm certbot "${CERTBOT_ARGS[@]}"

echo "Restarting frontend to pick up new certificate..."
docker compose -f "$COMPOSE_FILE" exec frontend sh -c "
  SSL_DIR=/etc/nginx/ssl
  LE_DIR=/etc/letsencrypt/live/$DOMAIN
  if [ -f \"\$LE_DIR/fullchain.pem\" ]; then
    ln -sf \"\$LE_DIR/fullchain.pem\" \"\$SSL_DIR/fullchain.pem\"
    ln -sf \"\$LE_DIR/privkey.pem\" \"\$SSL_DIR/privkey.pem\"
    nginx -s reload
    echo 'Nginx reloaded with Let'\''s Encrypt certificate.'
  else
    echo 'error: Certificate files not found after certbot run.'
    exit 1
  fi
"

echo "SSL certificate provisioned for $DOMAIN."
echo "Auto-renewal is handled by the certbot service (enable with: docker compose --profile ssl up -d)."
