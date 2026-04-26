#!/usr/bin/env bash
set -e

git config core.hooksPath .githooks
echo "Git hooks configured."

cd fastapi && uv sync --all-extras && cd ..
echo "FastAPI dependencies installed."

cd fastify && pnpm install --frozen-lockfile && cd ..
echo "Fastify dependencies installed."

cd frontend && pnpm install --frozen-lockfile && cd ..
echo "Frontend dependencies installed."

cd e2e && pnpm install --frozen-lockfile && cd ..
echo "E2E dependencies installed."

if command -v flutter &>/dev/null; then
  cd mobile && flutter pub get && cd ..
  echo "Flutter dependencies installed."
else
  echo "Flutter SDK not installed — skipping mobile."
fi

cd cli && pnpm install --frozen-lockfile && cd ..
echo "CLI dependencies installed."

echo ""
echo "Done. Run 'docker compose -f docker-compose.dev.yml up' to start."
