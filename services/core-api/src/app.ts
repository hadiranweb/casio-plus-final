import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  createArtifactSchema,
  createFlowSchema,
  createFlowVersionSchema,
  createKnowledgeClaimSchema,
  createProcessRunSchema,
  createSemanticRecordSchema,
  createWorkItemSchema,
  governedRetrievalSchema,
  knowledgePromotionSchema,
  nativeExecutionResultSchema,
  organizationContextSchema,
  reviewDecisionSchema,
  runtimeEventSchema,
} from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';

export type TenantContext = ReturnType<typeof organizationContextSchema.parse>;
export type TenantContextResolver = (req: Request) => TenantContext;
type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';
type RequestWithCasioplusId = Request & { casioplusRequestId?: string };

const authorRoles: OrganizationRole[] = ['owner', 'admin', 'editor'];
const reviewerRoles: OrganizationRole[] = ['owner', 'admin', 'reviewer'];
const participantRoles: OrganizationRole[] = [
  'owner',
  'admin',
  'editor',
  'reviewer',
  'viewer',
  'consumer',
];

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function headerTenantContext(req: Request): TenantContext {
  return organizationContextSchema.parse({
    organizationId: req.header('x-casioplus-organization-id'),
    workspaceId: req.header('x-casioplus-workspace-id'),
    actorId: req.header('x-casioplus-actor-id'),
  });
}

function requestId(req: Request): string {
  const typedRequest = req as RequestWithCasioplusId;
  typedRequest.casioplusRequestId ??= req.header('x-correlation-id') ?? randomUUID();
  return typedRequest.casioplusRequestId;
}

