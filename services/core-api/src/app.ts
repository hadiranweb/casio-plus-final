import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  completeArtifactUploadSchema,
  createActionPolicySchema,
  createActionTargetSchema,
  createArtifactSchema,
  createArtifactUploadSchema,
  createFlowSchema,
  createFlowVersionSchema,
  createKnowledgeClaimSchema,
  createMemoryGrantSchema,
  createMemoryNamespaceSchema,
  createPricingAssumptionSchema,
  createProcessRunSchema,
  createRuntimeMeterBindingSchema,
  createSemanticRecordSchema,
  decideActionApprovalSchema,
  createWorkItemSchema,
  governedMemoryGraphSchema,
  governedRetrievalSchema,
  knowledgePromotionSchema,
  nativeExecutionResultSchema,
  openClawRuntimeDefinitionSchema,
  openWebUiRuntimeDefinitionSchema,
  organizationContextSchema,
  recordUsageEventSchema,
  requestActionApprovalSchema,
  reviewDecisionSchema,
  runtimeEventSchema,
} from '../../../packages/contracts/src/index.js';
import type { ArtifactObjectStore } from './artifact-storage.js';
import { assertCsrfForCookieRequest } from './auth.js';
import { withTransaction } from './db.js';
import { mountIdentityRoutes } from './identity.js';
import { retrieveGovernedMemory, retrieveGovernedMemoryGraph } from './memory-broker.js';
import {
  mountIntegrationGateway,
  type IntegrationSecretMap,
  type RawBodyRequest,
} from './integration-gateway.js';

export type TenantContext = ReturnType<typeof organizationContextSchema.parse> & {
  sessionId?: string;
  userId?: string;
};
export type TenantContextResolver = (req: Request) => TenantContext | Promise<TenantContext>;
type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';
type RequestWithCasioplusId = Request & { casioplusRequestId?: string };

const administrativeRoles: OrganizationRole[] = ['owner', 'admin'];
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

