#!/usr/bin/env bash

projx_marker_type() {
  local marker="$1" t=""
  if [ -f "$marker" ]; then
    t=$(sed -n 's/.*"component"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$marker" 2>/dev/null | head -1)
    if [ -z "$t" ]; then
      t=$(tr -d ' \t\r\n' <"$marker" 2>/dev/null)
    fi
  fi
  printf '%s' "$t"
}

projx_dirs_of_type() {
  local want="$1" base="${2:-$ROOT_DIR}" d name t
  local known=" fastapi fastify express go rust laravel vitejs nextjs mobile e2e infra admin-panel "
  for d in "$base"/*/; do
    [ -d "$d" ] || continue
    name=${d%/}
    name=${name##*/}
    t=$(projx_marker_type "$base/$name/.projx-component")
    if [ -z "$t" ]; then
      case "$known" in
        *" $name "*) t="$name" ;;
      esac
    fi
    if [ "$t" = "$want" ]; then
      printf '%s\n' "$name"
    fi
  done | sort
}

projx_first_dir_of_type() { projx_dirs_of_type "$1" "${2:-$ROOT_DIR}" | head -1; }

projx_has_type() { [ -n "$(projx_first_dir_of_type "$1" "${2:-$ROOT_DIR}")" ]; }

projx_primary_backend_kind() {
  local base="${1:-$ROOT_DIR}" k
  for k in fastapi fastify express go rust laravel; do
    if projx_has_type "$k" "$base"; then
      printf '%s' "$k"
      return 0
    fi
  done
  return 1
}

projx_primary_frontend_dir() {
  local base="${1:-$ROOT_DIR}" k d
  for k in vitejs nextjs; do
    d=$(projx_first_dir_of_type "$k" "$base")
    if [ -n "$d" ]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}
