#!/bin/sh
set -e

export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

exec node server.js
