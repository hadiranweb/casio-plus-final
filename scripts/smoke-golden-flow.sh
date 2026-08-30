#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(dirname "$SCRIPT_DIR")"

: "${DATABASE_URL:=postgresql://postgres:postgres@127.0.0.1:5432/casioplus_test}"
export DATABASE_URL
export SESSION_SECRET="${SESSION_SECRET:-local-smoke-session-secret-with-at-least-32-chars}"
export RUNTIME_SHARED_SECRET="${RUNTIME_SHARED_SECRET:-local-smoke-runtime-secret-with-at-least-32-chars}"
export ALLOW_DEV_TENANT_HEADERS=false
export NODE_ENV=development

SMOKE_PORT="${CASIOPLUS_SMOKE_PORT:-8095}"
WORKER_PORT="${CASIOPLUS_WORKER_SMOKE_PORT:-8096}"
export PORT="$SMOKE_PORT"
export NATIVE_WORKER_PORT="$WORKER_PORT"
export NATIVE_WORKER_URL="http://127.0.0.1:${WORKER_PORT}"

SERVER_PID=''
WORKER_PID=''
COOKIE_JAR="$(mktemp)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    printf '%s\n' '--- Golden Flow worker log ---' >&2
    cat "$TMP_DIR/worker.log" >&2 2>/dev/null || true
    printf '%s\n' '--- Golden Flow core log ---' >&2
    cat "$TMP_DIR/core.log" >&2 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill -- -"$SERVER_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$WORKER_PID" ]]; then
    kill -- -"$WORKER_PID" 2>/dev/null || true
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  rm -f "$COOKIE_JAR"
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pnpm db:migrate >/dev/null
pnpm build:core >/dev/null
pnpm build:worker >/dev/null

setsid env NODE_ENV=production RUNTIME_SHARED_SECRET="$RUNTIME_SHARED_SECRET" \
  NATIVE_WORKER_PORT="$WORKER_PORT" node services/native-diagnosis-worker/dist/server.js \
  >"$TMP_DIR/worker.log" 2>&1 &
WORKER_PID=$!
for _ in $(seq 1 40); do
  if curl -fsS "${NATIVE_WORKER_URL}/healthz" >/dev/null; then break; fi
  sleep 0.25
done
curl -fsS "${NATIVE_WORKER_URL}/healthz" >"$TMP_DIR/worker-health.json"

setsid node services/core-api/dist/index.js >"$TMP_DIR/core.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${SMOKE_PORT}/healthz" >/dev/null; then break; fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:${SMOKE_PORT}/healthz" >"$TMP_DIR/core-health.json"

BASE_URL="http://127.0.0.1:${SMOKE_PORT}"
RUN_SUFFIX="${CASIOPLUS_SMOKE_SUFFIX:-$(date +%s%N)}"
EMAIL="golden-${RUN_SUFFIX}@example.test"
PASSWORD='Golden-Flow-Password-2026!'

jq -n \
  --arg email "$EMAIL" \
  --arg password "$PASSWORD" \
  --arg organizationSlug "golden-${RUN_SUFFIX}" \
  '{email:$email,password:$password,displayName:"Golden Flow Owner",organizationName:"Golden Flow Organization",organizationSlug:$organizationSlug,workspaceName:"Golden Workspace",workspaceSlug:"golden-workspace"}' \
  >"$TMP_DIR/register-payload.json"
curl -fsS -c "$COOKIE_JAR" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/register-payload.json" \
  "$BASE_URL/api/v1/auth/register" >"$TMP_DIR/register.json"
CSRF_TOKEN="$(jq -er '.csrfToken' "$TMP_DIR/register.json")"
AUTH=(-b "$COOKIE_JAR" -H "x-casioplus-csrf: ${CSRF_TOKEN}")

curl -fsS -b "$COOKIE_JAR" "$BASE_URL/api/v1/auth/session" >"$TMP_DIR/session.json"
jq -e '.context.role == "owner"' "$TMP_DIR/session.json" >/dev/null
ACTOR_ID="$(jq -er '.context.actorId' "$TMP_DIR/session.json")"

curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"title":"Golden governed decision","intent":"Validate the complete canonical lifecycle"}' \
  "$BASE_URL/api/v1/work-items" >"$TMP_DIR/work.json"
