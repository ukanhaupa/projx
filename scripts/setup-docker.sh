#!/usr/bin/env bash
# Install Docker Engine + Compose plugin on Ubuntu and add the user to the
# `docker` group so `sudo` is no longer needed for docker commands.
#
# Usage: ./scripts/setup-docker.sh [username]
#   - username defaults to the invoking user ($SUDO_USER, else $USER)
#   - Run without sudo: the script will elevate with sudo where needed.

set -euo pipefail

TARGET_USER="${1:-${SUDO_USER:-$USER}}"

if ! id "$TARGET_USER" >/dev/null 2>&1; then
  echo "ERROR: user '$TARGET_USER' does not exist on this host."
  exit 1
fi

if [ ! -r /etc/os-release ]; then
  echo "ERROR: /etc/os-release not found; this script supports Ubuntu only."
  exit 1
fi
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  echo "ERROR: detected '$ID'; this script supports Ubuntu only."
  exit 1
fi

sudo -v

echo "=== Ensuring 2G swap ==="
SWAPFILE="/swapfile"
if swapon --show=NAME --noheadings | grep -qx "$SWAPFILE"; then
  echo "Swap already active: $(swapon --show=NAME,SIZE --noheadings | tr -s ' ')"
else
  if [ ! -f "$SWAPFILE" ]; then
    sudo fallocate -l 2G "$SWAPFILE" 2>/dev/null \
      || sudo dd if=/dev/zero of="$SWAPFILE" bs=1M count=2048 status=progress
    sudo chmod 600 "$SWAPFILE"
    sudo mkswap "$SWAPFILE" >/dev/null
  fi
  sudo swapon "$SWAPFILE"
  if ! grep -qE "^${SWAPFILE}\s" /etc/fstab; then
    echo "${SWAPFILE} none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
  fi
  echo "Swap enabled: $(swapon --show=NAME,SIZE --noheadings | tr -s ' ')"
fi

if [ ! -f /etc/sysctl.d/99-swap.conf ]; then
  echo "vm.swappiness=10" | sudo tee /etc/sysctl.d/99-swap.conf >/dev/null
  sudo sysctl --quiet -w vm.swappiness=10
fi

echo "=== Installing Docker Engine ==="
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg

  sudo install -m 0755 -d /etc/apt/keyrings
  if [ ! -s /etc/apt/keyrings/docker.asc ]; then
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
  fi

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

  sudo apt-get update -y
  sudo apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
else
  echo "Docker already installed: $(docker --version)"
fi

echo "=== Ensuring 'docker' group exists ==="
if ! getent group docker >/dev/null; then
  sudo groupadd docker
fi

echo "=== Adding '$TARGET_USER' to 'docker' group ==="
NEED_RELOGIN=0
if id -nG "$TARGET_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "'$TARGET_USER' is already in the 'docker' group."
else
  sudo usermod -aG docker "$TARGET_USER"
  NEED_RELOGIN=1
fi

echo "=== Enabling and starting Docker daemon ==="
sudo systemctl enable --now docker

echo "=== Versions ==="
sudo docker version --format 'Engine: {{.Server.Version}}'
sudo docker compose version

echo ""
echo "=== Done ==="
if [ "$NEED_RELOGIN" -eq 1 ]; then
  echo "'$TARGET_USER' was added to the 'docker' group."
  echo "Open a NEW shell (log out/in, or 'exec sg docker -c bash') to run"
  echo "docker without sudo. In this shell you'll still need sudo."
else
  echo "You can run docker without sudo."
fi
