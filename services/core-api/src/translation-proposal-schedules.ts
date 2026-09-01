import { createHash, timingSafeEqual } from 'node:crypto';
import type { Express, Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import {
  createTranslationProposalScheduleSchema,
  openWebUiRuntimeDefinitionSchema,
  scheduledTranslationProposalOutputSchema,
  tickTranslationProposalSchedulesSchema,
  updateTranslationProposalScheduleSchema,
  type TranslationCatalogSnapshot,
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
  schedulerSecret?: string;
  resolveTenantContext: (request: Request) => TenantContext | Promise<TenantContext>;
  requireRoles: (context: TenantContext, roles: OrganizationRole[]) => Promise<void>;
  error: (statusCode: number, code: string) => Error;
  requestId: (request: Request) => string;
};

type ScheduleRow = {
  id: string;
  organizationId: string;
  workspaceId: string;
  flowId: string;
  flowVersionId: string;
  scheduleKey: string;
  status: 'paused' | 'active' | 'expired';
  cadenceSeconds: number;
  maxItems: number;
  messageKeyPrefixes: string[];
  nextRunAt: Date;
  createdByActorId: string;
};

type SnapshotItem = {
  messageKey: string;
  sourceText: string;
  currentTargetText: string | null;
  placeholderSignature: string[];
};

type MaterializationResult = {
  handled: boolean;
  status?: 'succeeded' | 'failed';
  changeSetId?: string;
  errorCode?: string;
};

const schedulerRoles: OrganizationRole[] = ['owner', 'admin', 'editor'];
const scheduleActivatorRoles: OrganizationRole[] = ['owner', 'admin'];
const scheduleViewerRoles: OrganizationRole[] = ['owner', 'admin', 'editor', 'reviewer'];
const repositoryFullName = 'hadiranweb/casio-plus-final';
const baseRef = 'main';
const sourceLocale = 'en';
const targetLocale = 'fa';
const maxDuePerTick = 20;
const maxPromptBytes = 40_000;

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

function textHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1]!)
    .filter((placeholder, index, values) => values.indexOf(placeholder) === index)
    .sort();
}

function equalStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function requiredSchedulerSecret(
  request: Request,
  configuredSecret: string | undefined,
  error: Dependencies['error'],
): void {
  const provided = request.header('x-casioplus-scheduler-secret')?.trim();
  if (
    !configuredSecret ||
    configuredSecret.length < 32 ||
    !provided ||
    !safeEqual(provided, configuredSecret)
  ) {
    throw error(401, 'translation_scheduler_unauthorized');
  }
}

function expectedScheduleStartError(caught: unknown): string | undefined {
  if (!caught || typeof caught !== 'object') return undefined;
  const candidate = caught as { statusCode?: unknown; code?: unknown };
  if (
    (candidate.statusCode === 404 || candidate.statusCode === 409) &&
    typeof candidate.code === 'string' &&
    candidate.code.startsWith('translation_schedule_')
  ) {
    return candidate.code.slice(0, 200);
  }
  return undefined;
}

function scheduleProjection(alias = 'tps'): string {
  return `${alias}.id,
          ${alias}.organization_id AS "organizationId",
          ${alias}.workspace_id AS "workspaceId",
          ${alias}.flow_id AS "flowId",
          ${alias}.flow_version_id AS "flowVersionId",
          ${alias}.schedule_key AS "scheduleKey",
          ${alias}.status,
          ${alias}.repository_full_name AS "repositoryFullName",
          ${alias}.base_ref AS "baseRef",
          ${alias}.source_locale AS "sourceLocale",
          ${alias}.target_locale AS "targetLocale",
          ${alias}.cadence_seconds AS "cadenceSeconds",
          ${alias}.max_items AS "maxItems",
          ${alias}.message_key_prefixes AS "messageKeyPrefixes",
          ${alias}.next_run_at AS "nextRunAt",
          ${alias}.last_started_at AS "lastStartedAt",
          ${alias}.last_finished_at AS "lastFinishedAt",
          ${alias}.last_error_code AS "lastErrorCode",
          ${alias}.created_by_actor_id AS "createdByActorId",
          ${alias}.created_at AS "createdAt",
          ${alias}.updated_at AS "updatedAt"`;
}

