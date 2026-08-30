import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const dispatcherSecret = 'casioplus-n8n-result-dispatcher-secret-2026';

describeWithDatabase('n8n runtime orchestration boundary', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  let organizationId = '';
  let workspaceId = '';
  let actorId = '';
  let workItemId = '';
  let flowId = '';
  let flowVersionId = '';
  let processRunId = '';
  const unique = randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`n8n Runtime ${unique}`, `n8n-runtime-${unique}`],
    );
    organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'n8n Runtime Workspace', 'n8n-runtime') RETURNING id`,
      [organizationId],
    );
    workspaceId = workspace.rows[0]!.id;
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', 'n8n Runtime Owner') RETURNING id`,
      [organizationId, workspaceId],
    );
    actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, actorId],
    );
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'n8n Runtime Work', $3) RETURNING id`,
      [organizationId, workspaceId, actorId],
    );
    workItemId = workItem.rows[0]!.id;
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, $3, 'n8n Runtime Flow', $4) RETURNING id`,
      [organizationId, workspaceId, `n8n-runtime-${unique}`, actorId],
    );
    flowId = flow.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, 'n8n', $2, $3) RETURNING id`,
      [flowId, { steps: [{ kind: 'transform', name: 'normalize' }] }, actorId],
    );
    flowVersionId = version.rows[0]!.id;
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status, input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8) RETURNING id`,
      [
        organizationId,
        workspaceId,
        workItemId,
        flowId,
        flowVersionId,
        `n8n-run-${unique}`,
        actorId,
        { subject: 'Casioplus runtime test' },
      ],
    );
    processRunId = run.rows[0]!.id;
    app = createApp(pool, {
      resolveTenantContext: async () => ({ organizationId, workspaceId, actorId }),
      dispatcherSecret,
      enforceMembership: true,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('queues n8n execution idempotently and completes the canonical run from typed adapter result', async () => {
    const first = await request(app).post(`/api/v1/process-runs/${processRunId}/execute`).send({});
    expect(first.status).toBe(202);
    expect(first.body.run.status).toBe('running');
    expect(first.body.dispatch.status).toBe('pending');

    const duplicate = await request(app)
      .post(`/api/v1/process-runs/${processRunId}/execute`)
      .send({});
    expect(duplicate.status).toBe(202);
    expect(duplicate.body.dispatch.id).toBe(first.body.dispatch.id);

    const outbox = await pool.query<{
      id: string;
      destination: string;
      operation: string;
      payload: Record<string, unknown>;
    }>(
      `UPDATE integration_outbox SET status = 'in_progress', attempts = 1
        WHERE process_run_id = $1
        RETURNING id, destination, operation, payload`,
      [processRunId],
    );
    expect(outbox.rows[0]).toMatchObject({
      destination: 'n8n',
      operation: 'n8n.flow.execute',
    });
    expect(outbox.rows[0]!.payload).toMatchObject({ processRunId, flowVersionId });

    const result = await request(app)
      .post(`/internal/v1/outbox/${outbox.rows[0]!.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({
        status: 'dispatched',
        adapterResult: {
          status: 'succeeded',
          executionId: 'n8n-execution-42',
          output: { decision: 'approved' },
        },
      });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('dispatched');

    const run = await pool.query<{ status: string; output: Record<string, unknown> }>(
      `SELECT status, output FROM flow_runs WHERE id = $1`,
      [processRunId],
    );
    expect(run.rows[0]).toEqual({ status: 'succeeded', output: { decision: 'approved' } });
    const workItem = await pool.query<{ status: string }>(
      `SELECT status FROM work_items WHERE id = $1`,
      [workItemId],
    );
    expect(workItem.rows[0]!.status).toBe('completed');
    const event = await pool.query<{ eventType: string }>(
      `SELECT event_type AS "eventType" FROM runtime_events
        WHERE process_run_id = $1 AND event_type = 'n8n.execution.succeeded'`,
      [processRunId],
    );
    expect(event.rowCount).toBe(1);
  });

  it('marks the canonical run failed when n8n reaches dead letter', async () => {
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'n8n Failure Work', $3) RETURNING id`,
      [organizationId, workspaceId, actorId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status, input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', '{}'::jsonb) RETURNING id`,
      [
        organizationId,
        workspaceId,
        workItem.rows[0]!.id,
        flowId,
        flowVersionId,
        `n8n-failed-${unique}`,
        actorId,
      ],
    );
    const queued = await request(app)
      .post(`/api/v1/process-runs/${run.rows[0]!.id}/execute`)
      .send({});
    expect(queued.status).toBe(202);
    const outbox = await pool.query<{ id: string }>(
      `UPDATE integration_outbox SET status = 'in_progress', attempts = 8
        WHERE process_run_id = $1 RETURNING id`,
      [run.rows[0]!.id],
    );
    const failed = await request(app)
      .post(`/internal/v1/outbox/${outbox.rows[0]!.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({ status: 'dead_letter', errorCode: 'n8n_webhook_unavailable' });
    expect(failed.status).toBe(200);
    const persisted = await pool.query<{ status: string; errorCode: string }>(
      `SELECT status, error_code AS "errorCode" FROM flow_runs WHERE id = $1`,
      [run.rows[0]!.id],
    );
    expect(persisted.rows[0]).toEqual({
      status: 'failed',
      errorCode: 'n8n_webhook_unavailable',
    });
  });
});
