#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"
DB_NAME='casioplus_ts_core_bootstrap'
TEST_DB_PASSWORD="$(openssl rand -hex 32)"
SERVER_PID=''
WORKER_PID=''
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill -- -"$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$WORKER_PID" ]]; then
    kill -- -"$WORKER_PID" 2>/dev/null || true
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE casioplus_test PASSWORD NULL;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE casioplus_test PASSWORD '${TEST_DB_PASSWORD}';" >/dev/null
export PGPASSWORD="$TEST_DB_PASSWORD"
export DATABASE_URL="postgresql://casioplus_test@127.0.0.1:5432/${DB_NAME}"
ORG_ID="$(psql -h 127.0.0.1 -U casioplus_test -d "$DB_NAME" -Atc 'SELECT id FROM organizations ORDER BY created_at LIMIT 1')"
WORKSPACE_ID="$(psql -h 127.0.0.1 -U casioplus_test -d "$DB_NAME" -Atc 'SELECT id FROM workspaces ORDER BY created_at LIMIT 1')"
ACTOR_ID="$(psql -h 127.0.0.1 -U casioplus_test -d "$DB_NAME" -Atc 'SELECT id FROM actors ORDER BY created_at LIMIT 1')"
FLOW_ID="$(psql -h 127.0.0.1 -U casioplus_test -d "$DB_NAME" -Atc 'SELECT id FROM flows ORDER BY created_at LIMIT 1')"
WORK_ID="$(psql -h 127.0.0.1 -U casioplus_test -d "$DB_NAME" -Atc 'SELECT id FROM work_items ORDER BY created_at LIMIT 1')"
export SESSION_SECRET='local-smoke-session-secret-with-at-least-32-chars'
export RUNTIME_SHARED_SECRET='local-smoke-runtime-secret-with-at-least-32-chars'
WORKER_PORT="${CASIOPLUS_WORKER_SMOKE_PORT:-8096}"
export NATIVE_WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
SESSION_TOKEN="$(SESSION_SECRET="$SESSION_SECRET" ORGANIZATION_ID="$ORG_ID" WORKSPACE_ID="$WORKSPACE_ID" ACTOR_ID="$ACTOR_ID" pnpm auth:issue-dev | tail -n 1)"
AUTH_HEADER=(-H "authorization: Bearer ${SESSION_TOKEN}")
export ALLOW_DEV_TENANT_HEADERS=false
export NODE_ENV=development
pnpm --filter @casioplus/native-diagnosis-worker build >/tmp/casioplus-native-worker-build.log
setsid env NODE_ENV=production RUNTIME_SHARED_SECRET="$RUNTIME_SHARED_SECRET" NATIVE_WORKER_PORT="$WORKER_PORT" node services/native-diagnosis-worker/dist/server.js >/tmp/casioplus-native-worker-smoke.log 2>&1 &
WORKER_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS "${NATIVE_WORKER_URL}/healthz" >/dev/null; then break; fi
  sleep 0.5
done
curl -fsS "${NATIVE_WORKER_URL}/healthz" >/tmp/casioplus-golden-worker-health.json
SMOKE_PORT="${CASIOPLUS_SMOKE_PORT:-8095}"
export PORT="$SMOKE_PORT"
setsid pnpm dev:core > /tmp/casioplus-golden-smoke.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:${SMOKE_PORT}/healthz >/dev/null; then break; fi
  sleep 0.5
done
curl -fsS http://127.0.0.1:${SMOKE_PORT}/healthz >/tmp/casioplus-golden-health.json

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/flows/${FLOW_ID}/versions \
  -H 'content-type: application/json' \
  -d '{"inputSchema":{"type":"object","required":["business"]},"outputSchema":{"type":"object","required":["jobProfile"]},"definition":{"name":"business-diagnosis-v1","axes":["capabilityFit","experienceFit","contextFit","motivationFit","riskAndReadiness"]},"runtimeBinding":"native"}' > /tmp/casioplus-golden-version.json
VERSION_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-version.json | head -1 | cut -d'"' -f4)"
test -n "$VERSION_ID"
curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/flows/${FLOW_ID}/versions/${VERSION_ID}/publish > /tmp/casioplus-golden-publish.json

RUN_SUFFIX="${CASIOPLUS_SMOKE_SUFFIX:-$(date +%s%N)}"
IDEMPOTENCY_KEY="golden-flow-submit-${RUN_SUFFIX}"
EVENT_IDEMPOTENCY_KEY="golden-flow-event-${RUN_SUFFIX}"
curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/process-runs \
  -H 'content-type: application/json' \
  -d "{\"workItemId\":\"${WORK_ID}\",\"flowId\":\"${FLOW_ID}\",\"flowVersionId\":\"${VERSION_ID}\",\"idempotencyKey\":\"${IDEMPOTENCY_KEY}\",\"input\":{\"business\":{\"industry\":\"technology\",\"size\":\"small\"},\"position\":{\"title\":\"Operations Lead\",\"responsibilities\":[\"build hiring process\"]},\"candidates\":[{\"id\":\"candidate-2\",\"experience\":[\"operations\"]}]}}" > /tmp/casioplus-golden-run.json
