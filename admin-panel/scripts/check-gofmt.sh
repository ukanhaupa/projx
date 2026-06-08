#!/usr/bin/env bash
set -euo pipefail

unformatted="$(gofmt -l .)"
if [ -n "$unformatted" ]; then
  echo "gofmt needs to run on:"
  echo "$unformatted"
  exit 1
fi
