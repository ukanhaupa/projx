#!/bin/bash
# Issue a real Let's Encrypt cert and replace the self-signed one.
# Run this ONCE on the host after first deployment.
#
# Usage: ./scripts/setup-ssl.sh <domain> <email>
# Example: ./scripts/setup-ssl.sh example.com admin@example.com

set -e

DOMAIN="${1:?Usage: ./setup-ssl.sh <domain> <email>}"
EMAIL="${2:?Usage: ./setup-ssl.sh <domain> <email>}"
BASE_DOMAIN="${DOMAIN#www.}"
DOMAIN="$BASE_DOMAIN"
WWW_DOMAIN="www.$BASE_DOMAIN"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"

echo "=== Pre-flight checks ==="

if ! docker compose -f "$COMPOSE_FILE" ps --status running | grep -q frontend; then
  echo "ERROR: frontend container is not running. Run 'docker compose up -d' first."
  exit 1
fi

echo "Checking DNS for $DOMAIN..."
RESOLVED_IP=$(dig +short "$DOMAIN" 2>/dev/null | tail -1)
MY_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null)
if [ -z "$RESOLVED_IP" ]; then
  echo "ERROR: $DOMAIN does not resolve. Set up DNS first."
  exit 1
fi
if [ -n "$MY_IP" ] && [ "$RESOLVED_IP" != "$MY_IP" ]; then
  echo "WARNING: $DOMAIN resolves to $RESOLVED_IP but this server is $MY_IP"
  read -p "Continue anyway? (y/N) " -r
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi
echo "DNS OK: $DOMAIN -> $RESOLVED_IP"

CERT_DOMAINS=("$DOMAIN")
WWW_RESOLVED=$(dig +short "$WWW_DOMAIN" 2>/dev/null | tail -1)
if [ -n "$WWW_RESOLVED" ]; then
  CERT_DOMAINS+=("$WWW_DOMAIN")
  echo "DNS OK: $WWW_DOMAIN -> $WWW_RESOLVED"
else
  echo "WARNING: $WWW_DOMAIN does not resolve yet; issuing cert for $DOMAIN only."
fi

echo "Checking port 80..."
curl -s --max-time 5 -o /dev/null "http://$DOMAIN/.well-known/acme-challenge/test" 2>/dev/null || \
  echo "WARNING: Could not reach http://$DOMAIN — ensure port 80 is open."

echo "=== Issuing certificate for ${CERT_DOMAINS[*]} ==="

COMPOSE_PROJECT=$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null \
  || basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')

LE_VOLUME=$(docker volume ls --format '{{.Name}}' | grep -E "${COMPOSE_PROJECT}.*letsencrypt" | head -1)
CW_VOLUME=$(docker volume ls --format '{{.Name}}' | grep -E "${COMPOSE_PROJECT}.*certbot" | head -1)

if [ -z "$LE_VOLUME" ] || [ -z "$CW_VOLUME" ]; then
  echo "ERROR: Could not find Docker volumes (*letsencrypt and *certbot-www)."
  docker volume ls --format '{{.Name}}' | grep -i "$COMPOSE_PROJECT" || echo "(none)"
  exit 1
fi

echo "Using volumes: $LE_VOLUME, $CW_VOLUME"

CERTBOT_DOMAIN_ARGS=()
for cert_domain in "${CERT_DOMAINS[@]}"; do
  CERTBOT_DOMAIN_ARGS+=("-d" "$cert_domain")
done

if docker run --rm \
  -v "$LE_VOLUME:/etc/letsencrypt" \
  -v "$CW_VOLUME:/var/www/certbot" \
  certbot/certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    "${CERTBOT_DOMAIN_ARGS[@]}" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    --keep-until-expiring; then

  echo "=== Restarting frontend to pick up new cert ==="
  docker compose -f "$COMPOSE_FILE" restart frontend
else
  echo "WARNING: Certbot failed. Self-signed cert remains active."
fi

echo "=== Setting up auto-renewal cron ==="
CRON_CMD="0 3 * * * docker run --rm -v $LE_VOLUME:/etc/letsencrypt -v $CW_VOLUME:/var/www/certbot certbot/certbot renew --quiet && docker compose -f $COMPOSE_FILE restart frontend"
EXISTING=$(crontab -l 2>/dev/null || true)
echo "$EXISTING" | grep -v "certbot renew" | { cat; echo "$CRON_CMD"; } | crontab -

echo ""
echo "=== Done ==="
echo "Certificate issued for: ${CERT_DOMAINS[*]}"
echo "https://$DOMAIN is now secured with Let's Encrypt."
echo "Auto-renewal runs daily at 3 AM."