function internalSecretMatches(req: Request, expected: string | undefined): boolean {
  const provided = req.header('x-casioplus-dispatcher-secret')?.trim();
  if (!provided || !expected || expected.length < 32) return false;
  const left = createHash('sha256').update(provided).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
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
    `SELECT wm.role
       FROM members m
       JOIN workspace_memberships wm
         ON wm.organization_id = m.organization_id
        AND wm.actor_id = m.actor_id
        AND wm.status = 'active'
       JOIN workspaces w
         ON w.organization_id = wm.organization_id
        AND w.id = wm.workspace_id
        AND w.status = 'active'
      WHERE m.organization_id = $1
        AND m.actor_id = $2
        AND m.status = 'active'
        AND wm.workspace_id = $3
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

type RuntimeMeteringSnapshot = {
  bindingId: string;
  pricingVersionId: string;
  runtime: 'open-webui' | 'openclaw';
  operation: 'model.chat.complete' | 'action.send_message';
  resourceKey: string;
  currency: string;
  payer: 'casioplus' | 'customer' | 'external_product' | 'shared';
  directUnitCost: string;
  inputTokenUnitCost: string;
  outputTokenUnitCost: string;
  allocatedSharedCost: string;
  billableMultiplier: string;
};

async function resolveRuntimeMetering(
  client: PoolClient,
  organizationId: string,
  runtime: RuntimeMeteringSnapshot['runtime'],
  operation: RuntimeMeteringSnapshot['operation'],
  resourceKey: string,
): Promise<RuntimeMeteringSnapshot> {
  const result = await client.query<RuntimeMeteringSnapshot>(
    `SELECT rmb.id AS "bindingId", rmb.pricing_version_id AS "pricingVersionId",
            rmb.runtime, rmb.operation, rmb.resource_key AS "resourceKey",
            rmb.currency, rmb.payer, rmb.direct_unit_cost AS "directUnitCost",
            rmb.input_token_unit_cost AS "inputTokenUnitCost",
            rmb.output_token_unit_cost AS "outputTokenUnitCost",
            rmb.allocated_shared_cost AS "allocatedSharedCost",
            rmb.billable_multiplier AS "billableMultiplier"
       FROM runtime_meter_bindings rmb
       JOIN pricing_assumption_versions pav ON pav.id = rmb.pricing_version_id
      WHERE rmb.organization_id = $1 AND rmb.runtime = $2
        AND rmb.operation = $3 AND rmb.resource_key = $4
        AND rmb.status = 'active' AND rmb.valid_from <= now()
        AND (rmb.valid_until IS NULL OR rmb.valid_until > now())
        AND pav.status = 'active' AND pav.effective_from <= now()
        AND (pav.effective_until IS NULL OR pav.effective_until > now())
        AND (pav.organization_id IS NULL OR pav.organization_id = $1)
      ORDER BY rmb.valid_from DESC
      LIMIT 1`,
    [organizationId, runtime, operation, resourceKey],
  );
  const snapshot = result.rows[0];
  if (!snapshot) throw new HttpError(503, 'runtime_metering_not_configured');
  return snapshot;
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
  sessionSecret?: string;
  integrationSecrets?: IntegrationSecretMap;
  dispatcherSecret?: string;
  artifactObjectStore?: ArtifactObjectStore;
}

export function createApp(pool: Pool, options: AppOptions = {}) {
  const resolveTenantContext = options.resolveTenantContext ?? headerTenantContext;
  const enforceMembership = options.enforceMembership ?? false;
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    '/api/v1/integrations/events',
    express.raw({ type: 'application/json', limit: '256kb' }),
    (request, _response, next) => {
      (request as RawBodyRequest).rawBody = Buffer.from(request.body as Buffer);
      next();
    },
  );
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
    res.setHeader(
      'access-control-allow-headers',
      'authorization, content-type, x-correlation-id, x-casioplus-csrf',
    );
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  if (options.sessionSecret) {
    mountIdentityRoutes(app, pool, options.sessionSecret);
  }
  if (options.integrationSecrets) {
    mountIntegrationGateway(app, pool, options.integrationSecrets, options.dispatcherSecret);
  }

  app.use((req, _res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        assertCsrfForCookieRequest(req);
      }
      next();
    } catch (error) {
      next(error);
    }
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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

  app.post('/api/v1/action-targets', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createActionTargetSchema.parse({ ...req.body, ...context });
      const inserted = await pool.query(
        `INSERT INTO action_targets
            (organization_id, workspace_id, key, action, executor_ref, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                   key, action, executor_ref AS "executorRef", status, created_at AS "createdAt"`,
        [
          input.organizationId,
          input.workspaceId,
          input.key,
          input.action,
          input.executorRef,
          input.actorId,
        ],
      );
      return res.status(201).json({ target: inserted.rows[0], requestId: requestId(req) });
    } catch (error) {
      if (hasPgCode(error, '23505')) return next(new HttpError(409, 'action_target_conflict'));
      next(error);
    }
  });

  app.post('/api/v1/action-policies', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createActionPolicySchema.parse({ ...req.body, ...context });
      const inserted = await pool.query(
        `INSERT INTO action_policies
            (organization_id, workspace_id, flow_id, flow_version_id, target_id, action,
             risk_class, approval_required, valid_from, valid_until, created_by_actor_id)
         SELECT $1, $2, f.id, fv.id, at.id, $6, $7, TRUE,
                COALESCE($8::timestamptz, now()), $9::timestamptz, $10
           FROM flows f
           JOIN flow_versions fv ON fv.flow_id = f.id AND fv.id = $4
           JOIN action_targets at
             ON at.organization_id = f.organization_id AND at.workspace_id = f.workspace_id
            AND at.id = $5 AND at.action = $6 AND at.status = 'active'
          WHERE f.id = $3 AND f.organization_id = $1 AND f.workspace_id = $2
            AND fv.runtime_binding = 'openclaw'
         RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                   flow_id AS "flowId", flow_version_id AS "flowVersionId",
                   target_id AS "targetId", action, risk_class AS "riskClass",
                   approval_required AS "approvalRequired", status,
                   valid_from AS "validFrom", valid_until AS "validUntil",
                   created_at AS "createdAt"`,
        [
          input.organizationId,
          input.workspaceId,
          input.flowId,
          input.flowVersionId,
          input.targetId,
          input.action,
          input.riskClass,
          input.validFrom ?? null,
          input.validUntil ?? null,
          input.actorId,
        ],
      );
      if (inserted.rowCount !== 1) throw new HttpError(404, 'action_policy_context_not_found');
      return res.status(201).json({ policy: inserted.rows[0], requestId: requestId(req) });
    } catch (error) {
      if (hasPgCode(error, '23505')) return next(new HttpError(409, 'action_policy_conflict'));
      next(error);
    }
  });

  app.post('/api/v1/action-approvals', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = requestActionApprovalSchema.parse({ ...req.body, ...context });
      const result = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          `SELECT id, status, expires_at AS "expiresAt", created_at AS "createdAt"
             FROM action_approval_requests
            WHERE process_run_id = $1 AND organization_id = $2 AND workspace_id = $3
            FOR UPDATE`,
          [input.processRunId, input.organizationId, input.workspaceId],
        );
        if (existing.rowCount === 1) return { approval: existing.rows[0], idempotent: true };
        const run = await client.query<{
          flowId: string;
          flowVersionId: string;
          definition: Record<string, unknown>;
          input: Record<string, unknown>;
        }>(
          `SELECT fr.flow_id AS "flowId", fr.flow_version_id AS "flowVersionId",
                  fv.definition, fr.input
             FROM flow_runs fr
             JOIN flow_versions fv ON fv.id = fr.flow_version_id AND fv.flow_id = fr.flow_id
            WHERE fr.id = $1 AND fr.organization_id = $2 AND fr.workspace_id = $3
              AND fr.status IN ('queued', 'running') AND fv.runtime_binding = 'openclaw'
            FOR UPDATE OF fr`,
          [input.processRunId, input.organizationId, input.workspaceId],
        );
        const runRow = run.rows[0];
        if (!runRow) throw new HttpError(404, 'openclaw_process_run_not_found');
        const definition = openClawRuntimeDefinitionSchema.parse(runRow.definition);
        const message = runRow.input.message;
        if (typeof message !== 'string' || !message.trim() || message.length > 10_000) {
          throw new HttpError(400, 'openclaw_message_invalid');
        }
        const policy = await client.query<{
          id: string;
          targetId: string;
          action: 'send_message';
          riskClass: 'low' | 'medium' | 'high';
        }>(
          `SELECT ap.id, ap.target_id AS "targetId", ap.action, ap.risk_class AS "riskClass"
             FROM action_policies ap
             JOIN action_targets at ON at.id = ap.target_id
            WHERE ap.organization_id = $1 AND ap.workspace_id = $2
              AND ap.flow_id = $3 AND ap.flow_version_id = $4
              AND ap.action = $5 AND ap.status = 'active' AND ap.approval_required
              AND ap.valid_from <= now() AND (ap.valid_until IS NULL OR ap.valid_until > now())
              AND at.key = $6 AND at.status = 'active'
            LIMIT 1`,
          [
            input.organizationId,
            input.workspaceId,
            runRow.flowId,
            runRow.flowVersionId,
            definition.action,
            definition.targetKey,
          ],
        );
        const policyRow = policy.rows[0];
        if (!policyRow) throw new HttpError(403, 'openclaw_action_not_allowlisted');
        const requestPayload = { message: message.trim() };
        const requestPayloadHash = createHash('sha256')
          .update(JSON.stringify(requestPayload))
          .digest('hex');
        const inserted = await client.query(
          `INSERT INTO action_approval_requests
              (organization_id, workspace_id, process_run_id, policy_id, target_id, action,
               risk_class, request_payload, request_payload_hash, requested_by_actor_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   now() + ($11::text || ' seconds')::interval)
           RETURNING id, process_run_id AS "processRunId", policy_id AS "policyId",
                     target_id AS "targetId", action, risk_class AS "riskClass",
                     status, expires_at AS "expiresAt", created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.processRunId,
            policyRow.id,
            policyRow.targetId,
            policyRow.action,
            policyRow.riskClass,
            requestPayload,
            requestPayloadHash,
            input.actorId,
            input.expiresInSeconds,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'action.approval_requested', $2, 'action_approval', $3, $4)`,
          [
            input.organizationId,
            input.actorId,
            inserted.rows[0].id,
            { processRunId: input.processRunId, riskClass: policyRow.riskClass },
          ],
        );
        return { approval: inserted.rows[0], idempotent: false };
      });
      return res.status(result.idempotent ? 200 : 201).json({
        ...result,
        requestId: requestId(req),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/action-approvals', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
      if (!['pending', 'approved', 'rejected', 'expired', 'revoked'].includes(status)) {
        throw new HttpError(400, 'action_approval_status_invalid');
      }
      const approvals = await pool.query(
        `SELECT aar.id, aar.process_run_id AS "processRunId", aar.action,
                aar.risk_class AS "riskClass", aar.request_payload AS "requestPayload",
                aar.status, aar.expires_at AS "expiresAt", aar.created_at AS "createdAt",
                at.key AS "targetKey"
           FROM action_approval_requests aar
           JOIN action_targets at ON at.id = aar.target_id
          WHERE aar.organization_id = $1 AND aar.workspace_id = $2 AND aar.status = $3
          ORDER BY aar.created_at DESC
          LIMIT 100`,
        [context.organizationId, context.workspaceId, status],
      );
      return res.json({ approvals: approvals.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/action-approvals/:approvalId/decisions', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const input = decideActionApprovalSchema.parse({ ...req.body, ...context });
      const decided = await withTransaction(pool, async (client) => {
        const approval = await client.query<{ id: string; status: string; expiresAt: Date }>(
          `SELECT id, status, expires_at AS "expiresAt"
             FROM action_approval_requests
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
            FOR UPDATE`,
          [req.params.approvalId, input.organizationId, input.workspaceId],
        );
        const row = approval.rows[0];
        if (!row) throw new HttpError(404, 'action_approval_not_found');
        if (row.status !== 'pending') throw new HttpError(409, 'action_approval_already_decided');
        if (row.expiresAt.getTime() <= Date.now()) {
          await client.query(
            `UPDATE action_approval_requests
                SET status = 'expired', decided_at = now(), decision_reason = 'expired before decision'
              WHERE id = $1`,
            [row.id],
          );
          throw new HttpError(409, 'action_approval_expired');
        }
        const updated = await client.query(
          `UPDATE action_approval_requests
              SET status = $1, decided_by_actor_id = $2, decision_reason = $3, decided_at = now()
            WHERE id = $4
            RETURNING id, process_run_id AS "processRunId", status,
                      decided_by_actor_id AS "decidedByActorId", decision_reason AS "decisionReason",
                      decided_at AS "decidedAt"`,
          [input.decision, input.actorId, input.reason, row.id],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, $2, $3, 'action_approval', $4, $5)`,
          [
            input.organizationId,
            `action.${input.decision}`,
            input.actorId,
            row.id,
            { reason: input.reason },
          ],
        );
        return updated.rows[0];
      });
      return res.json({ approval: decided, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/process-runs/:runId/events', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
        definition: Record<string, unknown>;
        runtimeBinding: string;
      }>(
        `SELECT fr.id, fr.organization_id AS "organizationId", fr.workspace_id AS "workspaceId",
                fr.work_item_id AS "workItemId", fr.flow_id AS "flowId",
                fr.flow_version_id AS "flowVersionId", fr.status, fr.input, fv.definition,
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
      if (runRow.runtimeBinding === 'open-webui') {
        const definition = openWebUiRuntimeDefinitionSchema.parse(runRow.definition);
        const prompt = runRow.input.prompt;
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 50_000) {
          throw new HttpError(400, 'open_webui_prompt_invalid');
        }
        const dispatch = await withTransaction(pool, async (client) => {
          const idempotencyKey = `process-run:${runRow.id}:open-webui`;
          const metering = await resolveRuntimeMetering(
            client,
            runRow.organizationId,
            'open-webui',
            'model.chat.complete',
            definition.model,
          );
          const queued = await client.query(
            `INSERT INTO integration_outbox
                (integration_request_id, process_run_id, organization_id, workspace_id,
                 destination, operation, payload, idempotency_key, timeout_ms, metering_snapshot)
             VALUES (NULL, $1, $2, $3, 'open-webui', 'model.chat.complete', $4, $5, $6, $7)
             ON CONFLICT (destination, idempotency_key) DO UPDATE
               SET updated_at = integration_outbox.updated_at
             RETURNING id, status, attempts, created_at AS "createdAt"`,
            [
              runRow.id,
              runRow.organizationId,
              runRow.workspaceId,
              {
                processRunId: runRow.id,
                workItemId: runRow.workItemId,
                flowId: runRow.flowId,
                flowVersionId: runRow.flowVersionId,
                actorId: context.actorId,
                input: { ...runRow.input, prompt: prompt.trim() },
                definition,
              },
              idempotencyKey,
              Number(process.env.OPEN_WEBUI_RUNTIME_TIMEOUT_MS ?? 120_000),
              metering,
            ],
          );
          await client.query(
            `INSERT INTO runtime_events
                (organization_id, workspace_id, process_run_id, actor_id, event_type, payload, idempotency_key)
             VALUES ($1, $2, $3, $4, 'open-webui.dispatch.queued', $5, $6)
             ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
            [
              runRow.organizationId,
              runRow.workspaceId,
              runRow.id,
              context.actorId,
              { outboxId: queued.rows[0]!.id, model: definition.model },
              `${idempotencyKey}:queued`,
            ],
          );
          await client.query(
            `UPDATE flow_runs SET status = 'running'
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
                AND status IN ('queued', 'running')`,
            [runRow.id, runRow.organizationId, runRow.workspaceId],
          );
          return queued.rows[0];
        });
        return res.status(202).json({
          run: { ...runRow, status: 'running' },
          dispatch,
          requestId: requestId(req),
        });
      }
      if (runRow.runtimeBinding === 'openclaw') {
        const definition = openClawRuntimeDefinitionSchema.parse(runRow.definition);
        const message = runRow.input.message;
        if (typeof message !== 'string' || !message.trim() || message.length > 10_000) {
          throw new HttpError(400, 'openclaw_message_invalid');
        }
        const dispatch = await withTransaction(pool, async (client) => {
          const approval = await client.query<{
            id: string;
            targetId: string;
            executorRef: string;
            expiresAt: Date;
            requestPayloadHash: string;
          }>(
            `SELECT aar.id, aar.target_id AS "targetId", at.executor_ref AS "executorRef",
                    aar.expires_at AS "expiresAt", aar.request_payload_hash AS "requestPayloadHash"
               FROM action_approval_requests aar
               JOIN action_policies ap ON ap.id = aar.policy_id
               JOIN action_targets at ON at.id = aar.target_id
              WHERE aar.process_run_id = $1 AND aar.organization_id = $2 AND aar.workspace_id = $3
                AND aar.status = 'approved' AND aar.expires_at > now()
                AND aar.action = $4 AND ap.status = 'active' AND at.status = 'active'
                AND ap.valid_from <= now() AND (ap.valid_until IS NULL OR ap.valid_until > now())
                AND at.key = $5
              FOR UPDATE OF aar`,
            [
              runRow.id,
              runRow.organizationId,
              runRow.workspaceId,
              definition.action,
              definition.targetKey,
            ],
          );
          const approvalRow = approval.rows[0];
          if (!approvalRow) throw new HttpError(409, 'openclaw_approval_required');
          const currentPayloadHash = createHash('sha256')
            .update(JSON.stringify({ message: message.trim() }))
            .digest('hex');
          if (currentPayloadHash !== approvalRow.requestPayloadHash) {
            throw new HttpError(409, 'openclaw_approval_payload_mismatch');
          }
          const idempotencyKey = `process-run:${runRow.id}:openclaw`;
          const metering = await resolveRuntimeMetering(
            client,
            runRow.organizationId,
            'openclaw',
            'action.send_message',
            definition.action,
          );
          const queued = await client.query(
            `INSERT INTO integration_outbox
                (integration_request_id, process_run_id, organization_id, workspace_id,
                 destination, operation, payload, idempotency_key, timeout_ms, metering_snapshot)
             VALUES (NULL, $1, $2, $3, 'openclaw', 'action.send_message', $4, $5, $6, $7)
             ON CONFLICT (destination, idempotency_key) DO UPDATE
               SET updated_at = integration_outbox.updated_at
             RETURNING id, status, attempts, created_at AS "createdAt"`,
            [
              runRow.id,
              runRow.organizationId,
              runRow.workspaceId,
              {
                processRunId: runRow.id,
                action: definition.action,
                executorRef: approvalRow.executorRef,
                message: message.trim(),
                approvalId: approvalRow.id,
                idempotencyKey,
                expiresAt: approvalRow.expiresAt.toISOString(),
              },
              idempotencyKey,
              Number(process.env.OPENCLAW_RUNTIME_TIMEOUT_MS ?? 60_000),
              metering,
            ],
          );
          await client.query(
            `INSERT INTO action_executions
                (organization_id, workspace_id, process_run_id, approval_id, outbox_id,
                 action, executor_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (process_run_id) DO NOTHING`,
            [
              runRow.organizationId,
              runRow.workspaceId,
              runRow.id,
              approvalRow.id,
              queued.rows[0]!.id,
              definition.action,
              approvalRow.executorRef,
            ],
          );
          await client.query(
            `INSERT INTO runtime_events
                (organization_id, workspace_id, process_run_id, actor_id, event_type, payload, idempotency_key)
             VALUES ($1, $2, $3, $4, 'openclaw.dispatch.queued', $5, $6)
             ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
            [
              runRow.organizationId,
              runRow.workspaceId,
              runRow.id,
              context.actorId,
              { outboxId: queued.rows[0]!.id, approvalId: approvalRow.id },
              `${idempotencyKey}:queued`,
            ],
          );
          await client.query(
            `UPDATE flow_runs SET status = 'running'
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
                AND status IN ('queued', 'running')`,
            [runRow.id, runRow.organizationId, runRow.workspaceId],
          );
          return queued.rows[0];
        });
        return res.status(202).json({
          run: { ...runRow, status: 'running' },
          dispatch,
          requestId: requestId(req),
        });
      }
      if (runRow.runtimeBinding === 'n8n') {
        const dispatch = await withTransaction(pool, async (client) => {
          const idempotencyKey = `process-run:${runRow.id}:n8n`;
          const queued = await client.query(
            `INSERT INTO integration_outbox
                (integration_request_id, process_run_id, organization_id, workspace_id,
                 destination, operation, payload, idempotency_key, timeout_ms)
             VALUES (NULL, $1, $2, $3, 'n8n', 'n8n.flow.execute', $4, $5, $6)
             ON CONFLICT (destination, idempotency_key) DO UPDATE
               SET updated_at = integration_outbox.updated_at
             RETURNING id, status, attempts, created_at AS "createdAt"`,
            [
              runRow.id,
              runRow.organizationId,
              runRow.workspaceId,
              {
                processRunId: runRow.id,
                workItemId: runRow.workItemId,
                flowId: runRow.flowId,
                flowVersionId: runRow.flowVersionId,
                actorId: context.actorId,
                input: runRow.input,
                definition: runRow.definition,
              },
              idempotencyKey,
              Number(process.env.N8N_RUNTIME_TIMEOUT_MS ?? 60_000),
            ],
          );
          await client.query(
            `INSERT INTO runtime_events
                (organization_id, workspace_id, process_run_id, actor_id, event_type, payload, idempotency_key)
             VALUES ($1, $2, $3, $4, 'n8n.dispatch.queued', $5, $6)
             ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
            [
              runRow.organizationId,
              runRow.workspaceId,
              runRow.id,
              context.actorId,
              { outboxId: queued.rows[0]!.id },
              `${idempotencyKey}:queued`,
            ],
          );
          await client.query(
            `UPDATE flow_runs SET status = 'running'
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
                AND status IN ('queued', 'running')`,
            [runRow.id, runRow.organizationId, runRow.workspaceId],
          );
          return queued.rows[0];
        });
        return res.status(202).json({
          run: { ...runRow, status: 'running' },
          dispatch,
          requestId: requestId(req),
        });
      }
      if (runRow.runtimeBinding !== 'native') {
        throw new HttpError(409, 'runtime_binding_not_executable');
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
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = createArtifactSchema.parse({ ...req.body, ...context });
      const objectKey = `${input.organizationId}/${input.workspaceId}/artifacts/${createHash(
        'sha256',
      )
        .update(input.idempotencyKey ?? randomUUID())
        .digest('hex')}`;
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
              (organization_id, workspace_id, namespace_id, storage_policy_id,
               process_run_id, artifact_type, object_key, content_type, checksum,
               source_hash, source_version, size_bytes, retention_until,
               integrity_status, status)
           SELECT $1, $2, mn.id, mn.storage_policy_id, $3, $4, $5, $6, $7,
                  $8, $9, $10,
                  now() + (sp.retention_days::text || ' days')::interval,
                  'verified', 'available'
             FROM memory_namespaces mn
             JOIN storage_policies sp ON sp.id = mn.storage_policy_id
            WHERE mn.organization_id = $1 AND mn.key = 'organization-memory'
              AND mn.status = 'active'
           ON CONFLICT (organization_id, object_key) DO NOTHING
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     namespace_id AS "namespaceId", process_run_id AS "processRunId",
                     artifact_type AS "artifactType", object_key AS "objectKey",
                     content_type AS "contentType", checksum, source_hash AS "sourceHash",
                     source_version AS "sourceVersion", size_bytes AS "sizeBytes",
                     retention_until AS "retentionUntil", integrity_status AS "integrityStatus",
                     status, created_at AS "createdAt"`,
          [
            input.organizationId,
            input.workspaceId,
            input.processRunId,
            input.artifactType,
            objectKey,
            input.contentType,
            input.checksum ?? null,
            input.sourceHash ?? null,
            input.sourceVersion ?? null,
            input.sizeBytes ?? null,
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
          [input.organizationId, objectKey],
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

  app.post('/api/v1/artifact-uploads', async (req, res, next) => {
    try {
      if (!options.artifactObjectStore) throw new HttpError(503, 'artifact_storage_not_configured');
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = createArtifactUploadSchema.parse({ ...req.body, ...context });
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const prepared = await withTransaction(pool, async (client) => {
        const existing = await client.query<{
          id: string;
          objectKey: string;
          requestHash: string;
          contentType: string;
          sizeBytes: number;
          checksum: string;
          status: string;
        }>(
          `SELECT a.id, a.object_key AS "objectKey", aui.request_hash AS "requestHash",
                  a.content_type AS "contentType", aui.expected_size_bytes AS "sizeBytes",
                  aui.expected_checksum AS checksum, a.status
             FROM artifact_upload_intents aui
             JOIN artifacts a ON a.id = aui.artifact_id
            WHERE aui.organization_id = $1 AND aui.idempotency_key = $2
            FOR UPDATE`,
          [input.organizationId, input.idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.requestHash !== requestHash) {
            throw new HttpError(409, 'artifact_upload_idempotency_conflict');
          }
          if (existingRow.status !== 'pending') {
            throw new HttpError(409, 'artifact_upload_not_pending');
          }
          await client.query(
            `UPDATE artifact_upload_intents SET expires_at = $1
              WHERE artifact_id = $2 AND consumed_at IS NULL`,
            [expiresAt, existingRow.id],
          );
          return { ...existingRow, idempotent: true };
        }

        const scope = await client.query<{ storagePolicyId: string; retentionDays: number }>(
          `SELECT mn.storage_policy_id AS "storagePolicyId", sp.retention_days AS "retentionDays"
             FROM memory_namespaces mn
             JOIN storage_policies sp ON sp.id = mn.storage_policy_id
             JOIN flow_runs fr ON fr.id = $1
            WHERE mn.id = $2 AND mn.organization_id = $3 AND mn.status = 'active'
              AND sp.mode = 'casio_managed'
              AND fr.organization_id = $3 AND fr.workspace_id = $4`,
          [input.processRunId, input.namespaceId, input.organizationId, input.workspaceId],
        );
        const resolved = scope.rows[0];
        if (!resolved) throw new HttpError(404, 'artifact_scope_not_found');
        const keyHash = createHash('sha256').update(input.idempotencyKey).digest('hex');
        const objectKey = `${input.organizationId}/${input.workspaceId}/${input.namespaceId}/${input.processRunId}/${keyHash}`;
        const artifact = await client.query<{ id: string }>(
          `INSERT INTO artifacts
              (organization_id, workspace_id, namespace_id, storage_policy_id,
               process_run_id, artifact_type, object_key, content_type, checksum,
               source_hash, source_version, size_bytes, retention_until,
               integrity_status, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   now() + ($13::text || ' days')::interval, 'pending', 'pending')
           RETURNING id`,
          [
            input.organizationId,
            input.workspaceId,
            input.namespaceId,
            resolved.storagePolicyId,
            input.processRunId,
            input.artifactType,
            objectKey,
            input.contentType,
            input.checksum,
            input.sourceHash,
            input.sourceVersion,
            input.sizeBytes,
            resolved.retentionDays,
          ],
        );
        const artifactId = artifact.rows[0]!.id;
        await client.query(
          `INSERT INTO artifact_upload_intents
              (artifact_id, organization_id, workspace_id, object_key, idempotency_key,
               request_hash, expected_content_type, expected_size_bytes,
               expected_checksum, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            artifactId,
            input.organizationId,
            input.workspaceId,
            objectKey,
            input.idempotencyKey,
            requestHash,
            input.contentType,
            input.sizeBytes,
            input.checksum,
            expiresAt,
          ],
        );
        return {
          id: artifactId,
          objectKey,
          requestHash,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          status: 'pending',
          idempotent: false,
        };
      });
      const uploadUrl = await options.artifactObjectStore.createUploadUrl({
        objectKey: prepared.objectKey,
        contentType: prepared.contentType,
        sizeBytes: Number(prepared.sizeBytes),
        checksum: prepared.checksum,
        expiresInSeconds: 900,
      });
      return res.status(prepared.idempotent ? 200 : 201).json({
        artifact: { id: prepared.id, status: prepared.status },
        upload: { method: 'PUT', url: uploadUrl, expiresAt: expiresAt.toISOString() },
        idempotent: prepared.idempotent,
        requestId: requestId(req),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/artifact-uploads/:artifactId/complete', async (req, res, next) => {
    try {
      if (!options.artifactObjectStore) throw new HttpError(503, 'artifact_storage_not_configured');
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = completeArtifactUploadSchema.parse({
        ...req.body,
        ...context,
        artifactId: req.params.artifactId,
      });
      const pending = await pool.query<{
        objectKey: string;
        expectedSizeBytes: number;
        expectedChecksum: string;
        expiresAt: Date;
        consumedAt: Date | null;
        status: string;
      }>(
        `SELECT a.object_key AS "objectKey", aui.expected_size_bytes AS "expectedSizeBytes",
                aui.expected_checksum AS "expectedChecksum", aui.expires_at AS "expiresAt",
                aui.consumed_at AS "consumedAt", a.status
           FROM artifact_upload_intents aui
           JOIN artifacts a ON a.id = aui.artifact_id
          WHERE a.id = $1 AND a.organization_id = $2 AND a.workspace_id = $3`,
        [input.artifactId, input.organizationId, input.workspaceId],
      );
      const pendingRow = pending.rows[0];
      if (!pendingRow) throw new HttpError(404, 'artifact_upload_not_found');
      if (pendingRow.consumedAt && pendingRow.status === 'available') {
        return res.json({
          artifact: { id: input.artifactId, status: 'available' },
          idempotent: true,
        });
      }
      if (pendingRow.expiresAt.getTime() <= Date.now()) {
        throw new HttpError(409, 'artifact_upload_expired');
      }
      const observed = await options.artifactObjectStore.headObject(pendingRow.objectKey);
      const integrityMatches =
        observed.sizeBytes === Number(pendingRow.expectedSizeBytes) &&
        observed.sizeBytes === input.observedSizeBytes &&
        observed.checksum === pendingRow.expectedChecksum &&
        observed.checksum === input.observedChecksum;
      if (!integrityMatches) {
        await pool.query(
          `UPDATE artifacts SET integrity_status = 'mismatch', status = 'failed'
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
          [input.artifactId, input.organizationId, input.workspaceId],
        );
        throw new HttpError(409, 'artifact_integrity_mismatch');
      }
      const artifact = await withTransaction(pool, async (client) => {
        await client.query(
          `UPDATE artifact_upload_intents SET consumed_at = now()
            WHERE artifact_id = $1 AND consumed_at IS NULL`,
          [input.artifactId],
        );
        const updated = await client.query(
          `UPDATE artifacts SET integrity_status = 'verified', status = 'available'
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
            RETURNING id, object_key AS "objectKey", status,
                      integrity_status AS "integrityStatus", retention_until AS "retentionUntil"`,
          [input.artifactId, input.organizationId, input.workspaceId],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id)
           VALUES ($1, $2, 'artifact.verified', 'artifact', $3)`,
          [input.organizationId, input.actorId, input.artifactId],
        );
        return updated.rows[0];
      });
      return res.json({ artifact, idempotent: false, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/artifacts/:artifactId/delete', async (req, res, next) => {
    try {
      if (!options.artifactObjectStore) throw new HttpError(503, 'artifact_storage_not_configured');
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const artifact = await pool.query<{ objectKey: string; status: string }>(
        `SELECT a.object_key AS "objectKey", a.status
           FROM artifacts a
           JOIN storage_policies sp ON sp.id = a.storage_policy_id
          WHERE a.id = $1 AND a.organization_id = $2 AND a.workspace_id = $3
            AND sp.deletion_propagation = true`,
        [req.params.artifactId, context.organizationId, context.workspaceId],
      );
      const row = artifact.rows[0];
      if (!row) throw new HttpError(404, 'artifact_not_found');
      if (row.status !== 'deleted') {
        await options.artifactObjectStore.deleteObject(row.objectKey);
        await withTransaction(pool, async (client) => {
          await client.query(
            `UPDATE artifacts
                SET status = 'deleted', integrity_status = 'deleted', deleted_at = now(),
                    deletion_propagated_at = now()
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
            [req.params.artifactId, context.organizationId, context.workspaceId],
          );
          await client.query(
            `INSERT INTO audit_events
                (organization_id, actor_id, event_type, subject_type, subject_id)
             VALUES ($1, $2, 'artifact.deleted', 'artifact', $3)`,
            [context.organizationId, context.actorId, req.params.artifactId],
          );
        });
      }
      return res.json({ artifact: { id: req.params.artifactId, status: 'deleted' } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/artifacts/:artifactId', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
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

  app.post('/api/v1/pricing-assumptions', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createPricingAssumptionSchema.parse({ ...req.body, ...context });
      const pricingVersion = await pool.query(
        `INSERT INTO pricing_assumption_versions
            (organization_id, key, version, status, assumptions, effective_from, effective_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, key, version, status, assumptions,
                   effective_from AS "effectiveFrom", effective_until AS "effectiveUntil",
                   created_at AS "createdAt"`,
        [
          input.organizationId,
          input.key,
          input.version,
          input.status,
          input.assumptions,
          input.effectiveFrom,
          input.effectiveUntil ?? null,
        ],
      );
      return res.status(201).json({
        pricingVersion: pricingVersion.rows[0],
        requestId: requestId(req),
      });
    } catch (error) {
      if (hasPgCode(error, '23505')) {
        return next(new HttpError(409, 'pricing_assumption_version_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/runtime-meter-bindings', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createRuntimeMeterBindingSchema.parse({ ...req.body, ...context });
      const validFrom = input.validFrom ?? new Date().toISOString();
      if (new Date(validFrom).getTime() > Date.now() + 300_000) {
        throw new HttpError(400, 'runtime_meter_future_activation_not_supported');
      }
      const binding = await withTransaction(pool, async (client) => {
        const pricing = await client.query(
          `SELECT 1 FROM pricing_assumption_versions
            WHERE id = $1 AND status = 'active'
              AND effective_from <= $2::timestamptz
              AND (effective_until IS NULL OR effective_until > $2::timestamptz)
              AND (organization_id IS NULL OR organization_id = $3)`,
          [input.pricingVersionId, validFrom, input.organizationId],
        );
        if (pricing.rowCount !== 1) throw new HttpError(404, 'active_pricing_version_not_found');
        await client.query(
          `UPDATE runtime_meter_bindings
              SET status = 'retired', valid_until = $5::timestamptz
            WHERE organization_id = $1 AND runtime = $2 AND operation = $3
              AND resource_key = $4 AND status = 'active'`,
          [input.organizationId, input.runtime, input.operation, input.resourceKey, validFrom],
        );
        const inserted = await client.query(
          `INSERT INTO runtime_meter_bindings
              (organization_id, runtime, operation, resource_key, pricing_version_id,
               currency, payer, direct_unit_cost, input_token_unit_cost,
               output_token_unit_cost, allocated_shared_cost, billable_multiplier,
               valid_from, valid_until, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id, organization_id AS "organizationId", runtime, operation,
                     resource_key AS "resourceKey", pricing_version_id AS "pricingVersionId",
                     currency, payer, direct_unit_cost AS "directUnitCost",
                     input_token_unit_cost AS "inputTokenUnitCost",
                     output_token_unit_cost AS "outputTokenUnitCost",
                     allocated_shared_cost AS "allocatedSharedCost",
                     billable_multiplier AS "billableMultiplier", status,
                     valid_from AS "validFrom", valid_until AS "validUntil",
                     created_at AS "createdAt"`,
          [
            input.organizationId,
            input.runtime,
            input.operation,
            input.resourceKey,
            input.pricingVersionId,
            input.currency,
            input.payer,
            input.directUnitCost,
            input.inputTokenUnitCost,
            input.outputTokenUnitCost,
            input.allocatedSharedCost,
            input.billableMultiplier,
            validFrom,
            input.validUntil ?? null,
            input.actorId,
          ],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ binding, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/internal/v1/usage-events', async (req, res, next) => {
    try {
      if (!internalSecretMatches(req, options.dispatcherSecret)) {
        throw new HttpError(401, 'usage_recorder_not_authorized');
      }
      const input = recordUsageEventSchema.parse(req.body);
      const sourceHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const saved = await withTransaction(pool, async (client) => {
        const scope = await client.query(
          `SELECT 1
             FROM flow_runs fr
             JOIN flows f ON f.id = fr.flow_id
             JOIN flow_versions fv ON fv.id = fr.flow_version_id AND fv.flow_id = f.id
             JOIN memory_namespaces mn ON mn.id = $6
             JOIN pricing_assumption_versions pav ON pav.id = $9
            WHERE fr.id = $5 AND fr.organization_id = $1 AND fr.workspace_id = $2
              AND f.id = $3 AND f.organization_id = $1 AND f.workspace_id = $2
              AND fv.id = $4
              AND mn.organization_id = $1 AND mn.status = 'active'
              AND pav.status = 'active' AND pav.effective_from <= now()
              AND (pav.effective_until IS NULL OR pav.effective_until > now())
              AND (pav.organization_id IS NULL OR pav.organization_id = $1)
              AND (
                ($7::uuid IS NULL AND $8::uuid IS NULL)
                OR EXISTS (
                  SELECT 1 FROM external_tenants et
                   WHERE et.id = $8 AND et.external_app_id = $7
                     AND et.organization_id = $1 AND et.status = 'active'
                )
              )`,
          [
            input.organizationId,
            input.workspaceId,
            input.flowId,
            input.flowVersionId,
            input.processRunId,
            input.namespaceId,
            input.externalAppId ?? null,
            input.externalTenantId ?? null,
            input.pricingVersionId,
          ],
        );
        if (scope.rowCount !== 1) throw new HttpError(404, 'usage_attribution_scope_not_found');
        const existing = await client.query<{ id: string; sourceHash: string }>(
          `SELECT id, source_hash AS "sourceHash" FROM usage_events
            WHERE organization_id = $1 AND idempotency_key = $2 FOR UPDATE`,
          [input.organizationId, input.idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.sourceHash !== sourceHash) {
            throw new HttpError(409, 'usage_idempotency_payload_conflict');
          }
          return { id: existingRow.id, idempotent: true };
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO usage_events
              (organization_id, external_app_id, external_tenant_id, workspace_id,
               flow_id, flow_version_id, process_run_id, namespace_id, operation,
               runtime, model, input_tokens, output_tokens, total_tokens,
               input_bytes, output_bytes, total_bytes, latency_ms, unit_cost,
               allocated_shared_cost, billable_amount, currency, payer,
               pricing_version_id, idempotency_key, source_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                   $12, $13, $12::bigint + $13::bigint, $14, $15, $14::bigint + $15::bigint, $16, $17,
                   $18, $19, $20, $21, $22, $23, $24)
           RETURNING id`,
          [
            input.organizationId,
            input.externalAppId ?? null,
            input.externalTenantId ?? null,
            input.workspaceId,
            input.flowId,
            input.flowVersionId,
            input.processRunId,
            input.namespaceId,
            input.operation,
            input.runtime,
            input.model ?? null,
            input.inputTokens,
            input.outputTokens,
            input.inputBytes,
            input.outputBytes,
            input.latencyMs,
            input.unitCost,
            input.allocatedSharedCost,
            input.billableAmount,
            input.currency,
            input.payer,
            input.pricingVersionId,
            input.idempotencyKey,
            sourceHash,
          ],
        );
        return { id: inserted.rows[0]!.id, idempotent: false };
      });
      return res.status(saved.idempotent ? 200 : 201).json({
        usageEvent: { id: saved.id },
        idempotent: saved.idempotent,
        requestId: requestId(req),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/usage/summary', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const view = req.query.view;
      if (view !== 'casioplus_pnl' && view !== 'ecosystem_tco') {
        throw new HttpError(400, 'usage_summary_view_invalid');
      }
      const relation =
        view === 'casioplus_pnl' ? 'casioplus_pnl_usage_view' : 'ecosystem_tco_usage_view';
      const summary = await pool.query(
        `SELECT * FROM ${relation} WHERE organization_id = $1 AND workspace_id = $2`,
        [context.organizationId, context.workspaceId],
      );
      return res.json({ view, summary: summary.rows, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/semantic-records', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
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
              (organization_id, workspace_id, namespace_id, work_item_id, process_run_id,
               record_type, title, summary, payload, outcome, provenance, status, created_by_actor_id)
           VALUES ($1, $2,
                   (SELECT id FROM memory_namespaces
                     WHERE organization_id = $1 AND key = 'organization-memory' AND status = 'active'
                     LIMIT 1),
                   $3, $4, $5, $6, $7, $8, $8, $9, 'pending_review', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     namespace_id AS "namespaceId", work_item_id AS "workItemId",
                     process_run_id AS "processRunId",
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
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, authorRoles, enforceMembership);
      const input = createKnowledgeClaimSchema.parse({ ...req.body, ...context });
      const claim = await withTransaction(pool, async (client) => {
        const source = await client.query<{ namespaceId: string }>(
          `SELECT namespace_id AS "namespaceId" FROM semantic_records
            WHERE id = $1 AND process_run_id = $2
              AND organization_id = $3 AND workspace_id = $4`,
          [input.semanticRecordId, input.processRunId, input.organizationId, input.workspaceId],
        );
        if (source.rowCount !== 1) {
          throw new HttpError(404, 'knowledge_claim_source_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO knowledge_claims
              (organization_id, workspace_id, namespace_id, semantic_record_id, process_run_id, subject,
               claim_type, content, evidence, confidence, lifecycle, created_by_actor_id)
           VALUES ($1, $2, $11, $3, $4, $5, $6, $7, $8, $9, 'pending_review', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     namespace_id AS "namespaceId", semantic_record_id AS "semanticRecordId",
                     process_run_id AS "processRunId",
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
            source.rows[0]!.namespaceId,
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
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
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, reviewerRoles, enforceMembership);
      const input = knowledgePromotionSchema.parse({
        ...req.body,
        ...context,
        claimId: req.params.claimId,
      });
      const memory = await withTransaction(pool, async (client) => {
        const claim = await client.query<{
          semanticRecordId: string;
          namespaceId: string;
          lifecycle: string;
        }>(
          `SELECT semantic_record_id AS "semanticRecordId", namespace_id AS "namespaceId", lifecycle
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
              (organization_id, workspace_id, namespace_id, claim_id, review_id, target_kind,
               promoted_by_actor_id, rationale)
           VALUES ($1, $2, $8, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            input.organizationId,
            input.workspaceId,
            input.claimId,
            input.reviewId,
            input.targetKind,
            input.actorId,
            input.rationale,
            claimRow.namespaceId,
          ],
        );
        const inserted = await client.query(
          `INSERT INTO organizational_memory_items
              (organization_id, workspace_id, namespace_id, kind, title, content,
               source_semantic_record_id, source_claim_id, promotion_id, source_review_id,
               lifecycle, sensitivity)
           VALUES ($1, $2, $11, $3, $4, $5, $6, $7, $8, $9, 'approved', $10)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     namespace_id AS "namespaceId", kind, title, content,
                     source_semantic_record_id AS "sourceSemanticRecordId",
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
            claimRow.namespaceId,
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

  app.post('/api/v1/memory/namespaces', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createMemoryNamespaceSchema.parse({ ...req.body, ...context });
      const namespace = await withTransaction(pool, async (client) => {
        const targetWorkspaceId = input.targetWorkspaceId ?? null;
        if (targetWorkspaceId) {
          const workspace = await client.query(
            `SELECT 1 FROM workspaces
              WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
            [targetWorkspaceId, input.organizationId],
          );
          if (workspace.rowCount !== 1) throw new HttpError(404, 'workspace_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO memory_namespaces
              (organization_id, workspace_id, storage_policy_id, key, name, namespace_kind)
           SELECT $1, $2, sp.id, $3, $4, $5
             FROM storage_policies sp WHERE sp.organization_id = $1
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     key, name, namespace_kind AS "namespaceKind", visibility, status,
                     created_at AS "createdAt"`,
          [input.organizationId, targetWorkspaceId, input.key, input.name, input.namespaceKind],
        );
        if (inserted.rowCount !== 1) throw new HttpError(409, 'storage_policy_required');
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id)
           VALUES ($1, $2, 'memory.namespace_created', 'memory_namespace', $3)`,
          [input.organizationId, input.actorId, inserted.rows[0].id],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ namespace, requestId: requestId(req) });
    } catch (error) {
      if (hasPgCode(error, '23505')) {
        return next(new HttpError(409, 'memory_namespace_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/memory/grants', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const input = createMemoryGrantSchema.parse({ ...req.body, ...context });
      const grant = await withTransaction(pool, async (client) => {
        const namespace = await client.query(
          `SELECT 1 FROM memory_namespaces
            WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
          [input.namespaceId, input.organizationId],
        );
        if (namespace.rowCount !== 1) throw new HttpError(404, 'memory_namespace_not_found');
        if (input.granteeOrganizationId === input.organizationId) {
          throw new HttpError(409, 'cross_tenant_grant_required');
        }
        if (input.flowId) {
          const flow = await client.query(
            `SELECT 1 FROM flows WHERE id = $1 AND organization_id = $2`,
            [input.flowId, input.granteeOrganizationId],
          );
          if (flow.rowCount !== 1) throw new HttpError(404, 'grantee_flow_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO memory_grants
              (grantor_organization_id, grantee_organization_id, namespace_id,
               purpose, flow_id, allowed_kinds, allowed_sensitivities, scope,
               valid_until, created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, grantor_organization_id AS "grantorOrganizationId",
                     grantee_organization_id AS "granteeOrganizationId",
                     namespace_id AS "namespaceId", purpose, flow_id AS "flowId",
                     allowed_kinds AS "allowedKinds",
                     allowed_sensitivities AS "allowedSensitivities", scope,
                     valid_from AS "validFrom", valid_until AS "validUntil"`,
          [
            input.organizationId,
            input.granteeOrganizationId,
            input.namespaceId,
            input.purpose,
            input.flowId ?? null,
            input.allowedKinds,
            input.allowedSensitivities,
            input.scope,
            input.validUntil,
            input.actorId,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id,
               metadata)
           VALUES ($1, $2, 'memory.grant_created', 'memory_grant', $3, $4)`,
          [
            input.organizationId,
            input.actorId,
            inserted.rows[0].id,
            { purpose: input.purpose, granteeOrganizationId: input.granteeOrganizationId },
          ],
        );
        return inserted.rows[0];
      });
      return res.status(201).json({ grant, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/memory/grants/:grantId/revoke', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, administrativeRoles, enforceMembership);
      const revoked = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE memory_grants
              SET revoked_at = now(), revoked_by_actor_id = $1
            WHERE id = $2 AND grantor_organization_id = $3 AND revoked_at IS NULL
            RETURNING id, revoked_at AS "revokedAt"`,
          [context.actorId, req.params.grantId, context.organizationId],
        );
        if (updated.rowCount !== 1) throw new HttpError(404, 'memory_grant_not_found');
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id)
           VALUES ($1, $2, 'memory.grant_revoked', 'memory_grant', $3)`,
          [context.organizationId, context.actorId, req.params.grantId],
        );
        return updated.rows[0];
      });
      return res.json({ grant: revoked, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/memory/graph', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = governedMemoryGraphSchema.parse({
        ...context,
        purpose: req.query.purpose,
        flowId: typeof req.query.flowId === 'string' ? req.query.flowId : undefined,
        namespaceIds:
          typeof req.query.namespaceIds === 'string'
            ? req.query.namespaceIds.split(',').filter(Boolean)
            : undefined,
        limit: Number(req.query.limit ?? 60),
      });
      const result = await retrieveGovernedMemoryGraph(pool, input);
      return res.json({ ...result, requestId: requestId(req) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/memory/search', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireMembership(pool, context, participantRoles, enforceMembership);
      const input = governedRetrievalSchema.parse({
        ...context,
        query: req.query.query,
        purpose: req.query.purpose,
        flowId: typeof req.query.flowId === 'string' ? req.query.flowId : undefined,
        namespaceIds:
          typeof req.query.namespaceIds === 'string'
            ? req.query.namespaceIds.split(',').filter(Boolean)
            : undefined,
        limit: Number(req.query.limit ?? 10),
        allowedKinds:
          typeof req.query.allowedKinds === 'string'
            ? req.query.allowedKinds.split(',').filter(Boolean)
            : undefined,
      });
      const result = await retrieveGovernedMemory(pool, input);
      return res.json({ ...result, requestId: requestId(req) });
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
