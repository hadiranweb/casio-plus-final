#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_URL="${CASIOPLUS_CORE_API_URL:-https://api.example.test}"
APP_PORT="${CASIOPLUS_APP_SMOKE_PORT:-4173}"
STUDIO_PORT="${CASIOPLUS_STUDIO_SMOKE_PORT:-4174}"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${PIDS[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

start_surface() {
  local surface="$1"
  local port="$2"
  local log_path="/tmp/casioplus-${surface}-remix-smoke.log"
  PORT="$port" CASIOPLUS_CORE_API_URL="$CORE_URL" \
    node "$ROOT/apps/${surface}/node_modules/@remix-run/serve/dist/cli.js" \
      "$ROOT/apps/${surface}/build/server/index.js" >"$log_path" 2>&1 &
  PIDS+=("$!")
}

start_surface app-web "$APP_PORT"
start_surface studio-web "$STUDIO_PORT"

check_surface() {
  local surface="$1"
  local port="$2"
  local html_path="/tmp/casioplus-${surface}-remix-smoke.html"
  curl --retry 15 --retry-connrefused --retry-delay 1 --fail --silent --show-error \
    "http://127.0.0.1:${port}/" -o "$html_path"
  test -s "$html_path"
  grep -q '<html lang="fa" dir="rtl">' "$html_path"
  grep -q 'Casioplus' "$html_path"
  grep -q "$CORE_URL" "$html_path"
  if grep -Eq 'SESSION_SECRET|DATABASE_URL|RUNTIME_SHARED_SECRET' "$html_path"; then
    echo "Secret marker found in ${surface} HTML" >&2
    return 1
  fi
  printf 'REMIX_SSR_SMOKE_PASS %s\n' "$surface"
}

check_surface app-web "$APP_PORT"
check_surface studio-web "$STUDIO_PORT"
