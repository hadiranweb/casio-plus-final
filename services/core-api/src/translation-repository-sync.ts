import { createHash } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import {
  repositoryOpenTranslationPrPayloadSchema,
  requestTranslationRepositoryApprovalSchema,
  queueTranslationRepositorySyncSchema,
  translationRepositoryWebhookEventSchema,
} from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';

const REPOSITORY_ACTION = 'repository.open_translation_pr' as const;
const OUTBOX_OPERATION = 'action.repository.open_translation_pr' as const;
const EXECUTOR_REF = 'github-app.casio-plus-final' as const;
const REPOSITORY_FULL_NAME = 'hadiranweb/casio-plus-final' as const;
const BASE_REF = 'main' as const;
const CATALOG_PATH = 'packages/i18n/messages/fa.json' as const;
const SOURCE_CATALOG_PATH = 'packages/i18n/messages/en.json' as const;

type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';
type TenantContext = { organizationId: string; workspaceId: string; actorId: string };
type Dependencies = {
  pool: Pool;
  resolveTenantContext: (request: Request) => TenantContext | Promise<TenantContext>;
  requireRoles: (context: TenantContext, roles: OrganizationRole[]) => Promise<void>;
  error: (statusCode: number, code: string) => Error;
  requestId: (request: Request) => string;
};

type ChangeSetRow = {
  id: string;
  processRunId: string;
  flowId: string;
  flowVersionId: string;
  repositoryFullName: string;
  baseRef: string;
  baseCommitSha: string;
  catalogHash: string;
  sourceLocale: string;
  targetLocale: string;
  status: string;
  expiresAt: Date;
  approvalId: string | null;
};