RUN_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-run.json | head -1 | cut -d'"' -f4)"
test -n "$RUN_ID"

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/process-runs/${RUN_ID}/events \
  -H 'content-type: application/json' \
  -d "{\"type\":\"analysis.started\",\"payload\":{\"worker\":\"native-diagnosis\"},\"idempotencyKey\":\"${EVENT_IDEMPOTENCY_KEY}\"}" > /tmp/casioplus-golden-event.json

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/process-runs/${RUN_ID}/execute \
  -H 'content-type: application/json' > /tmp/casioplus-golden-execution.json
grep -q '"schemaVersion":"business-diagnosis.v1"' /tmp/casioplus-golden-execution.json
grep -q '"candidateEvaluations"' /tmp/casioplus-golden-execution.json
grep -q '"status":"succeeded"' /tmp/casioplus-golden-execution.json
curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/artifacts \
  -H 'content-type: application/json' \
  -d "{\"processRunId\":\"${RUN_ID}\",\"artifactType\":\"json\",\"objectKey\":\"golden/${RUN_ID}/report.json\",\"contentType\":\"application/json\",\"checksum\":\"smoke-checksum\"}" > /tmp/casioplus-golden-artifact.json
ARTIFACT_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-artifact.json | head -1 | cut -d'"' -f4)"
test -n "$ARTIFACT_ID"
curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/semantic-records \
  -H 'content-type: application/json' \
  -d "{\"workItemId\":\"${WORK_ID}\",\"processRunId\":\"${RUN_ID}\",\"type\":\"diagnostic_observation\",\"title\":\"Hiring process observation\",\"summary\":\"The organization needs an operations lead with evidence-backed process ownership.\",\"payload\":{\"fiveAxis\":{\"capabilityFit\":0.8,\"experienceFit\":0.7,\"contextFit\":0.75,\"motivationFit\":0.65,\"riskAndReadiness\":0.7}},\"provenance\":{\"sourceType\":\"process_run\",\"sourceId\":\"${RUN_ID}\",\"actorId\":\"${ACTOR_ID}\"}}" > /tmp/casioplus-golden-record.json
RECORD_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-record.json | head -1 | cut -d'"' -f4)"
test -n "$RECORD_ID"
curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/semantic-records \
  -H 'content-type: application/json' \
  -d "{\"workItemId\":\"${WORK_ID}\",\"processRunId\":\"${RUN_ID}\",\"type\":\"output_produced\",\"title\":\"Structured report produced\",\"summary\":\"The JSON report artifact was registered for the completed diagnosis.\",\"payload\":{\"artifactId\":\"${ARTIFACT_ID}\",\"contentType\":\"application/json\"},\"provenance\":{\"sourceType\":\"artifact\",\"sourceId\":\"${ARTIFACT_ID}\",\"actorId\":\"${ACTOR_ID}\"}}" > /tmp/casioplus-golden-output-record.json
OUTPUT_RECORD_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-output-record.json | head -1 | cut -d'"' -f4)"
test -n "$OUTPUT_RECORD_ID"

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/knowledge-claims \
  -H 'content-type: application/json' \
  -d "{\"semanticRecordId\":\"${RECORD_ID}\",\"processRunId\":\"${RUN_ID}\",\"subject\":\"Operations lead hiring\",\"claimType\":\"verified_fact\",\"content\":{\"finding\":\"Process ownership is a hiring priority\"},\"evidence\":[\"${RECORD_ID}\",\"${OUTPUT_RECORD_ID}\",\"${ARTIFACT_ID}\"],\"confidence\":0.86}" > /tmp/casioplus-golden-claim.json
CLAIM_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-claim.json | head -1 | cut -d'"' -f4)"
test -n "$CLAIM_ID"

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/knowledge-claims/${CLAIM_ID}/review \
  -H 'content-type: application/json' \
  -d '{"decision":"approve","rationale":"Evidence is sufficient for workspace-level reuse."}' > /tmp/casioplus-golden-review.json
REVIEW_ID="$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/casioplus-golden-review.json | head -1 | cut -d'"' -f4)"
test -n "$REVIEW_ID"

curl -fsS "${AUTH_HEADER[@]}" -X POST http://127.0.0.1:${SMOKE_PORT}/api/v1/knowledge-claims/${CLAIM_ID}/promote \
  -H 'content-type: application/json' \
  -d "{\"reviewId\":\"${REVIEW_ID}\",\"targetKind\":\"verified_fact\",\"title\":\"Hiring process ownership priority\",\"content\":{\"finding\":\"Operations ownership is a priority\"},\"sensitivity\":\"workspace\",\"rationale\":\"Approved for workspace governed retrieval.\"}" > /tmp/casioplus-golden-memory.json
curl -fsS "${AUTH_HEADER[@]}" "http://127.0.0.1:${SMOKE_PORT}/api/v1/memory/search?query=operations%20priority\&purpose=golden-flow.validation" > /tmp/casioplus-golden-search.json

printf '%s\n' 'GOLDEN_FLOW_STATUS=passed'
printf '%s\n' "flow=${FLOW_ID} version=${VERSION_ID} run=${RUN_ID} artifact=${ARTIFACT_ID} record=${RECORD_ID} output_record=${OUTPUT_RECORD_ID} claim=${CLAIM_ID} review=${REVIEW_ID}"
printf '%s\n' 'SEARCH_RESULT='
cat /tmp/casioplus-golden-search.json