async function validatePublishedTranslationFlow(
  client: PoolClient,
  input: {
    organizationId: string;
    workspaceId: string;
    flowId: string;
    flowVersionId: string;
  },
  error: Dependencies['error'],
) {
  const result = await client.query<{
    definition: Record<string, unknown>;
    runtimeBinding: string;
  }>(
    `SELECT fv.definition, fv.runtime_binding AS "runtimeBinding"
       FROM flows f
       JOIN flow_versions fv ON fv.flow_id = f.id
      WHERE f.id = $1 AND fv.id = $2
        AND f.organization_id = $3 AND f.workspace_id = $4
        AND f.status = 'published' AND f.active_version_id = fv.id`,
    [input.flowId, input.flowVersionId, input.organizationId, input.workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw error(404, 'translation_schedule_flow_version_not_published');
  if (row.runtimeBinding !== 'open-webui') {
    throw error(409, 'translation_schedule_runtime_must_be_open_webui');
  }
  return openWebUiRuntimeDefinitionSchema.parse(row.definition);
}

function selectSnapshotItems(
  snapshot: TranslationCatalogSnapshot,
  schedule: ScheduleRow,
): SnapshotItem[] {
  const prefixes = schedule.messageKeyPrefixes;
  const candidates = Object.entries(snapshot.sourceCatalog)
    .filter(([messageKey]) => prefixes.some((prefix) => messageKey.startsWith(prefix)))
    .map(([messageKey, sourceText]) => {
      const currentTargetText = snapshot.targetCatalog[messageKey] ?? null;
      return {
        messageKey,
        sourceText,
        currentTargetText,
        placeholderSignature: placeholders(sourceText),
      };
    })
    .filter(
      (item) =>
        item.currentTargetText === null ||
        equalStrings(placeholders(item.currentTargetText), item.placeholderSignature),
    )
    .sort((left, right) => {
      const leftPriority =
        left.currentTargetText === null || left.currentTargetText === left.sourceText ? 0 : 1;
      const rightPriority =
        right.currentTargetText === null || right.currentTargetText === right.sourceText ? 0 : 1;
      return leftPriority - rightPriority || left.messageKey.localeCompare(right.messageKey);
    });

  const selected: SnapshotItem[] = [];
  let bytes = 0;
  for (const item of candidates) {
    if (selected.length >= schedule.maxItems) break;
    const nextBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (bytes + nextBytes > maxPromptBytes) continue;
    selected.push(item);
    bytes += nextBytes;
  }
  return selected;
}

function proposalPrompt(schedule: ScheduleRow, items: SnapshotItem[]): string {
  return [
    'Produce Persian UI translation proposals for the supplied English Casioplus messages.',
    'Return only strict JSON with this shape: {"items":[{"messageKey":"...","proposedText":"..."}]}.',
    'Use every supplied messageKey exactly once. Do not add keys. Preserve every {placeholder} exactly.',
    'Keep technical identifiers, URLs, email addresses, JSON keys, product name Casioplus, and code tokens unchanged.',
    'Do not include Markdown, explanations, approval decisions, repository instructions, secrets, or customer data.',
    `Schedule: ${schedule.scheduleKey}`,
    `Items: ${JSON.stringify(items)}`,
  ].join('\n');
}

async function resolveOpenWebUiMetering(
  client: PoolClient,
  organizationId: string,
  model: string,
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
      WHERE rmb.organization_id = $1 AND rmb.runtime = 'open-webui'
        AND rmb.operation = 'model.chat.complete' AND rmb.resource_key = $2
        AND rmb.status = 'active' AND rmb.valid_from <= now()
        AND (rmb.valid_until IS NULL OR rmb.valid_until > now())
        AND pav.status = 'active'
      ORDER BY rmb.valid_from DESC LIMIT 1`,
    [organizationId, model],
  );
  const row = result.rows[0];
  if (!row) throw error(409, 'translation_schedule_metering_binding_required');
  return row;
}

async function skipScheduleRun(
  client: PoolClient,
  schedule: ScheduleRow,
  scheduledFor: Date,
  snapshot: TranslationCatalogSnapshot,
  errorCode: string,
): Promise<void> {
  const idempotencyKey = `translation-schedule:${schedule.id}:${scheduledFor.toISOString()}`;
  await client.query(
    `INSERT INTO translation_proposal_schedule_runs
        (schedule_id, organization_id, workspace_id, status, scheduled_for,
         base_commit_sha, catalog_hash, snapshot_items, idempotency_key,
         error_code, completed_at)
     VALUES ($1, $2, $3, 'skipped', $4, $5, $6, '[]'::jsonb, $7, $8, now())
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
    [
      schedule.id,
      schedule.organizationId,
      schedule.workspaceId,
      scheduledFor,
      snapshot.baseCommitSha,
      snapshot.catalogHash,
      idempotencyKey,
      errorCode,
    ],
  );
  await client.query(
    `UPDATE translation_proposal_schedules
        SET next_run_at = now() + (cadence_seconds::text || ' seconds')::interval,
            last_started_at = now(), last_finished_at = now(), last_error_code = $1,
            updated_at = now()
      WHERE id = $2`,
    [errorCode, schedule.id],
  );
  await client.query(
    `INSERT INTO audit_events
        (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
     VALUES ($1, 'translation.schedule_skipped', $2, 'translation_proposal_schedule', $3, $4)`,
    [
      schedule.organizationId,
      schedule.createdByActorId,
      schedule.id,
      { workspaceId: schedule.workspaceId, errorCode, scheduledFor: scheduledFor.toISOString() },
    ],
  );
}

async function startDueSchedule(
  client: PoolClient,
  schedule: ScheduleRow,
  snapshot: TranslationCatalogSnapshot,
  error: Dependencies['error'],
) {
  const scheduledFor = schedule.nextRunAt;
  const items = selectSnapshotItems(snapshot, schedule);
  if (items.length === 0) {
    await skipScheduleRun(
      client,
      schedule,
      scheduledFor,
      snapshot,
      'translation_schedule_no_items',
    );
    return { scheduleId: schedule.id, status: 'skipped' as const };
  }
  const definition = await validatePublishedTranslationFlow(client, schedule, error);
  const metering = await resolveOpenWebUiMetering(
    client,
    schedule.organizationId,
    definition.model,
    error,
  );
  const idempotencyKey = `translation-schedule:${schedule.id}:${scheduledFor.toISOString()}`;
  const work = await client.query<{ id: string }>(
    `INSERT INTO work_items
        (organization_id, workspace_id, title, intent, status, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'in_progress', $5)
     RETURNING id`,
    [
      schedule.organizationId,
      schedule.workspaceId,
      `Scheduled translation proposal: ${schedule.scheduleKey}`,
      'Generate a reviewable English-to-Persian translation proposal. No review, approval, publication, or repository mutation is automated.',
      schedule.createdByActorId,
    ],
  );
  const prompt = proposalPrompt(schedule, items);
  const run = await client.query<{ id: string }>(
    `INSERT INTO flow_runs
        (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
         status, idempotency_key, input, created_by_actor_id)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8)
     RETURNING id`,
    [
      schedule.organizationId,
      schedule.workspaceId,
      work.rows[0]!.id,
      schedule.flowId,
      schedule.flowVersionId,
      idempotencyKey,
      {
        prompt,
        translationProposal: {
          scheduleId: schedule.id,
          scheduledFor: scheduledFor.toISOString(),
          repositoryFullName,
          baseRef,
          baseCommitSha: snapshot.baseCommitSha,
          catalogHash: snapshot.catalogHash,
          sourceLocale,
          targetLocale,
          items,
        },
      },
      schedule.createdByActorId,
    ],
  );
  const scheduleRun = await client.query<{ id: string }>(
    `INSERT INTO translation_proposal_schedule_runs
        (schedule_id, organization_id, workspace_id, process_run_id, status,
         scheduled_for, base_commit_sha, catalog_hash, snapshot_items, idempotency_key)
     VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      schedule.id,
      schedule.organizationId,
      schedule.workspaceId,
      run.rows[0]!.id,
      scheduledFor,
      snapshot.baseCommitSha,
      snapshot.catalogHash,
      JSON.stringify(items),
      idempotencyKey,
    ],
  );
  const outboxKey = `process-run:${run.rows[0]!.id}:open-webui`;
  const outbox = await client.query<{ id: string }>(
    `INSERT INTO integration_outbox
        (integration_request_id, process_run_id, organization_id, workspace_id,
         destination, operation, payload, idempotency_key, timeout_ms, metering_snapshot)
     VALUES (NULL, $1, $2, $3, 'open-webui', 'model.chat.complete', $4, $5, $6, $7)
     ON CONFLICT (destination, idempotency_key) DO UPDATE
       SET updated_at = integration_outbox.updated_at
     RETURNING id`,
    [
      run.rows[0]!.id,
      schedule.organizationId,
      schedule.workspaceId,
      {
        processRunId: run.rows[0]!.id,
        workItemId: work.rows[0]!.id,
        flowId: schedule.flowId,
        flowVersionId: schedule.flowVersionId,
        actorId: schedule.createdByActorId,
        input: { prompt },
        definition,
      },
      outboxKey,
      Number(process.env.OPEN_WEBUI_RUNTIME_TIMEOUT_MS ?? 120_000),
      metering,
    ],
  );
  await client.query(
    `INSERT INTO runtime_events
        (organization_id, workspace_id, process_run_id, actor_id,
         event_type, payload, idempotency_key)
     VALUES ($1, $2, $3, $4, 'translation.schedule_dispatch.queued', $5, $6)
     ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
    [
      schedule.organizationId,
      schedule.workspaceId,
      run.rows[0]!.id,
      schedule.createdByActorId,
      {
        scheduleId: schedule.id,
        scheduleRunId: scheduleRun.rows[0]!.id,
        outboxId: outbox.rows[0]!.id,
      },
      `${idempotencyKey}:queued`,
    ],
  );
  await client.query(`UPDATE flow_runs SET status = 'running' WHERE id = $1`, [run.rows[0]!.id]);
  await client.query(
    `UPDATE translation_proposal_schedules
        SET next_run_at = now() + (cadence_seconds::text || ' seconds')::interval,
            last_started_at = now(), last_finished_at = NULL,
            last_error_code = NULL, updated_at = now()
      WHERE id = $1`,
    [schedule.id],
  );
  await client.query(
    `INSERT INTO audit_events
        (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
     VALUES ($1, 'translation.schedule_started', $2, 'translation_proposal_schedule', $3, $4)`,
    [
      schedule.organizationId,
      schedule.createdByActorId,
      schedule.id,
      {
        workspaceId: schedule.workspaceId,
        processRunId: run.rows[0]!.id,
        scheduleRunId: scheduleRun.rows[0]!.id,
        itemCount: items.length,
        baseCommitSha: snapshot.baseCommitSha,
        catalogHash: snapshot.catalogHash,
      },
    ],
  );
  return {
    scheduleId: schedule.id,
    scheduleRunId: scheduleRun.rows[0]!.id,
    processRunId: run.rows[0]!.id,
    status: 'started' as const,
  };
}

export async function materializeScheduledTranslationProposal(
  client: PoolClient,
  input: {
    processRunId: string;
    adapterSucceeded: boolean;
    adapterOutput?: unknown;
    model?: string | null;
    adapterErrorCode?: string | null;
  },
): Promise<MaterializationResult> {
  const scheduleRunResult = await client.query<{
    id: string;
    scheduleId: string;
    organizationId: string;
    workspaceId: string;
    status: 'running' | 'succeeded' | 'failed' | 'skipped';
    baseCommitSha: string;
    catalogHash: string;
    snapshotItems: SnapshotItem[];
    scheduleKey: string;
    flowId: string;
    flowVersionId: string;
    createdByActorId: string;
    workItemId: string;
  }>(
    `SELECT tpsr.id, tpsr.schedule_id AS "scheduleId",
            tpsr.organization_id AS "organizationId",
            tpsr.workspace_id AS "workspaceId", tpsr.status,
            tpsr.base_commit_sha AS "baseCommitSha", tpsr.catalog_hash AS "catalogHash",
            tpsr.snapshot_items AS "snapshotItems", tps.schedule_key AS "scheduleKey",
            tps.flow_id AS "flowId", tps.flow_version_id AS "flowVersionId",
            tps.created_by_actor_id AS "createdByActorId", fr.work_item_id AS "workItemId"
       FROM translation_proposal_schedule_runs tpsr
       JOIN translation_proposal_schedules tps ON tps.id = tpsr.schedule_id
       JOIN flow_runs fr ON fr.id = tpsr.process_run_id
      WHERE tpsr.process_run_id = $1
      FOR UPDATE OF tpsr, tps`,
    [input.processRunId],
  );
  const scheduleRun = scheduleRunResult.rows[0];
  if (!scheduleRun) return { handled: false };
  if (scheduleRun.status === 'succeeded') {
    const existing = await client.query<{ changeSetId: string }>(
      `SELECT change_set_id AS "changeSetId"
         FROM translation_proposal_schedule_runs WHERE id = $1`,
      [scheduleRun.id],
    );
    return { handled: true, status: 'succeeded', changeSetId: existing.rows[0]?.changeSetId };
  }
  if (scheduleRun.status !== 'running') {
    return { handled: true, status: 'failed', errorCode: 'translation_schedule_run_not_running' };
  }

  if (!input.adapterSucceeded) {
    const adapterErrorCode =
      input.adapterErrorCode?.slice(0, 200) || 'translation_schedule_model_dispatch_failed';
    await client.query(
      `UPDATE translation_proposal_schedule_runs
          SET status = 'failed', error_code = $1, completed_at = now()
        WHERE id = $2 AND status = 'running'`,
      [adapterErrorCode, scheduleRun.id],
    );
    await client.query(
      `UPDATE translation_proposal_schedules
          SET last_finished_at = now(), last_error_code = $1, updated_at = now()
        WHERE id = $2`,
      [adapterErrorCode, scheduleRun.scheduleId],
    );
    await client.query(
      `UPDATE work_items SET status = 'blocked', updated_at = now() WHERE id = $1`,
      [scheduleRun.workItemId],
    );
    return { handled: true, status: 'failed', errorCode: adapterErrorCode };
  }

  let parsed: ReturnType<typeof scheduledTranslationProposalOutputSchema.parse>;
  let errorCode: string | undefined;
  try {
    const content = (input.adapterOutput as { content?: unknown } | null)?.content;
    if (typeof content !== 'string') throw new Error('content_missing');
    parsed = scheduledTranslationProposalOutputSchema.parse(JSON.parse(content));
    const uniqueKeys = new Set(parsed.items.map((item) => item.messageKey));
    if (uniqueKeys.size !== parsed.items.length) throw new Error('duplicate_keys');
    const snapshotByKey = new Map(
      scheduleRun.snapshotItems.map((item) => [item.messageKey, item] as const),
    );
    if (
      parsed.items.length !== scheduleRun.snapshotItems.length ||
      parsed.items.some((item) => !snapshotByKey.has(item.messageKey))
    ) {
      throw new Error('item_scope_mismatch');
    }
    for (const item of parsed.items) {
      const snapshot = snapshotByKey.get(item.messageKey)!;
      if (!equalStrings(placeholders(item.proposedText), snapshot.placeholderSignature)) {
        throw new Error('placeholder_mismatch');
      }
    }
  } catch (caught) {
    errorCode =
      caught instanceof SyntaxError
        ? 'translation_schedule_output_json_invalid'
        : caught instanceof Error && caught.message === 'placeholder_mismatch'
          ? 'translation_schedule_output_placeholder_mismatch'
          : caught instanceof Error && caught.message === 'item_scope_mismatch'
            ? 'translation_schedule_output_scope_mismatch'
            : caught instanceof Error && caught.message === 'duplicate_keys'
              ? 'translation_schedule_output_duplicate_keys'
              : 'translation_schedule_output_invalid';
  }

  if (errorCode) {
    await client.query(
      `UPDATE translation_proposal_schedule_runs
          SET status = 'failed', error_code = $1, completed_at = now()
        WHERE id = $2 AND status = 'running'`,
      [errorCode, scheduleRun.id],
    );
    await client.query(
      `UPDATE translation_proposal_schedules
          SET last_finished_at = now(), last_error_code = $1, updated_at = now()
        WHERE id = $2`,
      [errorCode, scheduleRun.scheduleId],
    );
    await client.query(
      `UPDATE flow_runs SET status = 'failed', error_code = $1, completed_at = now()
        WHERE id = $2`,
      [errorCode, input.processRunId],
    );
    await client.query(
      `UPDATE work_items SET status = 'blocked', updated_at = now() WHERE id = $1`,
      [scheduleRun.workItemId],
    );
    await client.query(
      `INSERT INTO runtime_events
          (organization_id, workspace_id, process_run_id, actor_id,
           event_type, payload, idempotency_key)
       VALUES ($1, $2, $3, $4, 'translation.schedule_proposal.failed', $5, $6)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
      [
        scheduleRun.organizationId,
        scheduleRun.workspaceId,
        input.processRunId,
        scheduleRun.createdByActorId,
        { scheduleId: scheduleRun.scheduleId, scheduleRunId: scheduleRun.id, errorCode },
        `translation-schedule-result:${scheduleRun.id}`,
      ],
    );
    return { handled: true, status: 'failed', errorCode };
  }

  const outputByKey = new Map(parsed!.items.map((item) => [item.messageKey, item.proposedText]));
  const items = scheduleRun.snapshotItems.map((snapshot) => ({
    ...snapshot,
    proposedText: outputByKey.get(snapshot.messageKey)!,
    sourceHash: textHash(snapshot.sourceText),
    currentTargetHash:
      snapshot.currentTargetText === null ? null : textHash(snapshot.currentTargetText),
    proposalHash: textHash(outputByKey.get(snapshot.messageKey)!),
    context: {
      surface: 'shared',
      description: `Scheduled proposal from ${scheduleRun.scheduleKey}`,
    },
  }));
  const idempotencyKey = `scheduled-proposal:${scheduleRun.id}`;
  const requestPayload = {
    processRunId: input.processRunId,
    repositoryFullName,
    baseRef,
    baseCommitSha: scheduleRun.baseCommitSha,
    catalogHash: scheduleRun.catalogHash,
    sourceLocale,
    targetLocale,
    idempotencyKey,
    provenance: {
      model: input.model ?? undefined,
      promptVersion: 'translation-schedule-v1',
      scheduleId: scheduleRun.scheduleId,
    },
    items: items.map((item) => ({
      messageKey: item.messageKey,
      sourceText: item.sourceText,
      currentTargetText: item.currentTargetText,
      proposedText: item.proposedText,
      placeholderSignature: item.placeholderSignature,
      context: item.context,
    })),
  };
  const requestHash = jsonHash(requestPayload);
  const changeSet = await client.query<{ id: string }>(
    `INSERT INTO translation_change_sets
        (organization_id, workspace_id, process_run_id, flow_id, flow_version_id,
         repository_full_name, base_ref, base_commit_sha, catalog_hash,
         source_locale, target_locale, status, idempotency_key, request_hash,
         provenance, requested_by_actor_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             'en', 'fa', 'draft', $10, $11, $12, $13, now() + interval '7 days')
     ON CONFLICT (organization_id, workspace_id, idempotency_key) DO UPDATE
       SET updated_at = translation_change_sets.updated_at
     RETURNING id`,
    [
      scheduleRun.organizationId,
      scheduleRun.workspaceId,
      input.processRunId,
      scheduleRun.flowId,
      scheduleRun.flowVersionId,
      repositoryFullName,
      baseRef,
      scheduleRun.baseCommitSha,
      scheduleRun.catalogHash,
      idempotencyKey,
      requestHash,
      requestPayload.provenance,
      scheduleRun.createdByActorId,
    ],
  );
  for (const item of items) {
    await client.query(
      `INSERT INTO translation_change_set_items
          (organization_id, workspace_id, change_set_id, message_key,
           source_locale, target_locale, source_text, current_target_text,
           proposed_text, source_hash, current_target_hash, proposal_hash,
           placeholder_signature, context, status)
       VALUES ($1, $2, $3, $4, 'en', 'fa', $5, $6, $7, $8, $9, $10, $11, $12, 'proposed')
       ON CONFLICT (change_set_id, message_key, target_locale) DO NOTHING`,
      [
        scheduleRun.organizationId,
        scheduleRun.workspaceId,
        changeSet.rows[0]!.id,
        item.messageKey,
        item.sourceText,
        item.currentTargetText,
        item.proposedText,
        item.sourceHash,
        item.currentTargetHash,
        item.proposalHash,
        JSON.stringify(item.placeholderSignature),
        item.context,
      ],
    );
  }
  await client.query(
    `UPDATE translation_proposal_schedule_runs
        SET status = 'succeeded', change_set_id = $1, completed_at = now()
      WHERE id = $2 AND status = 'running'`,
    [changeSet.rows[0]!.id, scheduleRun.id],
  );
  await client.query(
    `UPDATE translation_proposal_schedules
        SET last_finished_at = now(), last_error_code = NULL, updated_at = now()
      WHERE id = $1`,
    [scheduleRun.scheduleId],
  );
  await client.query(
    `INSERT INTO audit_events
        (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
     VALUES ($1, 'translation.schedule_proposal_created', $2,
             'translation_change_set', $3, $4)`,
    [
      scheduleRun.organizationId,
      scheduleRun.createdByActorId,
      changeSet.rows[0]!.id,
      {
        workspaceId: scheduleRun.workspaceId,
        scheduleId: scheduleRun.scheduleId,
        scheduleRunId: scheduleRun.id,
        processRunId: input.processRunId,
        itemCount: items.length,
      },
    ],
  );
  return { handled: true, status: 'succeeded', changeSetId: changeSet.rows[0]!.id };
}

export function mountTranslationProposalScheduleRoutes(
  app: Express,
  dependencies: Dependencies,
): void {
  const { pool, resolveTenantContext, requireRoles, error, requestId } = dependencies;

  app.get('/api/v1/translation-proposal-schedules', async (request, response, next) => {
    try {
      const context = await resolveTenantContext(request);
      await requireRoles(context, scheduleViewerRoles);
      const result = await pool.query(
        `SELECT ${scheduleProjection()}
           FROM translation_proposal_schedules tps
          WHERE tps.organization_id = $1 AND tps.workspace_id = $2
          ORDER BY tps.created_at DESC`,
        [context.organizationId, context.workspaceId],
      );
      response.json({ schedules: result.rows, requestId: requestId(request) });
    } catch (caught) {
      next(caught);
    }
  });

  app.post('/api/v1/translation-proposal-schedules', async (request, response, next) => {
    try {
      const context = await resolveTenantContext(request);
      await requireRoles(context, schedulerRoles);
      const input = createTranslationProposalScheduleSchema.parse({ ...request.body, ...context });
      if (input.status === 'active') await requireRoles(context, scheduleActivatorRoles);
      const result = await withTransaction(pool, async (client) => {
        await validatePublishedTranslationFlow(client, input, error);
        const inserted = await client.query(
          `INSERT INTO translation_proposal_schedules
              (organization_id, workspace_id, flow_id, flow_version_id, schedule_key,
               status, cadence_seconds, max_items, message_key_prefixes, next_run_at,
               created_by_actor_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING ${scheduleProjection('translation_proposal_schedules')}`,
          [
            input.organizationId,
            input.workspaceId,
            input.flowId,
            input.flowVersionId,
            input.scheduleKey,
            input.status,
            input.cadenceSeconds,
            input.maxItems,
            JSON.stringify(input.messageKeyPrefixes),
            input.nextRunAt,
            input.actorId,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'translation.schedule_created', $2,
                   'translation_proposal_schedule', $3, $4)`,
          [
            input.organizationId,
            input.actorId,
            inserted.rows[0]!.id,
            {
              workspaceId: input.workspaceId,
              flowId: input.flowId,
              flowVersionId: input.flowVersionId,
              cadenceSeconds: input.cadenceSeconds,
              maxItems: input.maxItems,
              status: input.status,
            },
          ],
        );
        return inserted.rows[0];
      });
      response.status(201).json({ schedule: result, requestId: requestId(request) });
    } catch (caught) {
      next(caught);
    }
  });

  app.patch(
    '/api/v1/translation-proposal-schedules/:scheduleId',
    async (request, response, next) => {
      try {
        const context = await resolveTenantContext(request);
        await requireRoles(context, schedulerRoles);
        const input = updateTranslationProposalScheduleSchema.parse({
          ...request.body,
          ...context,
          scheduleId: request.params.scheduleId,
        });
        if (input.status === 'active') await requireRoles(context, scheduleActivatorRoles);
        const result = await withTransaction(pool, async (client) => {
          const existing = await client.query<ScheduleRow>(
            `SELECT ${scheduleProjection('tps')}
               FROM translation_proposal_schedules tps
              WHERE tps.id = $1 AND tps.organization_id = $2 AND tps.workspace_id = $3
              FOR UPDATE`,
            [input.scheduleId, input.organizationId, input.workspaceId],
          );
          if (!existing.rows[0]) throw error(404, 'translation_schedule_not_found');
          if (existing.rows[0].status === 'expired') {
            throw error(409, 'translation_schedule_expired');
          }
          if (input.status === 'active') {
            await validatePublishedTranslationFlow(client, existing.rows[0], error);
          }
          const updated = await client.query(
            `UPDATE translation_proposal_schedules
              SET cadence_seconds = COALESCE($1, cadence_seconds),
                  max_items = COALESCE($2, max_items),
                  message_key_prefixes = COALESCE($3, message_key_prefixes),
                  next_run_at = COALESCE($4, next_run_at),
                  status = COALESCE($5, status), updated_at = now()
            WHERE id = $6 AND organization_id = $7 AND workspace_id = $8
            RETURNING ${scheduleProjection('translation_proposal_schedules')}`,
            [
              input.cadenceSeconds ?? null,
              input.maxItems ?? null,
              input.messageKeyPrefixes === undefined
                ? null
                : JSON.stringify(input.messageKeyPrefixes),
              input.nextRunAt ?? null,
              input.status ?? null,
              input.scheduleId,
              input.organizationId,
              input.workspaceId,
            ],
          );
          await client.query(
            `INSERT INTO audit_events
              (organization_id, event_type, actor_id, subject_type, subject_id, metadata)
           VALUES ($1, 'translation.schedule_updated', $2,
                   'translation_proposal_schedule', $3, $4)`,
            [
              input.organizationId,
              input.actorId,
              input.scheduleId,
              { workspaceId: input.workspaceId, changedFields: Object.keys(request.body).sort() },
            ],
          );
          return updated.rows[0];
        });
        response.json({ schedule: result, requestId: requestId(request) });
      } catch (caught) {
        next(caught);
      }
    },
  );

  app.post('/internal/v1/translation-proposal-schedules/tick', async (request, response, next) => {
    try {
      requiredSchedulerSecret(request, dependencies.schedulerSecret, error);
      const input = tickTranslationProposalSchedulesSchema.parse(request.body);
      if (Math.abs(Date.now() - new Date(input.requestedAt).getTime()) > 300_000) {
        throw error(401, 'translation_scheduler_timestamp_outside_window');
      }
      const results = await withTransaction(pool, async (client) => {
        const due = await client.query<ScheduleRow>(
          `SELECT tps.id, tps.organization_id AS "organizationId",
                  tps.workspace_id AS "workspaceId", tps.flow_id AS "flowId",
                  tps.flow_version_id AS "flowVersionId", tps.schedule_key AS "scheduleKey",
                  tps.status, tps.cadence_seconds AS "cadenceSeconds",
                  tps.max_items AS "maxItems", tps.message_key_prefixes AS "messageKeyPrefixes",
                  tps.next_run_at AS "nextRunAt",
                  tps.created_by_actor_id AS "createdByActorId"
             FROM translation_proposal_schedules tps
            WHERE tps.status = 'active' AND tps.next_run_at <= now()
            ORDER BY tps.next_run_at, tps.id
            FOR UPDATE SKIP LOCKED
            LIMIT $1`,
          [maxDuePerTick],
        );
        const started = [];
        for (const schedule of due.rows) {
          await client.query('SAVEPOINT translation_schedule_start');
          try {
            started.push(await startDueSchedule(client, schedule, input, error));
            await client.query('RELEASE SAVEPOINT translation_schedule_start');
          } catch (caught) {
            await client.query('ROLLBACK TO SAVEPOINT translation_schedule_start');
            const errorCode = expectedScheduleStartError(caught);
            if (!errorCode) throw caught;
            await skipScheduleRun(client, schedule, schedule.nextRunAt, input, errorCode);
            started.push({ scheduleId: schedule.id, status: 'skipped' as const, errorCode });
            await client.query('RELEASE SAVEPOINT translation_schedule_start');
          }
        }
        return started;
      });
      response.json({
        status: 'ok',
        dueCount: results.length,
        results,
        requestId: requestId(request),
      });
    } catch (caught) {
      next(caught);
    }
  });
}
