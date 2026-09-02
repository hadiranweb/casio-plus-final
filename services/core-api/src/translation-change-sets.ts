import { createHash } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool } from 'pg';
import {
  completeTranslationChangeSetReviewSchema,
  createTranslationChangeSetSchema,
  reviewTranslationChangeSetItemSchema,
  submitTranslationChangeSetSchema,
} from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';

type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';
type TenantContext = {
  organizationId: string;
  workspaceId: string;
  actorId: string;
};
type Dependencies = {
  pool: Pool;
  resolveTenantContext: (request: Request) => TenantContext | Promise<TenantContext>;
  requireRoles: (context: TenantContext, roles: OrganizationRole[]) => Promise<void>;
  error: (statusCode: number, code: string) => Error;
  requestId: (request: Request) => string;
};

const authorRoles: OrganizationRole[] = ['owner', 'admin', 'editor'];
const reviewerRoles: OrganizationRole[] = ['owner', 'admin', 'reviewer'];
const viewerRoles: OrganizationRole[] = ['owner', 'admin', 'editor', 'reviewer'];
const allowedListStatuses = [
  'draft',
  'ready_for_review',
  'ready_for_approval',
  'pending_approval',
  'approved',
  'rejected',
  'sync_queued',
  'pr_opened',
  'merged',
  'failed',
  'expired',
] as const;

function textHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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

function jsonHash(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function extractPlaceholderSignature(value: string) {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1]!)
    .filter((placeholder, index, values) => values.indexOf(placeholder) === index)
    .sort();
}

function signaturesMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateProposalPlaceholders(
  sourceText: string,
  currentTargetText: string | null | undefined,
  proposedText: string,
  assertedSignature: string[],
  error: Dependencies['error'],
) {
  const source = extractPlaceholderSignature(sourceText);
  const proposal = extractPlaceholderSignature(proposedText);
  const asserted = [...new Set(assertedSignature)].sort();
  const current = currentTargetText ? extractPlaceholderSignature(currentTargetText) : source;
  if (
    !signaturesMatch(source, proposal) ||
    !signaturesMatch(source, current) ||
    !signaturesMatch(source, asserted)
  ) {
    throw error(400, 'translation_placeholder_signature_mismatch');
  }
  return source;
}

function changeSetSelect(alias = 'tcs') {
  return `${alias}.id,
          ${alias}.process_run_id AS "processRunId",
          ${alias}.flow_id AS "flowId",
          ${alias}.flow_version_id AS "flowVersionId",
          ${alias}.repository_full_name AS "repositoryFullName",
          ${alias}.base_ref AS "baseRef",
          ${alias}.base_commit_sha AS "baseCommitSha",
          ${alias}.catalog_hash AS "catalogHash",
          ${alias}.source_locale AS "sourceLocale",
          ${alias}.target_locale AS "targetLocale",
          ${alias}.status,
          ${alias}.request_hash AS "requestHash",
          ${alias}.provenance,
          ${alias}.requested_by_actor_id AS "requestedByActorId",
          ${alias}.submitted_at AS "submittedAt",
          ${alias}.review_completed_at AS "reviewCompletedAt",
          ${alias}.approval_id AS "approvalId",
          ${alias}.outbox_id AS "outboxId",
          ${alias}.repository_branch_ref AS "repositoryBranchRef",
          ${alias}.pull_request_number AS "pullRequestNumber",
          ${alias}.pull_request_url AS "pullRequestUrl",
          ${alias}.pull_request_head_sha AS "pullRequestHeadSha",
          ${alias}.sync_requested_at AS "syncRequestedAt",
          ${alias}.pull_request_opened_at AS "pullRequestOpenedAt",
          ${alias}.merged_at AS "mergedAt",
          ${alias}.failure_code AS "failureCode",
          ${alias}.expires_at AS "expiresAt",
          ${alias}.created_at AS "createdAt",
          ${alias}.updated_at AS "updatedAt"`;
}