type ReviewedItemRow = {
  id: string;
  messageKey: string;
  sourceText: string;
  currentTargetText: string | null;
  proposedText: string;
  reviewedText: string | null;
  sourceHash: string;
  currentTargetHash: string | null;
  proposalHash: string;
  placeholderSignature: string[];
  status: 'accepted' | 'edited';
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function jsonHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function approvalPayload(changeSet: ChangeSetRow, items: ReviewedItemRow[]) {
  return {
    changeSetId: changeSet.id,
    repositoryFullName: changeSet.repositoryFullName,
    baseRef: changeSet.baseRef,
    baseCommitSha: changeSet.baseCommitSha,
    catalogHash: changeSet.catalogHash,
    sourceLocale: changeSet.sourceLocale,
    targetLocale: changeSet.targetLocale,
    items: items
      .map((item) => ({
        id: item.id,
        messageKey: item.messageKey,
        sourceHash: item.sourceHash,
        currentTargetHash: item.currentTargetHash,
        proposalHash: item.proposalHash,
        status: item.status,
        reviewedTextHash: createHash('sha256')
          .update(item.reviewedText ?? item.proposedText, 'utf8')
          .digest('hex'),
      }))
      .sort((left, right) => left.messageKey.localeCompare(right.messageKey)),
  };
}

async function loadChangeSetForUpdate(
  client: PoolClient,
  input: { changeSetId: string; organizationId: string; workspaceId: string },
): Promise<ChangeSetRow | undefined> {
  const result = await client.query<ChangeSetRow>(
    `SELECT id, process_run_id AS "processRunId", flow_id AS "flowId",
            flow_version_id AS "flowVersionId", repository_full_name AS "repositoryFullName",
            base_ref AS "baseRef", base_commit_sha AS "baseCommitSha",
            catalog_hash AS "catalogHash", source_locale AS "sourceLocale",
            target_locale AS "targetLocale", status, expires_at AS "expiresAt",
            approval_id AS "approvalId"
       FROM translation_change_sets
      WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
      FOR UPDATE`,
    [input.changeSetId, input.organizationId, input.workspaceId],
  );
  return result.rows[0];
}

async function loadReviewedItems(
  client: PoolClient,
  changeSetId: string,
  organizationId: string,
  workspaceId: string,
): Promise<ReviewedItemRow[]> {
  const result = await client.query<ReviewedItemRow>(
    `SELECT id, message_key AS "messageKey", source_text AS "sourceText",
            current_target_text AS "currentTargetText", proposed_text AS "proposedText",
            reviewed_text AS "reviewedText", source_hash AS "sourceHash",
            current_target_hash AS "currentTargetHash", proposal_hash AS "proposalHash",
            placeholder_signature AS "placeholderSignature", status
       FROM translation_change_set_items
      WHERE change_set_id = $1 AND organization_id = $2 AND workspace_id = $3
        AND status IN ('accepted', 'edited')
      ORDER BY message_key`,
    [changeSetId, organizationId, workspaceId],
  );
  return result.rows;
}

async function resolveRepositoryMetering(
  client: PoolClient,
  organizationId: string,
  resourceKey: string,
  error: Dependencies['error'],
) {
  const result = await client.query(
    `SELECT rmb.id AS "bindingId", rmb.pricing_version_id AS "pricingVersionId",
            rmb.runtime, rmb.operation, rmb.resource_key AS "resourceKey",
            rmb.currency, rmb.payer, rmb.direct_unit_cost AS "directUnitCost",
            rmb.input_token_unit_cost AS "inputTokenUnitCost",
            rmb.output_token_unit_cost AS "outputTokenUnitCost",
            rmb.allocated_shared_cost AS "allocatedSharedCost",
            rmb.billable_multiplier AS "billableMultiplier"
       FROM runtime_meter_bindings rmb
       JOIN pricing_assumption_versions pav ON pav.id = rmb.pricing_version_id
      WHERE rmb.organization_id = $1 AND rmb.runtime = 'openclaw'
        AND rmb.operation = $2 AND rmb.resource_key = $3
        AND rmb.status = 'active' AND rmb.valid_from <= now()
        AND (rmb.valid_until IS NULL OR rmb.valid_until > now())
        AND pav.status = 'active'
      ORDER BY rmb.valid_from DESC LIMIT 1`,
    [organizationId, OUTBOX_OPERATION, resourceKey],
  );
  const row = result.rows[0];
  if (!row) throw error(409, 'translation_repository_metering_binding_required');
  return row;
}

export function mountTranslationRepositorySyncRoutes(
  app: Express,
  dependencies: Dependencies,
): void {
  const { pool, resolveTenantContext, requireRoles, error, requestId } = dependencies;
  const approvalRequesterRoles: OrganizationRole[] = ['owner', 'admin', 'reviewer'];
  const queueRoles: OrganizationRole[] = ['owner', 'admin', 'editor', 'reviewer'];

  app.post(
    '/api/v1/translation-change-sets/:changeSetId/request-approval',
    async (req, res, next) => {
      try {
        const context = await resolveTenantContext(req);
        await requireRoles(context, approvalRequesterRoles);
        const input = requestTranslationRepositoryApprovalSchema.parse({
          ...req.body,
          ...context,
          changeSetId: req.params.changeSetId,
        });
        const result = await withTransaction(pool, async (client) => {
          const changeSet = await loadChangeSetForUpdate(client, input);
          if (!changeSet) throw error(404, 'translation_change_set_not_found');
          if (changeSet.expiresAt.getTime() <= Date.now()) {
            throw error(409, 'translation_change_set_expired');
          }
          if (
            changeSet.repositoryFullName !== REPOSITORY_FULL_NAME ||
            changeSet.baseRef !== BASE_REF ||
            changeSet.sourceLocale !== 'en' ||
            changeSet.targetLocale !== 'fa'
          ) {
            throw error(409, 'translation_repository_scope_invalid');
          }
          if (changeSet.approvalId) {
            const existing = await client.query(
              `SELECT id, status, expires_at AS "expiresAt"
                 FROM action_approval_requests
                WHERE id = $1 AND organization_id = $2 AND workspace_id = $3`,
              [changeSet.approvalId, input.organizationId, input.workspaceId],
            );
            const approval = existing.rows[0];
            if (!approval) throw error(409, 'translation_approval_link_invalid');
            return { approval, changeSet, idempotent: true };
          }
          if (changeSet.status !== 'ready_for_approval') {
            throw error(409, 'translation_change_set_not_ready_for_approval');
          }
          const items = await loadReviewedItems(
            client,
            changeSet.id,
            input.organizationId,
            input.workspaceId,
          );
          if (items.length < 1) throw error(409, 'translation_change_set_has_no_accepted_items');
          const policy = await client.query<{
            id: string;
            targetId: string;
            riskClass: 'low' | 'medium' | 'high';
          }>(
            `SELECT ap.id, ap.target_id AS "targetId", ap.risk_class AS "riskClass"
               FROM action_policies ap
               JOIN action_targets at ON at.id = ap.target_id
              WHERE ap.organization_id = $1 AND ap.workspace_id = $2
                AND ap.flow_id = $3 AND ap.flow_version_id = $4
                AND ap.action = $5 AND ap.status = 'active' AND ap.approval_required
                AND ap.valid_from <= now() AND (ap.valid_until IS NULL OR ap.valid_until > now())
                AND at.action = $5 AND at.executor_ref = $6 AND at.status = 'active'
              LIMIT 1`,
            [
              input.organizationId,
              input.workspaceId,
              changeSet.flowId,
              changeSet.flowVersionId,
              REPOSITORY_ACTION,
              EXECUTOR_REF,
            ],
          );
          const policyRow = policy.rows[0];
          if (!policyRow) throw error(403, 'translation_repository_action_not_allowlisted');
          const requestPayload = approvalPayload(changeSet, items);
          const requestPayloadHash = jsonHash(requestPayload);
          const inserted = await client.query(
            `INSERT INTO action_approval_requests
                (organization_id, workspace_id, process_run_id, policy_id, target_id, action,
                 risk_class, request_payload, request_payload_hash, requested_by_actor_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                     LEAST($11::timestamptz, now() + ($12::text || ' seconds')::interval))
             RETURNING id, process_run_id AS "processRunId", policy_id AS "policyId",
                       target_id AS "targetId", action, risk_class AS "riskClass",
                       status, expires_at AS "expiresAt", created_at AS "createdAt"`,
            [
              input.organizationId,
              input.workspaceId,
              changeSet.processRunId,
              policyRow.id,
              policyRow.targetId,
              REPOSITORY_ACTION,
              policyRow.riskClass,
              requestPayload,
              requestPayloadHash,
              input.actorId,
              changeSet.expiresAt.toISOString(),
              input.expiresInSeconds,
            ],
          );
          const approval = inserted.rows[0]!;
          await client.query(
            `UPDATE translation_change_sets
                SET status = 'pending_approval', approval_id = $1, updated_at = now()
              WHERE id = $2`,
            [approval.id, changeSet.id],
          );
          await client.query(
            `INSERT INTO audit_events
                (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
             VALUES ($1, 'translation.repository_approval_requested', $2,
                     'translation_change_set', $3, $4)`,
            [
              input.organizationId,
              input.actorId,
              changeSet.id,
              {
                workspaceId: input.workspaceId,
                approvalId: approval.id,
                requestPayloadHash,
                action: REPOSITORY_ACTION,
              },
            ],
          );
          return {
            approval,
            changeSet: { ...changeSet, status: 'pending_approval', approvalId: approval.id },
            idempotent: false,
          };
        });
        return res.status(result.idempotent ? 200 : 201).json({
          ...result,
          requestId: requestId(req),
        });
      } catch (caught) {
        next(caught);
      }
    },
  );

  app.post('/api/v1/translation-change-sets/:changeSetId/queue-sync', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireRoles(context, queueRoles);
      const input = queueTranslationRepositorySyncSchema.parse({
        ...req.body,
        ...context,
        changeSetId: req.params.changeSetId,
      });
      const result = await withTransaction(pool, async (client) => {
        const changeSet = await loadChangeSetForUpdate(client, input);
        if (!changeSet) throw error(404, 'translation_change_set_not_found');
        if (changeSet.status === 'sync_queued' || changeSet.status === 'pr_opened') {
          const existing = await client.query(
            `SELECT id, status, attempts, created_at AS "createdAt"
               FROM integration_outbox WHERE id = (
                 SELECT outbox_id FROM translation_change_sets WHERE id = $1
               )`,
            [changeSet.id],
          );
          return { dispatch: existing.rows[0], idempotent: true };
        }
        if (changeSet.status !== 'approved' || !changeSet.approvalId) {
          throw error(409, 'translation_repository_approval_required');
        }
        if (changeSet.expiresAt.getTime() <= Date.now()) {
          throw error(409, 'translation_change_set_expired');
        }
        const approval = await client.query<{
          id: string;
          executorRef: string;
          expiresAt: Date;
          requestPayloadHash: string;
          resourceKey: string;
        }>(
          `SELECT aar.id, at.executor_ref AS "executorRef", aar.expires_at AS "expiresAt",
                  aar.request_payload_hash AS "requestPayloadHash", at.action AS "resourceKey"
             FROM action_approval_requests aar
             JOIN action_policies ap ON ap.id = aar.policy_id
             JOIN action_targets at ON at.id = aar.target_id
            WHERE aar.id = $1 AND aar.organization_id = $2 AND aar.workspace_id = $3
              AND aar.status = 'approved' AND aar.action = $4 AND aar.expires_at > now()
              AND ap.status = 'active' AND ap.valid_from <= now()
              AND (ap.valid_until IS NULL OR ap.valid_until > now())
              AND at.status = 'active' AND at.action = $4 AND at.executor_ref = $5
            FOR UPDATE OF aar`,
          [
            changeSet.approvalId,
            input.organizationId,
            input.workspaceId,
            REPOSITORY_ACTION,
            EXECUTOR_REF,
          ],
        );
        const approvalRow = approval.rows[0];
        if (!approvalRow) throw error(409, 'translation_repository_approval_required');
        const items = await loadReviewedItems(
          client,
          changeSet.id,
          input.organizationId,
          input.workspaceId,
        );
        if (items.length < 1) throw error(409, 'translation_change_set_has_no_accepted_items');
        if (jsonHash(approvalPayload(changeSet, items)) !== approvalRow.requestPayloadHash) {
          throw error(409, 'translation_repository_approval_payload_mismatch');
        }
        const idempotencyKey = `translation-sync:${changeSet.id}`;
        const branchRef = `casioplus/translation/${changeSet.id}`;
        const payload = repositoryOpenTranslationPrPayloadSchema.parse({
          action: REPOSITORY_ACTION,
          executorRef: approvalRow.executorRef,
          changeSetId: changeSet.id,
          approvalId: approvalRow.id,
          processRunId: changeSet.processRunId,
          repositoryFullName: changeSet.repositoryFullName,
          baseRef: changeSet.baseRef,
          baseCommitSha: changeSet.baseCommitSha,
          catalogHash: changeSet.catalogHash,
          sourceLocale: changeSet.sourceLocale,
          targetLocale: changeSet.targetLocale,
          branchRef,
          catalogPath: CATALOG_PATH,
          sourceCatalogPath: SOURCE_CATALOG_PATH,
          items: items.map((item) => ({
            messageKey: item.messageKey,
            sourceText: item.sourceText,
            currentTargetText: item.currentTargetText,
            reviewedText: item.reviewedText ?? item.proposedText,
            sourceHash: item.sourceHash,
            currentTargetHash: item.currentTargetHash,
            placeholderSignature: item.placeholderSignature,
          })),
          idempotencyKey,
          expiresAt: approvalRow.expiresAt.toISOString(),
        });
        const metering = await resolveRepositoryMetering(
          client,
          input.organizationId,
          approvalRow.resourceKey,
          error,
        );
        const queued = await client.query(
          `INSERT INTO integration_outbox
              (integration_request_id, process_run_id, organization_id, workspace_id,
               destination, operation, payload, idempotency_key, timeout_ms, metering_snapshot)
           VALUES (NULL, $1, $2, $3, 'openclaw', $4, $5, $6, $7, $8)
           ON CONFLICT (destination, idempotency_key) DO UPDATE
             SET updated_at = integration_outbox.updated_at
           RETURNING id, status, attempts, created_at AS "createdAt"`,
          [
            changeSet.processRunId,
            input.organizationId,
            input.workspaceId,
            OUTBOX_OPERATION,
            payload,
            idempotencyKey,
            Number(process.env.OPENCLAW_RUNTIME_TIMEOUT_MS ?? 60_000),
            metering,
          ],
        );
        const dispatch = queued.rows[0]!;
        await client.query(
          `INSERT INTO action_executions
              (organization_id, workspace_id, process_run_id, approval_id, outbox_id,
               action, executor_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (approval_id) DO NOTHING`,
          [
            input.organizationId,
            input.workspaceId,
            changeSet.processRunId,
            approvalRow.id,
            dispatch.id,
            REPOSITORY_ACTION,
            approvalRow.executorRef,
          ],
        );
        await client.query(
          `UPDATE translation_change_sets
              SET status = 'sync_queued', outbox_id = $1, repository_branch_ref = $2,
                  sync_requested_at = now(), failure_code = NULL, updated_at = now()
            WHERE id = $3`,
          [dispatch.id, branchRef, changeSet.id],
        );
        await client.query(
          `INSERT INTO runtime_events
              (organization_id, workspace_id, process_run_id, actor_id, event_type, payload,
               idempotency_key)
           VALUES ($1, $2, $3, $4, 'translation.repository_sync.queued', $5, $6)
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
          [
            input.organizationId,
            input.workspaceId,
            changeSet.processRunId,
            input.actorId,
            { changeSetId: changeSet.id, approvalId: approvalRow.id, outboxId: dispatch.id },
            `${idempotencyKey}:queued`,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'translation.repository_sync_queued', $2,
                   'translation_change_set', $3, $4)`,
          [
            input.organizationId,
            input.actorId,
            changeSet.id,
            { workspaceId: input.workspaceId, approvalId: approvalRow.id, outboxId: dispatch.id },
          ],
        );
        return { dispatch, idempotent: false };
      });
      return res.status(result.idempotent ? 200 : 202).json({
        ...result,
        requestId: requestId(req),
      });
    } catch (caught) {
      next(caught);
    }
  });
}

