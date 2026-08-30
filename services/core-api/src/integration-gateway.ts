import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { integrationIngressSchema } from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';

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
});

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
      const destination = destinationForOperation(input.operation);
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
      response.status(accepted.idempotent ? 200 : 202).json(accepted);
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
          attempts: number;
        }>(
          `SELECT integration_request_id AS "integrationRequestId",
                  process_run_id AS "processRunId", attempts
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
            actorId: string;
          }>(
            `SELECT organization_id AS "organizationId", workspace_id AS "workspaceId",
                    work_item_id AS "workItemId", created_by_actor_id AS "actorId"
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
            : (input.adapterResult?.errorCode ?? input.errorCode ?? 'n8n_dispatch_failed');
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
              adapterSucceeded ? 'n8n.execution.succeeded' : 'n8n.execution.failed',
              input.adapterResult ?? { errorCode },
              `n8n-result:${request.params.outboxId}`,
            ],
          );
          if (adapterSucceeded) {
            await client.query(
              `UPDATE work_items SET status = 'completed', updated_at = now()
                WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
              [run.workItemId, run.organizationId, run.workspaceId],
            );
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
