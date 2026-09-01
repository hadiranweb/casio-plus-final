#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_URL="${CASIOPLUS_CORE_API_URL:-https://api.example.test}"
APP_PORT="${CASIOPLUS_APP_SMOKE_PORT:-4173}"
FORGE_PORT="${CASIOPLUS_FORGE_SMOKE_PORT:-4174}"
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

start_surface console-web "$APP_PORT"
start_surface forge-web "$FORGE_PORT"

assert_safe_html() {
  local surface="$1"
  local html_path="$2"
  test -s "$html_path"
  grep -q 'Casioplus' "$html_path"
  grep -q "$CORE_URL" "$html_path"
  if grep -Eq 'SESSION_SECRET|DATABASE_URL|RUNTIME_SHARED_SECRET' "$html_path"; then
    echo "Secret marker found in ${surface} HTML" >&2
    return 1
  fi
}

check_surface() {
  local surface="$1"
  local port="$2"
  local document_marker="$3"
  local html_path="/tmp/casioplus-${surface}-remix-smoke.html"
  curl --retry 15 --retry-connrefused --retry-delay 1 --fail --silent --show-error \
    "http://127.0.0.1:${port}/" -o "$html_path"
  assert_safe_html "$surface" "$html_path"
  grep -Fq "$document_marker" "$html_path"
  printf 'REMIX_SSR_SMOKE_PASS %s\n' "$surface"
}

check_console_persian_cookie() {
  local html_path="/tmp/casioplus-console-web-remix-smoke-fa.html"
  curl --fail --silent --show-error \
    --header 'Cookie: CASIOPLUS_LOCALE=fa' \
    "http://127.0.0.1:${APP_PORT}/" -o "$html_path"
  assert_safe_html 'console-web-fa' "$html_path"
  grep -Fq '<html lang="fa" dir="rtl" data-locale="fa">' "$html_path"
  if grep -Fq '<html lang="en" dir="ltr" data-locale="en">' "$html_path"; then
    echo 'English document marker leaked into Persian Console response' >&2
    return 1
  fi
  printf 'REMIX_SSR_SMOKE_PASS %s\n' 'console-web-fa'
}

check_surface console-web "$APP_PORT" '<html lang="en" dir="ltr" data-locale="en">'
check_console_persian_cookie
check_surface forge-web "$FORGE_PORT" '<html lang="fa" dir="rtl">'
