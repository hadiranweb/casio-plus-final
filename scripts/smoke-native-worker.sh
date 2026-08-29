#!/usr/bin/env bash
set -euo pipefail

cd /home/ubuntu/casio-plus
WORKER_PORT="${CASIOPLUS_WORKER_SMOKE_PORT:-8099}"
WORKER_SECRET='local-worker-smoke-secret-with-at-least-32-characters'
BODY_FILE="$(mktemp)"
SERVER_PID=''
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill -- -"$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$BODY_FILE"
}
trap cleanup EXIT

cat > "$BODY_FILE" <<'JSON'
{"schemaVersion":"business-diagnosis.v1","organizationId":"00000000-0000-4000-8000-000000000001","workspaceId":"00000000-0000-4000-8000-000000000002","actorId":"00000000-0000-4000-8000-000000000003","workItemId":"00000000-0000-4000-8000-000000000004","processRunId":"00000000-0000-4000-8000-000000000005","input":{"business":{"industry":"technology","size":"small"},"position":{"title":"Operations Lead","responsibilities":["operations"],"requiredCapabilities":["operations"]},"candidates":[]}}
JSON
SIGNATURE="$(openssl dgst -sha256 -hmac "$WORKER_SECRET" -hex "$BODY_FILE" | awk '{print $2}')"
setsid env NODE_ENV=production RUNTIME_SHARED_SECRET="$WORKER_SECRET" NATIVE_WORKER_PORT="$WORKER_PORT" node services/native-diagnosis-worker/dist/server.js > /tmp/casioplus-worker-smoke.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${WORKER_PORT}/healthz" >/dev/null; then break; fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${WORKER_PORT}/healthz" >/tmp/casioplus-worker-health.json
INVALID_STATUS="$(curl -sS -o /tmp/casioplus-worker-invalid.json -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H 'x-casioplus-runtime-signature: deadbeef' \
  -X POST "http://127.0.0.1:${WORKER_PORT}/execute" \
  --data-binary "@$BODY_FILE")"
test "$INVALID_STATUS" = '401'
curl -fsS \
  -H 'content-type: application/json' \
  -H "x-casioplus-runtime-signature: ${SIGNATURE}" \
  -X POST "http://127.0.0.1:${WORKER_PORT}/execute" \
  --data-binary "@$BODY_FILE" > /tmp/casioplus-worker-result.json
grep -q '"schemaVersion":"business-diagnosis.v1"' /tmp/casioplus-worker-result.json
grep -q '"candidateEvaluations":\[\]' /tmp/casioplus-worker-result.json
printf '%s\n' 'NATIVE_WORKER_STATUS=passed'