function itemSelect(alias = 'tcsi') {
  return `${alias}.id,
          ${alias}.change_set_id AS "changeSetId",
          ${alias}.message_key AS "messageKey",
          ${alias}.source_locale AS "sourceLocale",
          ${alias}.target_locale AS "targetLocale",
          ${alias}.source_text AS "sourceText",
          ${alias}.current_target_text AS "currentTargetText",
          ${alias}.proposed_text AS "proposedText",
          ${alias}.reviewed_text AS "reviewedText",
          ${alias}.source_hash AS "sourceHash",
          ${alias}.current_target_hash AS "currentTargetHash",
          ${alias}.proposal_hash AS "proposalHash",
          ${alias}.placeholder_signature AS "placeholderSignature",
          ${alias}.context,
          ${alias}.status,
          ${alias}.reviewed_by_actor_id AS "reviewedByActorId",
          ${alias}.review_reason AS "reviewReason",
          ${alias}.reviewed_at AS "reviewedAt",
          ${alias}.created_at AS "createdAt",
          ${alias}.updated_at AS "updatedAt"`;
}

export function mountTranslationChangeSetRoutes(app: Express, dependencies: Dependencies) {
  const { pool, resolveTenantContext, requireRoles, error, requestId } = dependencies;

  app.post('/api/v1/translation-change-sets', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireRoles(context, authorRoles);
      const input = createTranslationChangeSetSchema.parse({ ...req.body, ...context });
      const allowedRepository =
        process.env.CASIOPLUS_TRANSLATION_REPOSITORY_FULL_NAME ?? 'hadiranweb/casio-plus-final';
      const allowedBaseRef = process.env.CASIOPLUS_TRANSLATION_BASE_REF ?? 'main';
      if (input.repositoryFullName !== allowedRepository || input.baseRef !== allowedBaseRef) {
        throw error(403, 'translation_repository_not_allowlisted');
      }
      if (input.sourceLocale !== 'en' || input.targetLocale !== 'fa') {
        throw error(400, 'translation_direction_not_allowed');
      }
      const uniqueKeys = new Set(input.items.map((item) => item.messageKey));
      if (uniqueKeys.size !== input.items.length) {
        throw error(400, 'translation_message_key_duplicate');
      }
      const preparedItems = input.items.map((item) => ({
        ...item,
        placeholderSignature: validateProposalPlaceholders(
          item.sourceText,
          item.currentTargetText,
          item.proposedText,
          item.placeholderSignature,
          error,
        ),
        sourceHash: textHash(item.sourceText),
        currentTargetHash: item.currentTargetText ? textHash(item.currentTargetText) : null,
        proposalHash: textHash(item.proposedText),
      }));

      const requestHash = jsonHash({
        processRunId: input.processRunId,
        repositoryFullName: input.repositoryFullName,
        baseRef: input.baseRef,
        baseCommitSha: input.baseCommitSha,
        catalogHash: input.catalogHash,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
        expiresInSeconds: input.expiresInSeconds,
        provenance: input.provenance,
        items: preparedItems.map((item) => ({
          messageKey: item.messageKey,
          sourceHash: item.sourceHash,
          currentTargetHash: item.currentTargetHash,
          proposalHash: item.proposalHash,
          placeholderSignature: item.placeholderSignature,
          context: item.context,
        })),
      });

      const result = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          `SELECT ${changeSetSelect()}
             FROM translation_change_sets tcs
            WHERE tcs.organization_id = $1 AND tcs.workspace_id = $2
              AND tcs.idempotency_key = $3`,
          [input.organizationId, input.workspaceId, input.idempotencyKey],
        );
        if (existing.rowCount === 1) {
          if (existing.rows[0]!.requestHash !== requestHash) {
            throw error(409, 'translation_idempotency_payload_mismatch');
          }
          const items = await client.query(
            `SELECT ${itemSelect()}
               FROM translation_change_set_items tcsi
              WHERE tcsi.change_set_id = $1 AND tcsi.organization_id = $2
                AND tcsi.workspace_id = $3
              ORDER BY tcsi.message_key`,
            [existing.rows[0]!.id, input.organizationId, input.workspaceId],
          );
          return { changeSet: existing.rows[0], items: items.rows, idempotent: true };
        }

        const run = await client.query<{
          id: string;
          flowId: string;
          flowVersionId: string;
          status: string;
          runtimeBinding: string;
          definition: Record<string, unknown>;
        }>(
          `SELECT fr.id, fr.flow_id AS "flowId", fr.flow_version_id AS "flowVersionId",
                  fr.status, fv.runtime_binding AS "runtimeBinding", fv.definition
             FROM flow_runs fr
             JOIN flow_versions fv ON fv.id = fr.flow_version_id AND fv.flow_id = fr.flow_id
            WHERE fr.id = $1 AND fr.organization_id = $2 AND fr.workspace_id = $3
            FOR SHARE OF fr`,
          [input.processRunId, input.organizationId, input.workspaceId],
        );
        const runRow = run.rows[0];
        if (!runRow) throw error(404, 'translation_process_run_not_found');
        if (runRow.status !== 'succeeded') {
          throw error(409, 'translation_process_run_not_succeeded');
        }
        if (!['open-webui', 'n8n'].includes(runRow.runtimeBinding)) {
          throw error(403, 'translation_proposal_runtime_not_allowed');
        }
        const provenance = {
          ...input.provenance,
          runtimeBinding: runRow.runtimeBinding,
          flowVersionDefinitionHash: jsonHash(runRow.definition),
        };
        const inserted = await client.query(
          `INSERT INTO translation_change_sets
              (organization_id, workspace_id, process_run_id, flow_id, flow_version_id,
               repository_full_name, base_ref, base_commit_sha, catalog_hash,
               source_locale, target_locale, idempotency_key, request_hash, provenance,
               requested_by_actor_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   now() + ($16::text || ' seconds')::interval)
           RETURNING ${changeSetSelect('translation_change_sets')}`,
          [
            input.organizationId,
            input.workspaceId,
            runRow.id,
            runRow.flowId,
            runRow.flowVersionId,
            input.repositoryFullName,
            input.baseRef,
            input.baseCommitSha,
            input.catalogHash,
            input.sourceLocale,
            input.targetLocale,
            input.idempotencyKey,
            requestHash,
            provenance,
            input.actorId,
            input.expiresInSeconds,
          ],
        );
        const changeSet = inserted.rows[0]!;
        const items = [];
        for (const item of preparedItems) {
          const insertedItem = await client.query(
            `INSERT INTO translation_change_set_items
                (organization_id, workspace_id, change_set_id, message_key,
                 source_locale, target_locale, source_text, current_target_text, proposed_text,
                 source_hash, current_target_hash, proposal_hash, placeholder_signature, context)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING ${itemSelect('translation_change_set_items')}`,
            [
              input.organizationId,
              input.workspaceId,
              changeSet.id,
              item.messageKey,
              input.sourceLocale,
              input.targetLocale,
              item.sourceText,
              item.currentTargetText ?? null,
              item.proposedText,
              item.sourceHash,
              item.currentTargetHash,
              item.proposalHash,
              JSON.stringify(item.placeholderSignature),
              item.context,
            ],
          );
          items.push(insertedItem.rows[0]!);
        }
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'translation.change_set_created', $2, 'translation_change_set', $3, $4)`,
          [
            input.organizationId,
            input.actorId,
            changeSet.id,
            {
              workspaceId: input.workspaceId,
              processRunId: runRow.id,
              itemCount: items.length,
              catalogHash: input.catalogHash,
              baseCommitSha: input.baseCommitSha,
            },
          ],
        );
        return { changeSet, items, idempotent: false };
      });
      return res.status(result.idempotent ? 200 : 201).json({
        ...result,
        requestId: requestId(req),
      });
    } catch (caught) {
      next(caught);
    }
  });

  app.get('/api/v1/translation-change-sets', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireRoles(context, viewerRoles);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (status && !allowedListStatuses.includes(status as (typeof allowedListStatuses)[number])) {
        throw error(400, 'translation_change_set_status_invalid');
      }
      const values: unknown[] = [context.organizationId, context.workspaceId];
      const statusClause = status ? 'AND tcs.status = $3' : '';
      if (status) values.push(status);
      const changeSets = await pool.query(
        `SELECT ${changeSetSelect()},
                count(tcsi.id)::int AS "itemCount",
                count(tcsi.id) FILTER (WHERE tcsi.status = 'proposed')::int AS "proposedCount",
                count(tcsi.id) FILTER (WHERE tcsi.status IN ('accepted', 'edited'))::int AS "acceptedCount",
                count(tcsi.id) FILTER (WHERE tcsi.status = 'rejected')::int AS "rejectedCount"
           FROM translation_change_sets tcs
           LEFT JOIN translation_change_set_items tcsi
             ON tcsi.change_set_id = tcs.id
            AND tcsi.organization_id = tcs.organization_id
            AND tcsi.workspace_id = tcs.workspace_id
          WHERE tcs.organization_id = $1 AND tcs.workspace_id = $2 ${statusClause}
          GROUP BY tcs.id
          ORDER BY tcs.created_at DESC
          LIMIT 100`,
        values,
      );
      return res.json({ changeSets: changeSets.rows, requestId: requestId(req) });
    } catch (caught) {
      next(caught);
    }
  });

  app.get('/api/v1/translation-change-sets/:changeSetId', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireRoles(context, viewerRoles);
      const changeSet = await pool.query(
        `SELECT ${changeSetSelect()}
           FROM translation_change_sets tcs
          WHERE tcs.id = $1 AND tcs.organization_id = $2 AND tcs.workspace_id = $3`,
        [req.params.changeSetId, context.organizationId, context.workspaceId],
      );
      if (changeSet.rowCount !== 1) throw error(404, 'translation_change_set_not_found');
      const items = await pool.query(
        `SELECT ${itemSelect()}
           FROM translation_change_set_items tcsi
          WHERE tcsi.change_set_id = $1 AND tcsi.organization_id = $2
            AND tcsi.workspace_id = $3
          ORDER BY tcsi.message_key`,
        [req.params.changeSetId, context.organizationId, context.workspaceId],
      );
      return res.json({
        changeSet: changeSet.rows[0],
        items: items.rows,
        requestId: requestId(req),
      });
    } catch (caught) {
      next(caught);
    }
  });

  app.post('/api/v1/translation-change-sets/:changeSetId/submit', async (req, res, next) => {
    try {
      const context = await resolveTenantContext(req);
      await requireRoles(context, authorRoles);
      const input = submitTranslationChangeSetSchema.parse({
        ...req.body,
        ...context,
        changeSetId: req.params.changeSetId,
      });
      const changeSet = await withTransaction(pool, async (client) => {
        const current = await client.query<{ id: string; status: string; expiresAt: Date }>(
          `SELECT id, status, expires_at AS "expiresAt"
             FROM translation_change_sets
            WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
            FOR UPDATE`,
          [input.changeSetId, input.organizationId, input.workspaceId],
        );
        const row = current.rows[0];
        if (!row) throw error(404, 'translation_change_set_not_found');
        if (row.status !== 'draft') throw error(409, 'translation_change_set_not_draft');
        if (row.expiresAt.getTime() <= Date.now()) {
          throw error(409, 'translation_change_set_expired');
        }
        const updated = await client.query(
          `UPDATE translation_change_sets
              SET status = 'ready_for_review', submitted_at = now(), updated_at = now()
            WHERE id = $1
            RETURNING ${changeSetSelect('translation_change_sets')}`,
          [row.id],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'translation.change_set_submitted', $2, 'translation_change_set', $3, $4)`,
          [input.organizationId, input.actorId, row.id, { workspaceId: input.workspaceId }],
        );
        return updated.rows[0];
      });
      return res.json({ changeSet, requestId: requestId(req) });
    } catch (caught) {
      next(caught);
    }
  });

  app.patch(
    '/api/v1/translation-change-sets/:changeSetId/items/:itemId/review',
    async (req, res, next) => {
      try {
        const context = await resolveTenantContext(req);
        await requireRoles(context, reviewerRoles);
        const input = reviewTranslationChangeSetItemSchema.parse({
          ...req.body,
          ...context,
          changeSetId: req.params.changeSetId,
          itemId: req.params.itemId,
        });
        const item = await withTransaction(pool, async (client) => {
          const changeSet = await client.query<{
            id: string;
            status: string;
            requestedByActorId: string;
            expiresAt: Date;
          }>(
            `SELECT id, status, requested_by_actor_id AS "requestedByActorId",
                    expires_at AS "expiresAt"
               FROM translation_change_sets
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
              FOR UPDATE`,
            [input.changeSetId, input.organizationId, input.workspaceId],
          );
          const changeSetRow = changeSet.rows[0];
          if (!changeSetRow) throw error(404, 'translation_change_set_not_found');
          if (changeSetRow.status !== 'ready_for_review') {
            throw error(409, 'translation_change_set_not_reviewable');
          }
          if (changeSetRow.expiresAt.getTime() <= Date.now()) {
            throw error(409, 'translation_change_set_expired');
          }
          if (changeSetRow.requestedByActorId === input.actorId) {
            throw error(403, 'translation_self_review_forbidden');
          }
          const currentItem = await client.query<{
            id: string;
            status: string;
            placeholderSignature: string[];
          }>(
            `SELECT id, status, placeholder_signature AS "placeholderSignature"
               FROM translation_change_set_items
              WHERE id = $1 AND change_set_id = $2 AND organization_id = $3 AND workspace_id = $4
              FOR UPDATE`,
            [input.itemId, changeSetRow.id, input.organizationId, input.workspaceId],
          );
          const itemRow = currentItem.rows[0];
          if (!itemRow) throw error(404, 'translation_change_set_item_not_found');
          if (itemRow.status !== 'proposed') {
            throw error(409, 'translation_change_set_item_already_reviewed');
          }
          if (input.decision === 'edited') {
            const reviewedSignature = extractPlaceholderSignature(input.reviewedText!);
            if (!signaturesMatch(itemRow.placeholderSignature, reviewedSignature)) {
              throw error(400, 'translation_placeholder_signature_mismatch');
            }
          }
          const updated = await client.query(
            `UPDATE translation_change_set_items
                SET status = $1, reviewed_text = $2, reviewed_by_actor_id = $3,
                    review_reason = $4, reviewed_at = now(), updated_at = now()
              WHERE id = $5
              RETURNING ${itemSelect('translation_change_set_items')}`,
            [
              input.decision,
              input.decision === 'edited' ? input.reviewedText : null,
              input.actorId,
              input.reason,
              itemRow.id,
            ],
          );
          await client.query(
            `INSERT INTO audit_events
                (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
             VALUES ($1, 'translation.item_reviewed', $2, 'translation_change_set_item', $3, $4)`,
            [
              input.organizationId,
              input.actorId,
              itemRow.id,
              {
                workspaceId: input.workspaceId,
                changeSetId: changeSetRow.id,
                decision: input.decision,
              },
            ],
          );
          return updated.rows[0];
        });
        return res.json({ item, requestId: requestId(req) });
      } catch (caught) {
        next(caught);
      }
    },
  );

  app.post(
    '/api/v1/translation-change-sets/:changeSetId/complete-review',
    async (req, res, next) => {
      try {
        const context = await resolveTenantContext(req);
        await requireRoles(context, reviewerRoles);
        const input = completeTranslationChangeSetReviewSchema.parse({
          ...req.body,
          ...context,
          changeSetId: req.params.changeSetId,
        });
        const changeSet = await withTransaction(pool, async (client) => {
          const current = await client.query<{
            id: string;
            status: string;
            requestedByActorId: string;
            expiresAt: Date;
          }>(
            `SELECT id, status, requested_by_actor_id AS "requestedByActorId",
                    expires_at AS "expiresAt"
               FROM translation_change_sets
              WHERE id = $1 AND organization_id = $2 AND workspace_id = $3
              FOR UPDATE`,
            [input.changeSetId, input.organizationId, input.workspaceId],
          );
          const row = current.rows[0];
          if (!row) throw error(404, 'translation_change_set_not_found');
          if (row.status !== 'ready_for_review') {
            throw error(409, 'translation_change_set_not_reviewable');
          }
          if (row.expiresAt.getTime() <= Date.now()) {
            throw error(409, 'translation_change_set_expired');
          }
          if (row.requestedByActorId === input.actorId) {
            throw error(403, 'translation_self_review_forbidden');
          }
          const counts = await client.query<{
            proposedCount: number;
            acceptedCount: number;
            rejectedCount: number;
          }>(
            `SELECT count(*) FILTER (WHERE status = 'proposed')::int AS "proposedCount",
                    count(*) FILTER (WHERE status IN ('accepted', 'edited'))::int AS "acceptedCount",
                    count(*) FILTER (WHERE status = 'rejected')::int AS "rejectedCount"
               FROM translation_change_set_items
              WHERE change_set_id = $1 AND organization_id = $2 AND workspace_id = $3`,
            [row.id, input.organizationId, input.workspaceId],
          );
          const itemCounts = counts.rows[0]!;
          if (itemCounts.proposedCount > 0) {
            throw error(409, 'translation_change_set_items_pending_review');
          }
          if (itemCounts.acceptedCount < 1) {
            throw error(409, 'translation_change_set_has_no_accepted_items');
          }
          const updated = await client.query(
            `UPDATE translation_change_sets
                SET status = 'ready_for_approval', review_completed_at = now(), updated_at = now()
              WHERE id = $1
              RETURNING ${changeSetSelect('translation_change_sets')}`,
            [row.id],
          );
          await client.query(
            `INSERT INTO audit_events
                (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
             VALUES ($1, 'translation.review_completed', $2, 'translation_change_set', $3, $4)`,
            [
              input.organizationId,
              input.actorId,
              row.id,
              { workspaceId: input.workspaceId, ...itemCounts },
            ],
          );
          return updated.rows[0];
        });
        return res.json({ changeSet, requestId: requestId(req) });
      } catch (caught) {
        next(caught);
      }
    },
  );
}
