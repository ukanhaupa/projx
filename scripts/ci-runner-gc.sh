#!/usr/bin/env bash
# scripts/ci-runner-gc.sh — garbage-collect old per-run CI workspaces + Docker
# cruft on a self-hosted GitHub Actions runner VM.
#
# CI workflows check out into _work/<repo>/<repo>/run-<run_id>-<attempt>/ so two
# runs can never race over the same files. Without cleanup the runner VM fills
# up fast — each run leaves 1–2 GB of source/node_modules behind, plus deploy
# builds pile Docker layers and BuildKit cache locally even when cache-to=registry
# is used.
#
# Install on the EC2 runner VM as a daily cron:
#   sudo cp scripts/ci-runner-gc.sh /usr/local/bin/ci-runner-gc.sh
#   sudo chmod +x /usr/local/bin/ci-runner-gc.sh
#   echo '0 3 * * * root /usr/local/bin/ci-runner-gc.sh >> /var/log/ci-runner-gc.log 2>&1' \
#     | sudo tee /etc/cron.d/ci-runner-gc
#
# Knobs:
#   KEEP_DAYS=2          — workspace folders modified within N days are kept
#   BUILDX_KEEP=20GB     — cap on local BuildKit cache size after prune
#   RUNNER_ROOT=/opt     — where the actions-runner-* dirs live
#
# What it does NOT touch: docker volumes (might hold persistent data), running
# containers, the runner's own _diag/ logs.
set -euo pipefail

KEEP_DAYS="${KEEP_DAYS:-2}"
BUILDX_KEEP="${BUILDX_KEEP:-20GB}"
RUNNER_ROOT="${RUNNER_ROOT:-/opt}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

before_kb=$(df -k "$RUNNER_ROOT" | awk 'NR==2 {print $4}')
echo "[$(ts)] ci-runner-gc: start, keep_days=$KEEP_DAYS, buildx_keep=$BUILDX_KEEP, root=$RUNNER_ROOT"

# 1. Workspace folders — every per-run checkout under any runner instance.
echo "[$(ts)] ci-runner-gc: pruning workspace folders older than ${KEEP_DAYS} days"
find "$RUNNER_ROOT"/actions-runner-*/_work/*/*/ \
  -maxdepth 1 -mindepth 1 -type d \
  -name 'run-*' \
  -mtime "+$KEEP_DAYS" \
  -print -exec rm -rf {} + 2>/dev/null || true

# 2. Docker — only meaningful if docker is installed on the runner VM.
if command -v docker >/dev/null 2>&1; then
  echo "[$(ts)] ci-runner-gc: pruning stopped containers"
  docker container prune -f 2>&1 | tail -1 || true

  echo "[$(ts)] ci-runner-gc: pruning dangling images (keeping tagged base images cached)"
  docker image prune -f 2>&1 | tail -1 || true

  echo "[$(ts)] ci-runner-gc: pruning BuildKit cache (cap: ${BUILDX_KEEP})"
  docker buildx prune -af --keep-storage "$BUILDX_KEEP" 2>&1 | tail -1 || true
else
  echo "[$(ts)] ci-runner-gc: docker not found, skipping image cleanup"
fi

after_kb=$(df -k "$RUNNER_ROOT" | awk 'NR==2 {print $4}')
freed_mb=$(( (after_kb - before_kb) / 1024 ))
echo "[$(ts)] ci-runner-gc: done, freed ~${freed_mb} MB"