WORK_ID="$(jq -er '.id' "$TMP_DIR/work.json")"

jq -n --arg key "golden-flow-${RUN_SUFFIX}" \
  '{key:$key,name:"Golden governed flow"}' >"$TMP_DIR/flow-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/flow-payload.json" \
  "$BASE_URL/api/v1/flows" >"$TMP_DIR/flow.json"
FLOW_ID="$(jq -er '.id' "$TMP_DIR/flow.json")"

curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"inputSchema":{"type":"object","required":["business"]},"outputSchema":{"type":"object","required":["jobProfile"]},"definition":{"name":"business-diagnosis-v1","axes":["capabilityFit","experienceFit","contextFit","motivationFit","riskAndReadiness"]},"runtimeBinding":"native"}' \
  "$BASE_URL/api/v1/flows/${FLOW_ID}/versions" >"$TMP_DIR/version.json"
VERSION_ID="$(jq -er '.id' "$TMP_DIR/version.json")"
curl -fsS "${AUTH[@]}" -X POST \
  "$BASE_URL/api/v1/flows/${FLOW_ID}/versions/${VERSION_ID}/publish" \
  >"$TMP_DIR/publish.json"
jq -e '.flow.status == "published"' "$TMP_DIR/publish.json" >/dev/null

IDEMPOTENCY_KEY="golden-flow-submit-${RUN_SUFFIX}"
jq -n \
  --arg workItemId "$WORK_ID" \
  --arg flowId "$FLOW_ID" \
  --arg flowVersionId "$VERSION_ID" \
  --arg idempotencyKey "$IDEMPOTENCY_KEY" \
  '{workItemId:$workItemId,flowId:$flowId,flowVersionId:$flowVersionId,idempotencyKey:$idempotencyKey,input:{business:{industry:"technology",size:"small"},position:{title:"Operations Lead",responsibilities:["build hiring process"]},candidates:[{id:"candidate-2",experience:["operations"]}]}}' \
  >"$TMP_DIR/run-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/run-payload.json" \
  "$BASE_URL/api/v1/process-runs" >"$TMP_DIR/run.json"
RUN_ID="$(jq -er '.run.id' "$TMP_DIR/run.json")"

curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  -d "{\"type\":\"analysis.started\",\"payload\":{\"worker\":\"native-diagnosis\"},\"idempotencyKey\":\"golden-flow-event-${RUN_SUFFIX}\"}" \
  "$BASE_URL/api/v1/process-runs/${RUN_ID}/events" >"$TMP_DIR/event.json"
curl -fsS "${AUTH[@]}" -X POST \
  "$BASE_URL/api/v1/process-runs/${RUN_ID}/execute" >"$TMP_DIR/execution.json"
jq -e '.run.status == "succeeded" and .result.schemaVersion == "business-diagnosis.v1"' \
  "$TMP_DIR/execution.json" >/dev/null

SOURCE_HASH="$(printf '%s' "${RUN_ID}:report:v1" | sha256sum | cut -d' ' -f1)"
jq -n \
  --arg processRunId "$RUN_ID" \
  --arg idempotencyKey "golden-artifact-${RUN_SUFFIX}" \
  --arg sourceHash "$SOURCE_HASH" \
  '{processRunId:$processRunId,artifactType:"json",contentType:"application/json",checksum:"golden-smoke-checksum",sourceHash:$sourceHash,sourceVersion:"v1",sizeBytes:128,idempotencyKey:$idempotencyKey}' \
  >"$TMP_DIR/artifact-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/artifact-payload.json" \
  "$BASE_URL/api/v1/artifacts" >"$TMP_DIR/artifact.json"
ARTIFACT_ID="$(jq -er '.artifact.id' "$TMP_DIR/artifact.json")"
jq -e '.artifact.status == "available" and .artifact.integrityStatus == "verified"' \
  "$TMP_DIR/artifact.json" >/dev/null

jq -n --arg workItemId "$WORK_ID" --arg processRunId "$RUN_ID" --arg actorId "$ACTOR_ID" \
  '{workItemId:$workItemId,processRunId:$processRunId,type:"diagnostic_observation",title:"Hiring process observation",summary:"The organization needs an operations lead with evidence-backed process ownership.",payload:{fiveAxis:{capabilityFit:0.8,experienceFit:0.7,contextFit:0.75,motivationFit:0.65,riskAndReadiness:0.7}},provenance:{sourceType:"process_run",sourceId:$processRunId,actorId:$actorId}}' \
  >"$TMP_DIR/record-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/record-payload.json" \
  "$BASE_URL/api/v1/semantic-records" >"$TMP_DIR/record.json"
