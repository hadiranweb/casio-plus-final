import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const schedulerSecret = 'translation-scheduler-test-secret-at-least-32-characters';
const dispatcherSecret = 'translation-scheduler-dispatcher-secret-at-least-32-characters';
const model = 'translation-schedule-test-model';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describeWithDatabase('translation proposal schedule governance', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  let organizationId = '';
  let workspaceId = '';
  let siblingWorkspaceId = '';
  let ownerId = '';
  let editorId = '';
  let reviewerId = '';
  let siblingOwnerId = '';
  let flowId = '';
  let flowVersionId = '';
  let pricingVersionId = '';
  let scheduleId = '';
  const contexts = new Map<
    string,
    { organizationId: string; workspaceId: string; actorId: string }
  >();
  const unique = randomUUID().slice(0, 8);

  async function createActor(
    targetWorkspaceId: string,
    role: 'owner' | 'editor' | 'reviewer',
    displayName: string,
  ) {
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', $3) RETURNING id`,
      [organizationId, targetWorkspaceId, displayName],
    );
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, $3, 'active')`,
      [organizationId, actor.rows[0]!.id, role],
    );
    await pool.query(
      `INSERT INTO workspace_memberships
          (organization_id, workspace_id, actor_id, role, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [organizationId, targetWorkspaceId, actor.rows[0]!.id, role],
    );
    contexts.set(actor.rows[0]!.id, {
      organizationId,
      workspaceId: targetWorkspaceId,
      actorId: actor.rows[0]!.id,
    });
    return actor.rows[0]!.id;
  }

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Schedule ${unique}`, `schedule-${unique}`],
    );
    organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Translation Schedule Workspace', 'schedule-workspace') RETURNING id`,
      [organizationId],
    );
    workspaceId = workspace.rows[0]!.id;
    const sibling = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Sibling Schedule Workspace', 'sibling-schedule-workspace') RETURNING id`,
      [organizationId],
    );
    siblingWorkspaceId = sibling.rows[0]!.id;
    ownerId = await createActor(workspaceId, 'owner', 'Schedule Owner');
    editorId = await createActor(workspaceId, 'editor', 'Schedule Editor');
    reviewerId = await createActor(workspaceId, 'reviewer', 'Schedule Reviewer');
    siblingOwnerId = await createActor(siblingWorkspaceId, 'owner', 'Sibling Schedule Owner');

    const storagePolicy = await pool.query<{ id: string }>(
      `INSERT INTO storage_policies (organization_id, mode, retention_days, deletion_propagation)
       VALUES ($1, 'casio_managed', 365, true) RETURNING id`,
      [organizationId],
    );
    await pool.query(
      `INSERT INTO memory_namespaces
          (organization_id, workspace_id, storage_policy_id, key, name, namespace_kind)
       VALUES ($1, $2, $3, 'translation-schedule-memory',
               'Translation Schedule Memory', 'governed')`,
      [organizationId, workspaceId, storagePolicy.rows[0]!.id],
    );

    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows
          (organization_id, workspace_id, key, name, status, created_by_actor_id)
       VALUES ($1, $2, $3, 'Scheduled translation proposal', 'published', $4)
       RETURNING id`,
      [organizationId, workspaceId, `scheduled-translation-${unique}`, ownerId],
    );
    flowId = flow.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, 'open-webui', $2, $3) RETURNING id`,
      [flowId, { model, maxTokens: 512, temperature: 0.1 }, ownerId],
    );
    flowVersionId = version.rows[0]!.id;
    await pool.query(`UPDATE flows SET active_version_id = $1 WHERE id = $2`, [
      flowVersionId,
      flowId,
    ]);

    app = createApp(pool, {
      resolveTenantContext: async (incoming) => {
        const actorId = incoming.header('x-test-actor-id') ?? ownerId;
        const context = contexts.get(actorId);
        if (!context) throw new Error('test_actor_context_missing');
        return context;
      },
      enforceMembership: true,
      schedulerSecret,
      dispatcherSecret,
      integrationSecrets: {},
    });

    const pricing = await request(app)
      .post('/api/v1/pricing-assumptions')
      .set('x-test-actor-id', ownerId)
      .send({
        key: 'translation-schedule-model',
        version: 1,
        status: 'active',
        assumptions: { source: 'integration-test-only' },
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(pricing.status, JSON.stringify(pricing.body)).toBe(201);
    pricingVersionId = pricing.body.pricingVersion.id;
    const meter = await request(app)
      .post('/api/v1/runtime-meter-bindings')
      .set('x-test-actor-id', ownerId)
      .send({
        pricingVersionId,
        runtime: 'open-webui',
        operation: 'model.chat.complete',
        resourceKey: model,
        currency: 'USD',
        payer: 'casioplus',
        directUnitCost: '0.001000000000',
        inputTokenUnitCost: '0.000001000000',
        outputTokenUnitCost: '0.000002000000',
        allocatedSharedCost: '0.00010000',
        billableMultiplier: '1.200000',
      });
    expect(meter.status, JSON.stringify(meter.body)).toBe(201);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('enforces RBAC and workspace isolation for schedule management', async () => {
    const activeByEditor = await request(app)
      .post('/api/v1/translation-proposal-schedules')
      .set('x-test-actor-id', editorId)
      .send({
        flowId,
        flowVersionId,
        scheduleKey: `translation-${unique}`,
        cadenceSeconds: 86_400,
        maxItems: 20,
        messageKeyPrefixes: ['shared_', 'forge_'],
        nextRunAt: new Date(Date.now() - 1_000).toISOString(),
        status: 'active',
      });
    expect(activeByEditor.status).toBe(403);

    const created = await request(app)
      .post('/api/v1/translation-proposal-schedules')
      .set('x-test-actor-id', editorId)
      .send({
        flowId,
        flowVersionId,
        scheduleKey: `translation-${unique}`,
        cadenceSeconds: 86_400,
        maxItems: 20,
        messageKeyPrefixes: ['shared_', 'forge_'],
        nextRunAt: new Date(Date.now() - 1_000).toISOString(),
        status: 'paused',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    scheduleId = created.body.schedule.id;

    const reviewerUpdate = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', reviewerId)
      .send({ status: 'active' });
    expect(reviewerUpdate.status).toBe(403);
    const activated = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ status: 'active' });
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body.schedule.status).toBe('active');

    await pool.query(`UPDATE flows SET status = 'draft' WHERE id = $1`, [flowId]);
    const paused = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ status: 'paused' });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    const staleActivation = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ status: 'active' });
    expect(staleActivation.status).toBe(404);
    expect(staleActivation.body.error).toBe('translation_schedule_flow_version_not_published');
    await pool.query(`UPDATE flows SET status = 'published' WHERE id = $1`, [flowId]);
    const reactivated = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ status: 'active' });
    expect(reactivated.status, JSON.stringify(reactivated.body)).toBe(200);

    const siblingList = await request(app)
      .get('/api/v1/translation-proposal-schedules')
      .set('x-test-actor-id', siblingOwnerId);
    expect(siblingList.status).toBe(200);
    expect(siblingList.body.schedules).toEqual([]);
  });

  it('creates only a metered model proposal run and materializes a draft Change Set', async () => {
    const unmeteredFlow = await pool.query<{ id: string }>(
      `INSERT INTO flows
          (organization_id, workspace_id, key, name, status, created_by_actor_id)
       VALUES ($1, $2, $3, 'Unmetered translation proposal', 'published', $4)
       RETURNING id`,
      [organizationId, workspaceId, `unmetered-translation-${unique}`, ownerId],
    );
    const unmeteredVersion = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, 'open-webui', $2, $3) RETURNING id`,
      [unmeteredFlow.rows[0]!.id, { model: 'unmetered-model', maxTokens: 128 }, ownerId],
    );
    await pool.query(`UPDATE flows SET active_version_id = $1 WHERE id = $2`, [
      unmeteredVersion.rows[0]!.id,
      unmeteredFlow.rows[0]!.id,
    ]);
    const unmeteredSchedule = await request(app)
      .post('/api/v1/translation-proposal-schedules')
      .set('x-test-actor-id', ownerId)
      .send({
        flowId: unmeteredFlow.rows[0]!.id,
        flowVersionId: unmeteredVersion.rows[0]!.id,
        scheduleKey: `unmetered-${unique}`,
        cadenceSeconds: 86_400,
        maxItems: 20,
        messageKeyPrefixes: ['shared_'],
        nextRunAt: new Date(Date.now() - 2_000).toISOString(),
        status: 'active',
      });
    expect(unmeteredSchedule.status, JSON.stringify(unmeteredSchedule.body)).toBe(201);

    const snapshot = {
      repositoryFullName: 'hadiranweb/casio-plus-final',
      baseRef: 'main',
      baseCommitSha: 'a'.repeat(40),
      catalogHash: 'b'.repeat(64),
      sourceLocale: 'en',
      targetLocale: 'fa',
      sourceCatalog: {
        shared_greeting_name: 'Hello, {name}',
        forge_review_action: 'Review action',
        console_ignored_action: 'Ignored by prefix',
      },
      targetCatalog: {
        shared_greeting_name: 'سلام، {name}',
        forge_review_action: 'بررسی عملیات',
        console_ignored_action: 'عملیات نادیده',
      },
      requestedAt: new Date().toISOString(),
    };
    const unauthorized = await request(app)
      .post('/internal/v1/translation-proposal-schedules/tick')
      .send(snapshot);
    expect(unauthorized.status).toBe(401);

    const tick = await request(app)
      .post('/internal/v1/translation-proposal-schedules/tick')
      .set('x-casioplus-scheduler-secret', schedulerSecret)
      .send(snapshot);
    expect(tick.status, JSON.stringify(tick.body)).toBe(200);
    expect(tick.body.dueCount).toBe(2);
    const skipped = tick.body.results.find(
      (entry: { status: string }) => entry.status === 'skipped',
    );
    expect(skipped).toMatchObject({
      scheduleId: unmeteredSchedule.body.schedule.id,
      status: 'skipped',
      errorCode: 'translation_schedule_metering_binding_required',
    });
    const started = tick.body.results.find(
      (entry: { status: string }) => entry.status === 'started',
    );
    expect(started).toBeTruthy();
    const processRunId = started.processRunId as string;

    const queued = await pool.query<{
      id: string;
      payload: { input: { prompt: string } };
      meteringSnapshot: { runtime: string; operation: string; resourceKey: string };
    }>(
      `SELECT id, payload, metering_snapshot AS "meteringSnapshot"
         FROM integration_outbox
        WHERE process_run_id = $1 AND operation = 'model.chat.complete'`,
      [processRunId],
    );
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0]!.payload.input.prompt).toContain('shared_greeting_name');
    expect(queued.rows[0]!.payload.input.prompt).toContain('forge_review_action');
    expect(queued.rows[0]!.payload.input.prompt).not.toContain('console_ignored_action');
    expect(queued.rows[0]!.meteringSnapshot).toMatchObject({
      runtime: 'open-webui',
      operation: 'model.chat.complete',
      resourceKey: model,
    });
    const claimed = await request(app)
      .post('/internal/v1/outbox/claim')
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({});
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body.id).toBe(queued.rows[0]!.id);

    const result = await request(app)
      .post(`/internal/v1/outbox/${queued.rows[0]!.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({
        status: 'dispatched',
        adapterResult: {
          status: 'succeeded',
          executionId: 'scheduled-proposal-result-1',
          output: {
            content: JSON.stringify({
              items: [
                { messageKey: 'shared_greeting_name', proposedText: 'درود، {name}' },
                { messageKey: 'forge_review_action', proposedText: 'بازبینی عملیات' },
              ],
            }),
          },
          runtime: 'open-webui',
          model,
          usage: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
          latencyMs: 24,
        },
      });
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const scheduleRun = await pool.query<{
      status: string;
      changeSetId: string;
    }>(
      `SELECT status, change_set_id AS "changeSetId"
         FROM translation_proposal_schedule_runs WHERE process_run_id = $1`,
      [processRunId],
    );
    expect(scheduleRun.rows[0]!.status).toBe('succeeded');
    const changeSet = await pool.query<{ status: string; provenance: Record<string, unknown> }>(
      `SELECT status, provenance FROM translation_change_sets WHERE id = $1`,
      [scheduleRun.rows[0]!.changeSetId],
    );
    expect(changeSet.rows[0]).toMatchObject({
      status: 'draft',
      provenance: { model, promptVersion: 'translation-schedule-v1', scheduleId },
    });
    const changeSetItems = await pool.query<{ messageKey: string; proposedText: string }>(
      `SELECT message_key AS "messageKey", proposed_text AS "proposedText"
         FROM translation_change_set_items WHERE change_set_id = $1 ORDER BY message_key`,
      [scheduleRun.rows[0]!.changeSetId],
    );
    expect(changeSetItems.rows).toEqual([
      { messageKey: 'forge_review_action', proposedText: 'بازبینی عملیات' },
      { messageKey: 'shared_greeting_name', proposedText: 'درود، {name}' },
    ]);
    const usage = await pool.query(
      `SELECT id FROM usage_events
        WHERE process_run_id = $1 AND operation = 'model.chat.complete'`,
      [processRunId],
    );
    expect(usage.rows).toHaveLength(1);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM action_approval_requests
              WHERE organization_id = $1 AND workspace_id = $2
                AND action = 'repository.open_translation_pr'`,
            [organizationId, workspaceId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM integration_outbox
              WHERE organization_id = $1 AND workspace_id = $2
                AND operation = 'action.repository.open_translation_pr'`,
            [organizationId, workspaceId],
          )
        ).rows[0]!.count,
      ),
    ).toBe(0);
  });

  it('fails closed on placeholder drift and never creates a Change Set', async () => {
    const reset = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ nextRunAt: new Date(Date.now() - 1_000).toISOString(), status: 'active' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    const snapshot = {
      repositoryFullName: 'hadiranweb/casio-plus-final',
      baseRef: 'main',
      baseCommitSha: 'c'.repeat(40),
      catalogHash: 'd'.repeat(64),
      sourceLocale: 'en',
      targetLocale: 'fa',
      sourceCatalog: { shared_greeting_name: 'Hello, {name}' },
      targetCatalog: { shared_greeting_name: 'سلام، {name}' },
      requestedAt: new Date().toISOString(),
    };
    const tick = await request(app)
      .post('/internal/v1/translation-proposal-schedules/tick')
      .set('x-casioplus-scheduler-secret', schedulerSecret)
      .send(snapshot);
    expect(tick.status, JSON.stringify(tick.body)).toBe(200);
    const processRunId = tick.body.results[0].processRunId as string;
    const outbox = await pool.query<{ id: string }>(
      `SELECT id FROM integration_outbox WHERE process_run_id = $1`,
      [processRunId],
    );
    const claimed = await request(app)
      .post('/internal/v1/outbox/claim')
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({});
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body.id).toBe(outbox.rows[0]!.id);
    const result = await request(app)
      .post(`/internal/v1/outbox/${outbox.rows[0]!.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({
        status: 'dispatched',
        adapterResult: {
          status: 'succeeded',
          executionId: 'scheduled-proposal-invalid-placeholder',
          output: {
            content: JSON.stringify({
              items: [{ messageKey: 'shared_greeting_name', proposedText: 'درود' }],
            }),
          },
          runtime: 'open-webui',
          model,
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          latencyMs: 12,
        },
      });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const scheduleRun = await pool.query<{
      status: string;
      errorCode: string;
      changeSetId: string | null;
    }>(
      `SELECT status, error_code AS "errorCode", change_set_id AS "changeSetId"
         FROM translation_proposal_schedule_runs WHERE process_run_id = $1`,
      [processRunId],
    );
    expect(scheduleRun.rows[0]).toMatchObject({
      status: 'failed',
      errorCode: 'translation_schedule_output_placeholder_mismatch',
      changeSetId: null,
    });
    const run = await pool.query<{ status: string; errorCode: string }>(
      `SELECT status, error_code AS "errorCode" FROM flow_runs WHERE id = $1`,
      [processRunId],
    );
    expect(run.rows[0]).toMatchObject({
      status: 'failed',
      errorCode: 'translation_schedule_output_placeholder_mismatch',
    });
  });

  it('claims a due schedule once across concurrent or replayed ticks', async () => {
    const reset = await request(app)
      .patch(`/api/v1/translation-proposal-schedules/${scheduleId}`)
      .set('x-test-actor-id', ownerId)
      .send({ nextRunAt: new Date(Date.now() - 1_000).toISOString(), status: 'active' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    const snapshot = {
      repositoryFullName: 'hadiranweb/casio-plus-final',
      baseRef: 'main',
      baseCommitSha: 'e'.repeat(40),
      catalogHash: 'f'.repeat(64),
      sourceLocale: 'en',
      targetLocale: 'fa',
      sourceCatalog: { console_outside_schedule_scope: 'Not selected' },
      targetCatalog: { console_outside_schedule_scope: 'انتخاب نمی‌شود' },
      requestedAt: new Date().toISOString(),
    };
    const [left, right] = await Promise.all([
      request(app)
        .post('/internal/v1/translation-proposal-schedules/tick')
        .set('x-casioplus-scheduler-secret', schedulerSecret)
        .send(snapshot),
      request(app)
        .post('/internal/v1/translation-proposal-schedules/tick')
        .set('x-casioplus-scheduler-secret', schedulerSecret)
        .send(snapshot),
    ]);
    expect(left.status, JSON.stringify(left.body)).toBe(200);
    expect(right.status, JSON.stringify(right.body)).toBe(200);
    expect(left.body.dueCount + right.body.dueCount).toBe(1);
    const result = [...left.body.results, ...right.body.results];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ scheduleId, status: 'skipped' });
    const runs = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM translation_proposal_schedule_runs
        WHERE schedule_id = $1 AND base_commit_sha = $2`,
      [scheduleId, snapshot.baseCommitSha],
    );
    expect(runs.rows[0]!.count).toBe(1);
  });
});