export async function applyTranslationRepositoryWebhookEvent(
  client: PoolClient,
  scope: { organizationId: string; workspaceId: string; deliveryId: string },
  rawPayload: unknown,
): Promise<{ changeSetId: string; status: 'pr_opened' | 'merged' | 'failed' }> {
  const event = translationRepositoryWebhookEventSchema.parse(rawPayload);
  const current = await client.query<{
    id: string;
    status: string;
    repositoryBranchRef: string | null;
    pullRequestNumber: number | null;
  }>(
    `SELECT id, status, repository_branch_ref AS "repositoryBranchRef",
            pull_request_number AS "pullRequestNumber"
       FROM translation_change_sets
      WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
      FOR UPDATE`,
    [event.changeSetId, scope.organizationId, scope.workspaceId],
  );
  const row = current.rows[0];
  if (!row) throw new Error('translation_change_set_not_found');
  if (!['sync_queued', 'pr_opened', 'merged', 'failed'].includes(row.status)) {
    throw new Error('translation_webhook_state_invalid');
  }
  if (row.repositoryBranchRef && row.repositoryBranchRef !== event.branchRef) {
    throw new Error('translation_webhook_branch_mismatch');
  }
  if (row.pullRequestNumber && row.pullRequestNumber !== event.pullRequestNumber) {
    throw new Error('translation_webhook_pull_request_mismatch');
  }
  const status = event.merged ? 'merged' : event.action === 'closed' ? 'failed' : 'pr_opened';
  await client.query(
    `UPDATE translation_change_sets
        SET status = $1, repository_branch_ref = $2, pull_request_number = $3,
            pull_request_url = $4, pull_request_head_sha = $5,
            pull_request_opened_at = COALESCE(pull_request_opened_at, now()),
            merged_at = CASE WHEN $1 = 'merged' THEN COALESCE(merged_at, now()) ELSE merged_at END,
            failure_code = CASE WHEN $1 = 'failed' THEN 'translation_pull_request_closed' ELSE NULL END,
            last_webhook_delivery_id = $6, updated_at = now()
      WHERE id = $7`,
    [
      status,
      event.branchRef,
      event.pullRequestNumber,
      event.pullRequestUrl,
      event.pullRequestHeadSha,
      scope.deliveryId,
      event.changeSetId,
    ],
  );
  await client.query(
    `INSERT INTO audit_events
        (organization_id, event_type, subject_type, subject_id, metadata)
     VALUES ($1, $2, 'translation_change_set', $3, $4)`,
    [
      scope.organizationId,
      `translation.repository_pr_${status}`,
      event.changeSetId,
      {
        workspaceId: scope.workspaceId,
        deliveryId: scope.deliveryId,
        pullRequestNumber: event.pullRequestNumber,
        pullRequestHeadSha: event.pullRequestHeadSha,
      },
    ],
  );
  return { changeSetId: event.changeSetId, status };
}