function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function runtimeSignature(rawBody: string, secret: string | undefined): string {
  if (!secret || secret.trim().length < 32) {
    throw new HttpError(503, 'native_runtime_not_configured');
  }
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

async function requireMembership(
  pool: Pool,
  context: TenantContext,
  allowedRoles: OrganizationRole[],
  enforceMembership: boolean,
): Promise<void> {
  if (!enforceMembership) return;
  const result = await pool.query<{ role: OrganizationRole }>(
    `SELECT m.role
       FROM members m
       JOIN workspaces w ON w.organization_id = m.organization_id
      WHERE m.organization_id = $1
        AND m.actor_id = $2
        AND m.status = 'active'
        AND w.id = $3
        AND w.organization_id = $1
      LIMIT 1`,
    [context.organizationId, context.actorId, context.workspaceId],
  );
  const role = result.rows[0]?.role;
  if (!role) {
    throw new HttpError(403, 'membership_required');
  }
  if (!allowedRoles.includes(role)) {
    throw new HttpError(403, 'insufficient_role');
  }
}

function runStatusForEvent(type: string): 'running' | 'succeeded' | 'failed' | null {
  if (type.includes('failed') || type.includes('error')) return 'failed';
  if (type.includes('completed') || type.endsWith('.succeeded')) return 'succeeded';
  if (type.includes('started') || type.endsWith('.running')) return 'running';
  return null;
}

export interface AppOptions {
  resolveTenantContext?: TenantContextResolver;
  enforceMembership?: boolean;
}

export function createApp(pool: Pool, options: AppOptions = {}) {
  const resolveTenantContext = options.resolveTenantContext ?? headerTenantContext;
  const enforceMembership = options.enforceMembership ?? false;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    const id = requestId(req);
    res.setHeader('x-correlation-id', id);
    res.on('finish', () => {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'http.request',
          requestId: id,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    });
    const origin = req.header('origin');
    const allowedOrigins = new Set(
      (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-credentials', 'true');
    }
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-correlation-id');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/healthz', async (_req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).json({
        status: 'ok',
        service: 'core-api',
        database: 'ready',
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/work-items', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const result = await pool.query(
        `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId", title, intent,
                status, created_by_actor_id AS "createdByActorId", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM work_items
          WHERE organization_id = $1 AND workspace_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.organizationId, context.workspaceId],
      );
      res.json({ items: result.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/work-items', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = createWorkItemSchema.parse({ ...req.body, ...context });
      const row = await pool.query(
        `INSERT INTO work_items (organization_id, workspace_id, title, intent, created_by_actor_id)
         SELECT $1, $2, $3, $4, $5
          WHERE EXISTS (
            SELECT 1 FROM workspaces
             WHERE id = $2 AND organization_id = $1
          )
            AND EXISTS (
            SELECT 1 FROM actors
             WHERE id = $5 AND organization_id = $1
               AND (workspace_id IS NULL OR workspace_id = $2)
          )
         RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId", title, intent,
                   status, created_by_actor_id AS "createdByActorId", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [input.organizationId, input.workspaceId, input.title, input.intent ?? null, input.actorId],
      );
      if (row.rowCount !== 1) {
        throw new HttpError(403, 'tenant_context_not_authorized');
      }
      return res.status(201).json(row.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/flows', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const result = await pool.query(
        `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId", key, name, status,
                active_version_id AS "activeVersionId"
           FROM flows
          WHERE organization_id = $1 AND workspace_id = $2
          ORDER BY updated_at DESC
          LIMIT 100`,
        [context.organizationId, context.workspaceId],
      );
      res.json({ flows: result.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/flows', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = createFlowSchema.parse({ ...req.body, ...context });
      const row = await pool.query(
        `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
         SELECT $1, $2, $3, $4, $5
          WHERE EXISTS (
            SELECT 1 FROM workspaces
             WHERE id = $2 AND organization_id = $1
          )
            AND EXISTS (
            SELECT 1 FROM actors
             WHERE id = $5 AND organization_id = $1
               AND (workspace_id IS NULL OR workspace_id = $2)
          )
         RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId", key, name, status,
                   active_version_id AS "activeVersionId"`,
        [input.organizationId, input.workspaceId, input.key, input.name, input.actorId],
      );
      if (row.rowCount !== 1) {
        throw new HttpError(403, 'tenant_context_not_authorized');
      }
      return res.status(201).json(row.rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/flows/:flowId/versions', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const result = await pool.query(
        `SELECT fv.id, fv.flow_id AS "flowId", fv.version, fv.input_schema AS "inputSchema",
                fv.output_schema AS "outputSchema", fv.definition, fv.runtime_binding AS "runtimeBinding",
                fv.created_by_actor_id AS "createdByActorId", fv.created_at AS "createdAt"
           FROM flow_versions fv
           JOIN flows f ON f.id = fv.flow_id
          WHERE fv.id IS NOT NULL AND fv.flow_id = $1
            AND f.organization_id = $2 AND f.workspace_id = $3
          ORDER BY fv.version DESC`,
        [req.params.flowId, context.organizationId, context.workspaceId],
      );
      res.json({ versions: result.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/flows/:flowId/versions', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = createFlowVersionSchema.parse({
        ...req.body,
        ...context,
        flowId: req.params.flowId,
      });
      const row = await pool.query(
        `INSERT INTO flow_versions
            (flow_id, version, input_schema, output_schema, runtime_binding, definition, created_by_actor_id)
         SELECT f.id, COALESCE(MAX(fv.version), 0) + 1, $2, $3, $4, $5, $6
           FROM flows f
           LEFT JOIN flow_versions fv ON fv.flow_id = f.id
          WHERE f.id = $1 AND f.organization_id = $7 AND f.workspace_id = $8
          GROUP BY f.id
         RETURNING id, flow_id AS "flowId", version, input_schema AS "inputSchema",
                   output_schema AS "outputSchema", runtime_binding AS "runtimeBinding", definition,
                   created_by_actor_id AS "createdByActorId", created_at AS "createdAt"`,
        [
          input.flowId,
          input.inputSchema,
          input.outputSchema,
          input.runtimeBinding,
          input.definition,
          input.actorId,
          input.organizationId,
          input.workspaceId,
        ],
      );
      if (row.rowCount !== 1) {
        throw new HttpError(404, 'flow_not_found');
      }
      return res.status(201).json(row.rows[0]);
    } catch (error) {
      if (hasPgCode(error, '23505')) {
        return next(new HttpError(409, 'flow_version_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/flows/:flowId/versions/:versionId/publish', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const flow = await withTransaction(pool, async (client) => {
        const row = await client.query(
          `UPDATE flows f
              SET status = 'published', active_version_id = fv.id, updated_at = now()
             FROM flow_versions fv
            WHERE f.id = $1 AND fv.id = $2 AND fv.flow_id = f.id
              AND f.organization_id = $3 AND f.workspace_id = $4
          RETURNING f.id, f.organization_id AS "organizationId", f.workspace_id AS "workspaceId",
                    f.key, f.name, f.status, f.active_version_id AS "activeVersionId"`,
          [req.params.flowId, req.params.versionId, context.organizationId, context.workspaceId],
        );
        if (row.rowCount !== 1) {
          throw new HttpError(404, 'flow_version_not_found');
        }
        return row.rows[0];
      });
      return res.json({ flow, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/process-runs', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const result = await pool.query(
        `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                work_item_id AS "workItemId", flow_id AS "flowId", flow_version_id AS "flowVersionId",
                status, idempotency_key AS "idempotencyKey", input, output,
                error_code AS "errorCode", created_by_actor_id AS "createdByActorId",
                created_at AS "createdAt", completed_at AS "completedAt"
           FROM flow_runs
          WHERE organization_id = $1 AND workspace_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.organizationId, context.workspaceId],
      );
      res.json({ runs: result.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/process-runs', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = createProcessRunSchema.parse({ ...req.body, ...context });
      const result = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                  work_item_id AS "workItemId", flow_id AS "flowId", flow_version_id AS "flowVersionId",
                  status, idempotency_key AS "idempotencyKey", input, output,
                  error_code AS "errorCode", created_by_actor_id AS "createdByActorId",
                  created_at AS "createdAt", completed_at AS "completedAt"
             FROM flow_runs
            WHERE organization_id = $1 AND idempotency_key = $2
            FOR UPDATE`,
          [input.organizationId, input.idempotencyKey],
        );
        if (existing.rowCount === 1) {
          return { run: existing.rows[0], idempotent: true };
        }

        const validContext = await client.query(
          `SELECT 1
             FROM work_items wi
             JOIN flows f ON f.organization_id = wi.organization_id AND f.workspace_id = wi.workspace_id
            WHERE wi.id = $1 AND wi.organization_id = $2 AND wi.workspace_id = $3
              AND f.id = $4
              AND EXISTS (
                SELECT 1 FROM flow_versions fv
                 WHERE fv.id = $5 AND fv.flow_id = f.id
              )`,
          [
            input.workItemId,
            input.organizationId,
            input.workspaceId,
            input.flowId,
            input.flowVersionId,
          ],
        );
        if (validContext.rowCount !== 1) {
          throw new HttpError(404, 'run_context_not_found');
        }

        const inserted = await client.query(
          `INSERT INTO flow_runs
              (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
               idempotency_key, input, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     work_item_id AS "workItemId", flow_id AS "flowId", flow_version_id AS "flowVersionId",
                     status, idempotency_key AS "idempotencyKey", input, output,
                     error_code AS "errorCode", created_by_actor_id AS "createdByActorId",
                     created_at AS "createdAt", completed_at AS "completedAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.workItemId,
            input.flowId,
            input.flowVersionId,
            input.idempotencyKey,
            input.input,
            input.actorId,
          ],
        );
        const run = inserted.rows[0];
        await client.query(
          `INSERT INTO runtime_events
              (organization_id, workspace_id, process_run_id, actor_id, event_type, payload)
           VALUES ($1, $2, $3, $4, 'input_captured', $5)`,
          [input.organizationId, input.workspaceId, run.id, input.actorId, input.input],
        );
        await client.query(
          `UPDATE work_items SET status = 'in_progress', updated_at = now()
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
          [input.workItemId, input.organizationId, input.workspaceId],
        );
        return { run, idempotent: false };
      });
      return res.status(result.idempotent ? 200 : 201).json({
        ...result,
        requestId: requestId(req),
      });
    } catch (error) {
      if (hasPgCode(error, '23505')) {
        return next(new HttpError(409, 'process_run_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/process-runs/:runId/events', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = runtimeEventSchema.parse({
        ...req.body,
        ...context,
        processRunId: req.params.runId,
      });
      const event = await withTransaction(pool, async (client) => {
        const run = await client.query(
          `SELECT id FROM flow_runs
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
          [input.processRunId, input.organizationId, input.workspaceId],
        );
        if (run.rowCount !== 1) {
          throw new HttpError(404, 'process_run_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO runtime_events
              (organization_id, workspace_id, process_run_id, actor_id, event_type, payload, occurred_at, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     process_run_id AS "processRunId", actor_id AS "actorId", event_type AS "type",
                     payload, occurred_at AS "occurredAt", idempotency_key AS "idempotencyKey"`,
          [
            input.organizationId,
            input.workspaceId,
            input.processRunId,
            input.actorId,
            input.type,
            input.payload,
            input.occurredAt ?? null,
            input.idempotencyKey ?? null,
          ],
        );
        if (inserted.rowCount === 0 && input.idempotencyKey) {
          const duplicate = await client.query(
            `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                    process_run_id AS "processRunId", actor_id AS "actorId", event_type AS "type",
                    payload, occurred_at AS "occurredAt", idempotency_key AS "idempotencyKey"
               FROM runtime_events
              WHERE organization_id = $1 AND idempotency_key = $2`,
            [input.organizationId, input.idempotencyKey],
          );
          return { event: duplicate.rows[0], idempotent: true };
        }
        const nextStatus = runStatusForEvent(input.type);
        if (nextStatus) {
          await client.query(
            `UPDATE flow_runs
                SET status = $1,
                    completed_at = CASE WHEN $1 IN ('succeeded', 'failed') THEN now() ELSE completed_at END
              WHERE id = $2 AND organization_id = $3 AND workspace_id = $4
                AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
            [nextStatus, input.processRunId, input.organizationId, input.workspaceId],
          );
        }
        return { event: inserted.rows[0], idempotent: false };
      });
      return res.status(event.idempotent ? 200 : 201).json({
        ...event,
        requestId: requestId(req),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/process-runs/:runId/execute', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const run = await pool.query<{
        id: string;
        organizationId: string;
        workspaceId: string;
        workItemId: string;
        flowId: string;
        flowVersionId: string;
        status: string;
        input: Record<string, unknown>;
        runtimeBinding: string;
      }>(
        `SELECT fr.id, fr.organization_id AS "organizationId", fr.workspace_id AS "workspaceId",
                fr.work_item_id AS "workItemId", fr.flow_id AS "flowId",
                fr.flow_version_id AS "flowVersionId", fr.status, fr.input,
                fv.runtime_binding AS "runtimeBinding"
           FROM flow_runs fr
           JOIN flow_versions fv ON fv.id = fr.flow_version_id
          WHERE fr.id = $1 AND fr.organization_id = $2 AND fr.workspace_id = $3
            AND fv.flow_id = fr.flow_id`,
        [req.params.runId, context.organizationId, context.workspaceId],
      );
      const runRow = run.rows[0];
      if (!runRow) throw new HttpError(404, 'process_run_not_found');
      if (runRow.status !== 'running' && runRow.status !== 'queued') {
        throw new HttpError(409, 'process_run_not_executable');
      }
      if (runRow.runtimeBinding !== 'native') {
        throw new HttpError(409, 'native_runtime_binding_required');
      }
      const workerUrl = process.env.NATIVE_WORKER_URL;
      if (!workerUrl) {
        throw new HttpError(503, 'native_runtime_not_configured');
      }
      const job = {
        schemaVersion: 'business-diagnosis.v1' as const,
        organizationId: runRow.organizationId,
        workspaceId: runRow.workspaceId,
        actorId: context.actorId,
        workItemId: runRow.workItemId,
        processRunId: runRow.id,
        input: runRow.input,
      };
      const rawBody = JSON.stringify(job);
      let workerResponse: globalThis.Response;
      try {
        workerResponse = await fetch(`${workerUrl.replace(/\/$/, '')}/execute`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-casioplus-runtime-signature': runtimeSignature(
              rawBody,
              process.env.RUNTIME_SHARED_SECRET,
            ),
          },
          body: rawBody,
          signal: AbortSignal.timeout(Number(process.env.NATIVE_WORKER_TIMEOUT_MS ?? 30_000)),
        });
      } catch {
        throw new HttpError(502, 'native_runtime_unavailable');
      }
      if (!workerResponse.ok) {
        throw new HttpError(502, 'native_runtime_failed');
      }
      const result = nativeExecutionResultSchema.parse(await workerResponse.json());
      const saved = await withTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO runtime_events
              (organization_id, workspace_id, process_run_id, actor_id, event_type, payload, idempotency_key)
           VALUES ($1, $2, $3, $4, 'diagnosis.completed', $5, $6)
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
          [
            runRow.organizationId,
            runRow.workspaceId,
            runRow.id,
            context.actorId,
            result.output,
            `native-diagnosis:${runRow.id}:${result.schemaVersion}`,
          ],
        );
        await client.query(
          `UPDATE flow_runs
              SET status = 'succeeded', output = $1, completed_at = now()
            WHERE id = $2 AND organization_id = $3 AND workspace_id = $4
              AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
          [result.output, runRow.id, runRow.organizationId, runRow.workspaceId],
        );
        await client.query(
          `UPDATE work_items SET status = 'completed', updated_at = now()
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
          [runRow.workItemId, runRow.organizationId, runRow.workspaceId],
        );
        const refreshed = await client.query(
          `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                  work_item_id AS "workItemId", flow_id AS "flowId", flow_version_id AS "flowVersionId",
                  status, idempotency_key AS "idempotencyKey", input, output,
                  error_code AS "errorCode", created_by_actor_id AS "createdByActorId",
                  created_at AS "createdAt", completed_at AS "completedAt"
             FROM flow_runs WHERE id = $1`,
          [runRow.id],
        );
        return refreshed.rows[0];
      });
      return res.status(200).json({ run: saved, result, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/artifacts', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = createArtifactSchema.parse({ ...req.body, ...context });
      const artifact = await withTransaction(pool, async (client) => {
        if (input.processRunId) {
          const run = await client.query(
            `SELECT 1 FROM flow_runs
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
            [input.processRunId, input.organizationId, input.workspaceId],
          );
          if (run.rowCount !== 1) {
            throw new HttpError(404, 'artifact_process_run_not_found');
          }
        }
        const inserted = await client.query(
          `INSERT INTO artifacts
              (organization_id, workspace_id, process_run_id, artifact_type,
               object_key, content_type, checksum, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'available')
           ON CONFLICT (organization_id, object_key) DO NOTHING
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     process_run_id AS "processRunId", artifact_type AS "artifactType",
                     object_key AS "objectKey", content_type AS "contentType", checksum,
                     status, created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.processRunId,
            input.artifactType,
            input.objectKey,
            input.contentType,
            input.checksum ?? null,
          ],
        );
        if (inserted.rowCount === 1) {
          return { artifact: inserted.rows[0], idempotent: false };
        }
        const duplicate = await client.query(
          `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                  process_run_id AS "processRunId", artifact_type AS "artifactType",
                  object_key AS "objectKey", content_type AS "contentType", checksum,
                  status, created_at AS "createdAt"
             FROM artifacts
            WHERE organization_id = $1 AND object_key = $2`,
          [input.organizationId, input.objectKey],
        );
        return { artifact: duplicate.rows[0], idempotent: true };
      });
      return res.status(artifact.idempotent ? 200 : 201).json({
        ...artifact,
        requestId: requestId(req),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/artifacts/:artifactId', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const result = await pool.query(
        `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                process_run_id AS "processRunId", artifact_type AS "artifactType",
                object_key AS "objectKey", content_type AS "contentType", checksum,
                status, created_at AS "createdAt"
           FROM artifacts
          WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
        [req.params.artifactId, context.organizationId, context.workspaceId],
      );
      if (result.rowCount !== 1) {
        throw new HttpError(404, 'artifact_not_found');
      }
      return res.json({ artifact: result.rows[0], requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/semantic-records', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = createSemanticRecordSchema.parse({ ...req.body, ...context });
      const record = await withTransaction(pool, async (client) => {
        const source = await client.query(
          `SELECT 1 FROM flow_runs
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
              AND work_item_id = $4`,
          [input.processRunId, input.organizationId, input.workspaceId, input.workItemId],
        );
        if (source.rowCount !== 1) {
          throw new HttpError(404, 'semantic_record_source_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO semantic_records
              (organization_id, workspace_id, work_item_id, process_run_id,
               record_type, title, summary, payload, outcome, provenance, status, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, 'pending_review', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     work_item_id AS "workItemId", process_run_id AS "processRunId",
                     record_type AS "type", title, summary, payload, provenance, status,
                     created_by_actor_id AS "createdByActorId", created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.workItemId,
            input.processRunId,
            input.type,
            input.title,
            input.summary,
            input.payload,
            { ...input.provenance, capturedAt: new Date().toISOString() },
            input.actorId,
          ],
        );
        await client.query(
          `INSERT INTO provenance_records
              (organization_id, subject_type, subject_id, source_type, source_id, actor_id, transformation)
           VALUES ($1, 'semantic_record', $2, $3, $4, $5, $6)`,
          [
            input.organizationId,
            inserted.rows[0].id,
            input.provenance.sourceType,
            input.provenance.sourceId,
            input.provenance.actorId,
            'captured_from_golden_flow',
          ],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ record, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/knowledge-claims', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = createKnowledgeClaimSchema.parse({ ...req.body, ...context });
      const claim = await withTransaction(pool, async (client) => {
        const source = await client.query(
          `SELECT 1 FROM semantic_records
            WHERE id = $1 AND process_run_id = $2
              AND organization_id = $3 AND workspace_id = $4`,
          [input.semanticRecordId, input.processRunId, input.organizationId, input.workspaceId],
        );
        if (source.rowCount !== 1) {
          throw new HttpError(404, 'knowledge_claim_source_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO knowledge_claims
              (organization_id, workspace_id, semantic_record_id, process_run_id, subject,
               claim_type, content, evidence, confidence, lifecycle, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_review', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     semantic_record_id AS "semanticRecordId", process_run_id AS "processRunId",
                     subject, claim_type AS "claimType", content, evidence, confidence,
                     lifecycle, created_by_actor_id AS "createdByActorId", created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.semanticRecordId,
            input.processRunId,
            input.subject,
            input.claimType,
            input.content,
            JSON.stringify(input.evidence),
            input.confidence ?? null,
            input.actorId,
          ],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ claim, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/knowledge-claims', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const lifecycle = typeof req.query.lifecycle === 'string' ? req.query.lifecycle : null;
      const result = await pool.query(
        `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                semantic_record_id AS "semanticRecordId", process_run_id AS "processRunId",
                subject, claim_type AS "claimType", content, evidence, confidence,
                lifecycle, created_by_actor_id AS "createdByActorId", created_at AS "createdAt"
           FROM knowledge_claims
          WHERE organization_id = $1 AND workspace_id = $2
            AND ($3::text IS NULL OR lifecycle = $3)
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.organizationId, context.workspaceId, lifecycle],
      );
      res.json({ claims: result.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/knowledge-claims/:claimId/review', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const input = reviewDecisionSchema.parse({
        ...req.body,
        ...context,
        claimId: req.params.claimId,
      });
      const review = await withTransaction(pool, async (client) => {
        const claim = await client.query<{ semanticRecordId: string }>(
          `SELECT semantic_record_id AS "semanticRecordId"
             FROM knowledge_claims
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
          [input.claimId, input.organizationId, input.workspaceId],
        );
        const semanticRecordId = claim.rows[0]?.semanticRecordId;
        if (!semanticRecordId) {
          throw new HttpError(404, 'knowledge_claim_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO knowledge_reviews
              (organization_id, workspace_id, semantic_record_id, reviewer_actor_id, decision, rationale)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     semantic_record_id AS "semanticRecordId", reviewer_actor_id AS "reviewerActorId",
                     decision, rationale, created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            semanticRecordId,
            input.actorId,
            input.decision,
            input.rationale,
          ],
        );
        const lifecycle = {
          approve: 'approved',
          reject: 'rejected',
          correct: 'corrected',
          supersede: 'superseded',
        }[input.decision];
        await client.query(
          `UPDATE knowledge_claims SET lifecycle = $1, updated_at = now()
            WHERE id = $2 AND organization_id = $3 AND workspace_id = $4`,
          [lifecycle, input.claimId, input.organizationId, input.workspaceId],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ review, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/knowledge-claims/:claimId/promote', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const input = knowledgePromotionSchema.parse({
        ...req.body,
        ...context,
        claimId: req.params.claimId,
      });
      const memory = await withTransaction(pool, async (client) => {
        const claim = await client.query<{
          semanticRecordId: string;
          lifecycle: string;
        }>(
          `SELECT semantic_record_id AS "semanticRecordId", lifecycle
             FROM knowledge_claims
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
            FOR UPDATE`,
          [input.claimId, input.organizationId, input.workspaceId],
        );
        const claimRow = claim.rows[0];
        if (!claimRow) {
          throw new HttpError(404, 'knowledge_claim_not_found');
        }
        if (claimRow.lifecycle !== 'approved') {
          throw new HttpError(409, 'knowledge_claim_not_approved');
        }
        const approvedReview = await client.query(
          `SELECT id FROM knowledge_reviews
            WHERE id = $1 AND semantic_record_id = $2
              AND organization_id = $3 AND workspace_id = $4 AND decision = 'approve'`,
          [input.reviewId, claimRow.semanticRecordId, input.organizationId, input.workspaceId],
        );
        if (approvedReview.rowCount !== 1) {
          throw new HttpError(409, 'approved_review_required');
        }
        const promotion = await client.query(
          `INSERT INTO knowledge_promotions
              (organization_id, workspace_id, claim_id, review_id, target_kind,
               promoted_by_actor_id, rationale)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            input.organizationId,
            input.workspaceId,
            input.claimId,
            input.reviewId,
            input.targetKind,
            input.actorId,
            input.rationale,
          ],
        );
        const inserted = await client.query(
          `INSERT INTO organizational_memory_items
              (organization_id, workspace_id, kind, title, content,
               source_semantic_record_id, source_claim_id, promotion_id, source_review_id,
               lifecycle, sensitivity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     kind, title, content, source_semantic_record_id AS "sourceSemanticRecordId",
                     source_claim_id AS "sourceClaimId", promotion_id AS "promotionId",
                     lifecycle, sensitivity, valid_from AS "validFrom", valid_until AS "validUntil",
                     created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.targetKind,
            input.title,
            input.content,
            claimRow.semanticRecordId,
            input.claimId,
            promotion.rows[0].id,
            input.reviewId,
            input.sensitivity,
          ],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ memory, requestId: requestId(req) });
    } catch (error) {
      if (hasPgCode(error, '23505')) {
        return next(new HttpError(409, 'knowledge_claim_already_promoted'));
      }
      next(error);
    }
  });

  app.get('/api/v1/memory/search', async (req, res, next) => {
    try {
      const context = resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = governedRetrievalSchema.parse({
        ...context,
        query: req.query.query,
        limit: Number(req.query.limit ?? 10),
        allowedKinds:
          typeof req.query.allowedKinds === 'string'
            ? req.query.allowedKinds.split(',').filter(Boolean)
            : undefined,
      });
      const result = await pool.query(
        `SELECT mi.id, mi.organization_id AS "organizationId", mi.workspace_id AS "workspaceId",
                mi.kind, mi.title, mi.content,
                mi.source_semantic_record_id AS "sourceSemanticRecordId",
                mi.source_claim_id AS "sourceClaimId", mi.promotion_id AS "promotionId",
                mi.lifecycle, mi.sensitivity, mi.valid_from AS "validFrom", mi.valid_until AS "validUntil",
                mi.created_at AS "createdAt",
                ts_rank(mi.search_vector, plainto_tsquery('simple', $3)) AS rank
           FROM organizational_memory_items mi
          WHERE mi.organization_id = $1
            AND (mi.workspace_id = $2 OR mi.workspace_id IS NULL)
            AND mi.lifecycle = 'approved'
            AND mi.sensitivity IN ('public', 'organization', 'workspace')
            AND ($4::text[] IS NULL OR mi.kind = ANY($4::text[]))
            AND mi.search_vector @@ plainto_tsquery('simple', $3)
          ORDER BY rank DESC, mi.created_at DESC
          LIMIT $5`,
        [
          input.organizationId,
          input.workspaceId,
          input.query,
          input.allowedKinds ?? null,
          input.limit,
        ],
      );
      res.json({
        results: result.rows,
        requestId: requestId(req),
        governance: {
          permissionFiltered: true,
          scope: input.workspaceId,
          unreviewedExcluded: true,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestIdValue = requestId(req);
    if (error instanceof HttpError) {
      return res.status(error.statusCode).json({ error: error.code, requestId: requestIdValue });
    }
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
      const code =
        'code' in error && typeof error.code === 'string' ? error.code : 'request_failed';
      return res.status(error.statusCode).json({ error: code, requestId: requestIdValue });
    }
    if (error instanceof Error && error.name === 'ZodError') {
      return res.status(400).json({
        error: 'invalid_request',
        requestId: requestIdValue,
      });
    }
    console.error(JSON.stringify({ level: 'error', requestId: requestIdValue, error }));
    return res.status(500).json({
      error: 'internal_error',
      requestId: requestIdValue,
    });
  });

  return app;
}
