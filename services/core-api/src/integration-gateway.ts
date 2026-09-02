import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { integrationIngressSchema } from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';
import { materializeScheduledTranslationProposal } from './translation-proposal-schedules.js';
import { applyTranslationRepositoryWebhookEvent } from './translation-repository-sync.js';

export type IntegrationSecretMap = Readonly<Record<string, string>>;

export type RawBodyRequest = Request & { rawBody?: Buffer };

export class IntegrationGatewayError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'IntegrationGatewayError';
  }
}

const adapterResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  executionId: z.string().trim().min(1).max(200).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  errorCode: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{1,127}$/)
    .optional(),
  runtime: z.enum(['n8n', 'open-webui', 'openclaw']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

const meteringSnapshotSchema = z.object({
  bindingId: z.string().uuid(),
  pricingVersionId: z.string().uuid(),
  runtime: z.enum(['open-webui', 'openclaw']),
  operation: z.enum([
    'model.chat.complete',
    'action.send_message',
    'action.repository.open_translation_pr',
  ]),
  resourceKey: z.string().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  payer: z.enum(['casioplus', 'customer', 'external_product', 'shared']),
  directUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  inputTokenUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  outputTokenUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  allocatedSharedCost: z.string().regex(/^\d+(\.\d{1,8})?$/),
  billableMultiplier: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

const translationPullRequestResultSchema = z
  .object({
    changeSetId: z.string().uuid(),
    repositoryFullName: z.literal('hadiranweb/casio-plus-final'),
    branchRef: z.string().regex(/^casioplus\/translation\/[a-f0-9-]{36}$/),
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z
      .string()
      .regex(/^https:\/\/github\.com\/hadiranweb\/casio-plus-final\/pull\/[0-9]+$/),
    pullRequestHeadSha: z.string().regex(/^[a-f0-9]{40}$/),
  })
  .strict();

const outboxResultSchema = z.object({
  status: z.enum(['dispatched', 'retry', 'dead_letter']),
  errorCode: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{1,127}$/)
    .optional(),
  retryAfterSeconds: z.number().int().min(1).max(3600).optional(),
  adapterResult: adapterResultSchema.optional(),
});

function requiredHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim();
  if (!value) throw new IntegrationGatewayError(401, `missing_${name.replaceAll('-', '_')}`);
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function destinationForOperation(operation: string): 'n8n' | 'open-webui' | 'openclaw' {
  if (operation.startsWith('n8n.')) return 'n8n';
  if (operation.startsWith('model.')) return 'open-webui';
  if (operation.startsWith('action.')) return 'openclaw';
  throw new IntegrationGatewayError(400, 'unsupported_operation');
}

function dispatcherAuthorized(request: Request, dispatcherSecret: string | undefined): boolean {
  const provided = request.header('x-casioplus-dispatcher-secret')?.trim();
  return Boolean(
    dispatcherSecret &&
    dispatcherSecret.length >= 32 &&
    provided &&
    safeEqual(provided, dispatcherSecret),
  );
}

export function mountIntegrationGateway(
  app: Express,
  pool: Pool,
  secrets: IntegrationSecretMap,
  dispatcherSecret?: string,
): void {
  app.post('/api/v1/integrations/events', async (request, response, next) => {
    try {
      const externalAppKey = requiredHeader(request, 'x-casioplus-external-app');
      const keyId = requiredHeader(request, 'x-casioplus-key-id');
      const nonce = requiredHeader(request, 'x-casioplus-nonce');
      const timestampText = requiredHeader(request, 'x-casioplus-timestamp');
      const providedSignature = requiredHeader(request, 'x-casioplus-signature');
      if (!/^[A-Za-z0-9._-]{3,100}$/.test(keyId) || !/^[A-Za-z0-9._:-]{16,200}$/.test(nonce)) {
        throw new IntegrationGatewayError(400, 'invalid_signature_metadata');
      }
      const timestamp = Number(timestampText);
      if (!Number.isInteger(timestamp)) {
        throw new IntegrationGatewayError(400, 'invalid_request_timestamp');
      }
      if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
        throw new IntegrationGatewayError(401, 'request_timestamp_outside_window');
      }
      const rawBody = (request as RawBodyRequest).rawBody;
      if (!rawBody) throw new IntegrationGatewayError(400, 'raw_body_unavailable');

      const key = await pool.query<{
        externalAppId: string;
        secretRef: string;
      }>(
        `SELECT ea.id AS "externalAppId", ik.secret_ref AS "secretRef"
           FROM external_apps ea
           JOIN integration_keys ik ON ik.external_app_id = ea.id
          WHERE ea.key = $1 AND ea.status = 'active'
            AND ik.key_id = $2 AND ik.status IN ('active', 'retiring')
            AND ik.valid_from <= now()
            AND (ik.valid_until IS NULL OR ik.valid_until > now())
          LIMIT 1`,
        [externalAppKey, keyId],
      );
      const keyRow = key.rows[0];
      if (!keyRow) throw new IntegrationGatewayError(401, 'integration_key_not_authorized');
      const secret = secrets[keyRow.secretRef];
      if (!secret || secret.length < 32) {
        throw new IntegrationGatewayError(503, 'integration_secret_not_configured');
      }
      const expectedSignature = createHmac('sha256', secret)
        .update(`${timestampText}.${nonce}.`, 'utf8')
        .update(rawBody)
        .digest('hex');
      if (
        !/^[a-f0-9]{64}$/.test(providedSignature) ||
        !safeEqual(expectedSignature, providedSignature)
      ) {
        throw new IntegrationGatewayError(401, 'integration_signature_invalid');
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new IntegrationGatewayError(400, 'invalid_json_body');
      }
      const input = integrationIngressSchema.parse(parsedBody);
      const requestHash = createHash('sha256').update(rawBody).digest('hex');
      const isTranslationRepositoryEvent =
        input.operation === 'repository.translation_pull_request_event';
      const destination = isTranslationRepositoryEvent
        ? null
        : destinationForOperation(input.operation);
      const accepted = await withTransaction(pool, async (client) => {
        const nonceInsert = await client.query(
          `INSERT INTO integration_nonces
              (external_app_id, key_id, nonce, request_timestamp, expires_at)
           VALUES ($1, $2, $3, to_timestamp($4), now() + interval '10 minutes')
           ON CONFLICT DO NOTHING
           RETURNING nonce`,
          [keyRow.externalAppId, keyId, nonce, timestamp],
        );
        if (nonceInsert.rowCount !== 1) {
          throw new IntegrationGatewayError(409, 'integration_nonce_replayed');
        }

        const mapping = await client.query<{
          externalTenantId: string;
          organizationId: string;
          workspaceId: string;
        }>(
          `SELECT et.id AS "externalTenantId", et.organization_id AS "organizationId",
                  ewm.workspace_id AS "workspaceId"
             FROM external_tenants et
             JOIN external_workspace_mappings ewm
               ON ewm.external_tenant_id = et.id
              AND ewm.organization_id = et.organization_id
              AND ewm.status = 'active'
            WHERE et.external_app_id = $1 AND et.external_tenant_ref = $2
              AND et.status = 'active' AND ewm.external_workspace_ref = $3
            LIMIT 1`,
          [keyRow.externalAppId, input.externalTenantRef, input.externalWorkspaceRef],
        );
        const resolved = mapping.rows[0];
        if (!resolved) throw new IntegrationGatewayError(404, 'external_scope_not_mapped');

        const existing = await client.query<{
          id: string;
          requestHash: string;
          status: string;
        }>(
          `SELECT id, request_hash AS "requestHash", status
             FROM integration_requests
            WHERE external_app_id = $1 AND external_tenant_id = $2 AND idempotency_key = $3
            FOR UPDATE`,
          [keyRow.externalAppId, resolved.externalTenantId, input.idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.requestHash !== requestHash) {
            throw new IntegrationGatewayError(409, 'idempotency_payload_conflict');
          }
          return { requestId: existingRow.id, status: existingRow.status, idempotent: true };
        }

        const inserted = await client.query<{ id: string; status: string }>(
          `INSERT INTO integration_requests
              (external_app_id, external_tenant_id, organization_id, workspace_id,
               key_id, operation, idempotency_key, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, status`,
          [
            keyRow.externalAppId,
            resolved.externalTenantId,
            resolved.organizationId,
            resolved.workspaceId,
            keyId,
            input.operation,
            input.idempotencyKey,
            requestHash,
          ],
        );
        const integrationRequest = inserted.rows[0]!;
        if (isTranslationRepositoryEvent) {
          let repositoryResult: Awaited<ReturnType<typeof applyTranslationRepositoryWebhookEvent>>;
          try {
            repositoryResult = await applyTranslationRepositoryWebhookEvent(
              client,
              {
                organizationId: resolved.organizationId,
                workspaceId: resolved.workspaceId,
                deliveryId: nonce,
              },
              input.payload,
            );
          } catch (caught) {
            const code = caught instanceof Error ? caught.message : 'translation_webhook_invalid';
            const statusCode = code === 'translation_change_set_not_found' ? 404 : 409;
            throw new IntegrationGatewayError(statusCode, code);
          }
          await client.query(
            `UPDATE integration_requests
                SET status = 'completed', completed_at = now()
              WHERE id = $1`,
            [integrationRequest.id],
          );
          return {
            requestId: integrationRequest.id,
            status: 'completed',
            idempotent: false,
            completed: true,
            repositoryResult,
          };
        }
        await client.query(
          `INSERT INTO integration_outbox
              (integration_request_id, organization_id, workspace_id, destination,
               operation, payload, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            integrationRequest.id,
            resolved.organizationId,
            resolved.workspaceId,
            destination,
            input.operation,
            input.payload,
            input.idempotencyKey,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, 'integration.accepted', 'integration_request', $2, $3)`,
          [
            resolved.organizationId,
            integrationRequest.id,
            { externalAppKey, keyId, operation: input.operation, requestHash },
          ],
        );
        return {
          requestId: integrationRequest.id,
          status: integrationRequest.status,
          idempotent: false,
        };
      });
      response.status(accepted.idempotent || accepted.completed ? 200 : 202).json(accepted);
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/outbox/claim', async (request, response, next) => {
    try {
      if (!dispatcherAuthorized(request, dispatcherSecret)) {
        throw new IntegrationGatewayError(401, 'dispatcher_not_authorized');
      }
      const claimed = await withTransaction(pool, async (client) => {
        const selected = await client.query<{ id: string }>(
          `SELECT id FROM integration_outbox
            WHERE status IN ('pending', 'retry') AND next_attempt_at <= now()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1`,
        );
        const id = selected.rows[0]?.id;
        if (!id) return null;
        const updated = await client.query(
          `UPDATE integration_outbox
              SET status = 'in_progress', attempts = attempts + 1,
                  locked_at = now(), updated_at = now()
            WHERE id = $1
            RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                      destination, operation, payload, idempotency_key AS "idempotencyKey",
                      attempts, timeout_ms AS "timeoutMs"`,
          [id],
        );
        return updated.rows[0];
      });
      response.status(claimed ? 200 : 204).json(claimed ?? undefined);
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/outbox/:outboxId/result', async (request, response, next) => {
    try {
      if (!dispatcherAuthorized(request, dispatcherSecret)) {
        throw new IntegrationGatewayError(401, 'dispatcher_not_authorized');
      }
      const input = outboxResultSchema.parse(request.body);
      const updated = await withTransaction(pool, async (client) => {
        const outbox = await client.query<{
          integrationRequestId: string | null;
          processRunId: string | null;
          destination: 'n8n' | 'open-webui' | 'openclaw';
          operation: string;
          meteringSnapshot: unknown;
          attempts: number;
        }>(
          `SELECT integration_request_id AS "integrationRequestId",
                  process_run_id AS "processRunId", destination, operation,
                  metering_snapshot AS "meteringSnapshot", attempts
             FROM integration_outbox WHERE id = $1 AND status = 'in_progress' FOR UPDATE`,
          [request.params.outboxId],
        );
        const row = outbox.rows[0];
        if (!row) throw new IntegrationGatewayError(404, 'outbox_item_not_found');
        const nextStatus =
          input.status === 'retry' && row.attempts >= 8 ? 'dead_letter' : input.status;
        await client.query(
          `UPDATE integration_outbox
              SET status = $1, last_error_code = $2,
                  next_attempt_at = CASE WHEN $1 = 'retry'
                    THEN now() + ($3::text || ' seconds')::interval
                    ELSE next_attempt_at END,
                  dispatched_at = CASE WHEN $1 = 'dispatched' THEN now() ELSE dispatched_at END,
                  adapter_result = $4,
                  locked_at = NULL, updated_at = now()
            WHERE id = $5`,
          [
            nextStatus,
            input.errorCode ?? null,
            input.retryAfterSeconds ?? 30,
            input.adapterResult ?? null,
            request.params.outboxId,
          ],
        );
        if (row.integrationRequestId) {
          await client.query(
            `UPDATE integration_requests
                SET status = CASE
                  WHEN $1 = 'dispatched' THEN 'dispatched'
                  WHEN $1 = 'dead_letter' THEN 'failed'
                  ELSE status END,
                    completed_at = CASE WHEN $1 IN ('dispatched', 'dead_letter') THEN now() ELSE completed_at END
              WHERE id = $2`,
            [nextStatus, row.integrationRequestId],
          );
        }
        if (row.processRunId && nextStatus !== 'retry') {
          const processRun = await client.query<{
            organizationId: string;
            workspaceId: string;
            workItemId: string;
            flowId: string;
            flowVersionId: string;
            input: Record<string, unknown>;
            actorId: string;
          }>(
            `SELECT organization_id AS "organizationId", workspace_id AS "workspaceId",
                    work_item_id AS "workItemId", flow_id AS "flowId",
                    flow_version_id AS "flowVersionId", input,
                    created_by_actor_id AS "actorId"
               FROM flow_runs WHERE id = $1 FOR UPDATE`,
            [row.processRunId],
          );
          const run = processRun.rows[0];
          if (!run) throw new IntegrationGatewayError(404, 'process_run_not_found');
          const adapterSucceeded =
            nextStatus === 'dispatched' && input.adapterResult?.status === 'succeeded';
          const runStatus = adapterSucceeded ? 'succeeded' : 'failed';
          const errorCode = adapterSucceeded
            ? null
            : (input.adapterResult?.errorCode ??
              input.errorCode ??
              `${row.destination.replace('-', '_')}_dispatch_failed`);
          await client.query(
            `UPDATE flow_runs
                SET status = $1, output = $2, error_code = $3, completed_at = now()
              WHERE id = $4 AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
            [runStatus, input.adapterResult?.output ?? null, errorCode, row.processRunId],
          );
          await client.query(
            `INSERT INTO runtime_events
                (organization_id, workspace_id, process_run_id, actor_id,
                 event_type, payload, idempotency_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
            [
              run.organizationId,
              run.workspaceId,
              row.processRunId,
              run.actorId,
              adapterSucceeded
                ? `${row.destination}.execution.succeeded`
                : `${row.destination}.execution.failed`,
              input.adapterResult ?? { errorCode },
              `${row.destination}-result:${request.params.outboxId}`,
            ],
          );
          if (adapterSucceeded && row.meteringSnapshot) {
            const metering = meteringSnapshotSchema.parse(row.meteringSnapshot);
            if (metering.runtime !== row.destination || metering.operation !== row.operation) {
              throw new IntegrationGatewayError(409, 'runtime_metering_snapshot_mismatch');
            }
            const namespace = await client.query<{ id: string }>(
              `SELECT id FROM memory_namespaces
                WHERE organization_id = $1 AND status = 'active'
                  AND (workspace_id = $2 OR workspace_id IS NULL)
                ORDER BY CASE WHEN workspace_id = $2 THEN 0 ELSE 1 END,
                         CASE WHEN namespace_kind = 'governed' THEN 0 ELSE 1 END,
                         created_at
                LIMIT 1`,
              [run.organizationId, run.workspaceId],
            );
            const namespaceId = namespace.rows[0]?.id;
            if (!namespaceId) {
              throw new IntegrationGatewayError(409, 'usage_namespace_not_found');
            }
            const inputTokens = input.adapterResult?.usage?.inputTokens ?? 0;
            const outputTokens = input.adapterResult?.usage?.outputTokens ?? 0;
            const inputBytes = Buffer.byteLength(JSON.stringify(run.input), 'utf8');
            const outputBytes = Buffer.byteLength(
              JSON.stringify(input.adapterResult?.output ?? {}),
              'utf8',
            );
            const usageSource = {
              organizationId: run.organizationId,
              workspaceId: run.workspaceId,
              flowId: run.flowId,
              flowVersionId: run.flowVersionId,
              processRunId: row.processRunId,
              namespaceId,
              operation: row.operation,
              runtime: row.destination,
              model: input.adapterResult?.model ?? null,
              inputTokens,
              outputTokens,
              inputBytes,
              outputBytes,
              latencyMs: input.adapterResult?.latencyMs ?? 0,
              pricingVersionId: metering.pricingVersionId,
              meteringBindingId: metering.bindingId,
            };
            const sourceHash = createHash('sha256')
              .update(JSON.stringify(usageSource))
              .digest('hex');
            await client.query(
              `INSERT INTO usage_events
                  (organization_id, external_app_id, external_tenant_id, workspace_id,
                   flow_id, flow_version_id, process_run_id, namespace_id, operation,
                   runtime, model, input_tokens, output_tokens, total_tokens,
                   input_bytes, output_bytes, total_bytes, latency_ms,
                   unit_cost, allocated_shared_cost, billable_amount,
                   currency, payer, pricing_version_id, idempotency_key, source_hash)
               VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7,
                       $8, $9, $10, $11, $10::bigint + $11::bigint,
                       $12, $13, $12::bigint + $13::bigint, $14,
                       ($15::numeric + $10::numeric * $16::numeric + $11::numeric * $17::numeric),
                       $18,
                       (($15::numeric + $10::numeric * $16::numeric + $11::numeric * $17::numeric)
                         + $18::numeric) * $19::numeric,
                       $20, $21, $22, $23, $24)
               ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
              [
                run.organizationId,
                run.workspaceId,
                run.flowId,
                run.flowVersionId,
                row.processRunId,
                namespaceId,
                row.operation,
                row.destination,
                input.adapterResult?.model ?? null,
                inputTokens,
                outputTokens,
                inputBytes,
                outputBytes,
                input.adapterResult?.latencyMs ?? 0,
                metering.directUnitCost,
                metering.inputTokenUnitCost,
                metering.outputTokenUnitCost,
                metering.allocatedSharedCost,
                metering.billableMultiplier,
                metering.currency,
                metering.payer,
                metering.pricingVersionId,
                `runtime-meter:${request.params.outboxId}`,
                sourceHash,
              ],
            );
          }
          if (row.destination === 'openclaw') {
            await client.query(
              `UPDATE action_executions
                  SET status = $1, external_result_ref = $2, response = $3,
                      error_code = $4, completed_at = now()
                WHERE outbox_id = $5 AND status = 'queued'`,
              [
                adapterSucceeded ? 'succeeded' : 'failed',
                input.adapterResult?.executionId ?? null,
                input.adapterResult?.output ?? null,
                errorCode,
                request.params.outboxId,
              ],
            );
          }
          if (row.operation === 'action.repository.open_translation_pr') {
            if (adapterSucceeded) {
              const pullRequest = translationPullRequestResultSchema.parse(
                input.adapterResult?.output,
              );
              const changed = await client.query<{ id: string }>(
                `UPDATE translation_change_sets
                    SET status = CASE
                          WHEN status IN ('merged', 'failed') THEN status
                          ELSE 'pr_opened'
                        END,
                        repository_branch_ref = $1,
                        pull_request_number = $2, pull_request_url = $3,
                        pull_request_head_sha = $4,
                        pull_request_opened_at = COALESCE(pull_request_opened_at, now()),
                        failure_code = CASE WHEN status = 'failed' THEN failure_code ELSE NULL END,
                        updated_at = now()
                  WHERE id = $5 AND outbox_id = $6
                    AND repository_full_name = $7
                    AND status IN ('sync_queued', 'pr_opened', 'merged', 'failed')
                  RETURNING id`,
                [
                  pullRequest.branchRef,
                  pullRequest.pullRequestNumber,
                  pullRequest.pullRequestUrl,
                  pullRequest.pullRequestHeadSha,
                  pullRequest.changeSetId,
                  request.params.outboxId,
                  pullRequest.repositoryFullName,
                ],
              );
              if (changed.rowCount !== 1) {
                throw new IntegrationGatewayError(409, 'translation_pull_request_result_mismatch');
              }
              await client.query(
                `INSERT INTO audit_events
                    (organization_id, event_type, subject_type, subject_id, metadata)
                 VALUES ($1, 'translation.repository_pr_opened',
                         'translation_change_set', $2, $3)`,
                [
                  run.organizationId,
                  pullRequest.changeSetId,
                  {
                    workspaceId: run.workspaceId,
                    outboxId: request.params.outboxId,
                    pullRequestNumber: pullRequest.pullRequestNumber,
                    pullRequestHeadSha: pullRequest.pullRequestHeadSha,
                  },
                ],
              );
            } else {
              const failed = await client.query<{ id: string }>(
                `UPDATE translation_change_sets
                    SET status = 'failed', failure_code = $1, updated_at = now()
                  WHERE outbox_id = $2 AND status = 'sync_queued'
                  RETURNING id`,
                [errorCode, request.params.outboxId],
              );
              if (failed.rows[0]) {
                await client.query(
                  `INSERT INTO audit_events
                      (organization_id, event_type, subject_type, subject_id, metadata)
                   VALUES ($1, 'translation.repository_sync_failed',
                           'translation_change_set', $2, $3)`,
                  [
                    run.organizationId,
                    failed.rows[0].id,
                    {
                      workspaceId: run.workspaceId,
                      outboxId: request.params.outboxId,
                      errorCode,
                    },
                  ],
                );
              }
            }
          }
          if (adapterSucceeded) {
            await client.query(
              `UPDATE work_items SET status = 'completed', updated_at = now()
                WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
              [run.workItemId, run.organizationId, run.workspaceId],
            );
          }
          if (row.operation === 'model.chat.complete') {
            await materializeScheduledTranslationProposal(client, {
              processRunId: row.processRunId,
              adapterSucceeded,
              adapterOutput: input.adapterResult?.output,
              model: input.adapterResult?.model,
              adapterErrorCode: errorCode,
            });
          }
        }
        return { status: nextStatus };
      });
      response.json(updated);
    } catch (error) {
      next(error);
    }
  });
}