RECORD_ID="$(jq -er '.record.id' "$TMP_DIR/record.json")"

jq -n --arg workItemId "$WORK_ID" --arg processRunId "$RUN_ID" --arg artifactId "$ARTIFACT_ID" --arg actorId "$ACTOR_ID" \
  '{workItemId:$workItemId,processRunId:$processRunId,type:"output_produced",title:"Structured report produced",summary:"The JSON report artifact was registered for the completed diagnosis.",payload:{artifactId:$artifactId,contentType:"application/json"},provenance:{sourceType:"artifact",sourceId:$artifactId,actorId:$actorId}}' \
  >"$TMP_DIR/output-record-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/output-record-payload.json" \
  "$BASE_URL/api/v1/semantic-records" >"$TMP_DIR/output-record.json"
OUTPUT_RECORD_ID="$(jq -er '.record.id' "$TMP_DIR/output-record.json")"

jq -n \
  --arg semanticRecordId "$RECORD_ID" \
  --arg processRunId "$RUN_ID" \
  --arg outputRecordId "$OUTPUT_RECORD_ID" \
  --arg artifactId "$ARTIFACT_ID" \
  '{semanticRecordId:$semanticRecordId,processRunId:$processRunId,subject:"Operations lead hiring",claimType:"verified_fact",content:{finding:"Process ownership is a hiring priority"},evidence:[$semanticRecordId,$outputRecordId,$artifactId],confidence:0.86}' \
  >"$TMP_DIR/claim-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/claim-payload.json" \
  "$BASE_URL/api/v1/knowledge-claims" >"$TMP_DIR/claim.json"
CLAIM_ID="$(jq -er '.claim.id' "$TMP_DIR/claim.json")"

curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  -d '{"decision":"approve","rationale":"Evidence is sufficient for workspace-level reuse."}' \
  "$BASE_URL/api/v1/knowledge-claims/${CLAIM_ID}/review" >"$TMP_DIR/review.json"
REVIEW_ID="$(jq -er '.review.id' "$TMP_DIR/review.json")"

jq -n --arg reviewId "$REVIEW_ID" \
  '{reviewId:$reviewId,targetKind:"verified_fact",title:"Hiring process ownership priority",content:{finding:"Operations ownership is a priority"},sensitivity:"workspace",rationale:"Approved for workspace governed retrieval."}' \
  >"$TMP_DIR/promotion-payload.json"
curl -fsS "${AUTH[@]}" -H 'content-type: application/json' \
  --data-binary "@$TMP_DIR/promotion-payload.json" \
  "$BASE_URL/api/v1/knowledge-claims/${CLAIM_ID}/promote" >"$TMP_DIR/memory.json"
MEMORY_ID="$(jq -er '.memory.id' "$TMP_DIR/memory.json")"

curl -fsS -b "$COOKIE_JAR" \
  "$BASE_URL/api/v1/memory/search?query=operations%20priority&purpose=golden-flow.validation" \
  >"$TMP_DIR/search.json"
jq -e --arg memoryId "$MEMORY_ID" '.results | any(.id == $memoryId)' "$TMP_DIR/search.json" >/dev/null

curl -fsS -b "$COOKIE_JAR" \
  "$BASE_URL/api/v1/memory/graph?purpose=golden-flow.validation&limit=20" \
  >"$TMP_DIR/graph.json"
jq -e --arg memoryId "$MEMORY_ID" \
  '.nodes | any(.entityId == $memoryId and .entityType == "memory")' "$TMP_DIR/graph.json" >/dev/null

printf '%s\n' 'GOLDEN_FLOW_STATUS=passed'
printf '%s\n' "work=${WORK_ID} flow=${FLOW_ID} version=${VERSION_ID} run=${RUN_ID} artifact=${ARTIFACT_ID} record=${RECORD_ID} claim=${CLAIM_ID} review=${REVIEW_ID} memory=${MEMORY_ID}"
