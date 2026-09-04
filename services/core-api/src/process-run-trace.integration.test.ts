import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('process run trace', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  let organizationId = '';
  let workspaceId = '';
  let actorId = '';
  let processRunId = '';
  const unique = randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));

    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Trace ${unique}`, `trace-${unique}`],
    );
    organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug) VALUES ($1, 'Trace Workspace', 'trace') RETURNING id`,
      [organizationId],
    );
    workspaceId = workspace.rows[0]!.id;
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', 'Trace Owner') RETURNING id`,
      [organizationId, workspaceId],
    );
    actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, actorId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (organization_id, workspace_id, actor_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [organizationId, workspaceId, actorId],
    );
    const work = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'Trace Work', $3) RETURNING id`,
      [organizationId, workspaceId, actorId],
    );
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, $3, 'Trace Flow', $4) RETURNING id`,
      [organizationId, workspaceId, `trace-${unique}`, actorId],
    );
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, 'native', '{}'::jsonb, $2) RETURNING id`,
      [flow.rows[0]!.id, actorId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id, idempotency_key,
           created_by_actor_id, status, input, output)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8, $9) RETURNING id`,
      [
        organizationId,
        workspaceId,
        work.rows[0]!.id,
        flow.rows[0]!.id,
        version.rows[0]!.id,
        `trace-run-${unique}`,
        actorId,
        { candidates: [{ id: 'candidate-a' }] },
        {
          candidateEvaluations: [
            {
              candidateId: 'candidate-a',
              confidence: 0.82,
              axes: { capabilityFit: { score: 0.8, evidence: ['Skill evidence provided.'] } },
            },
          ],
        },
      ],
    );
    processRunId = run.rows[0]!.id;
    await pool.query(
      `INSERT INTO runtime_events (organization_id, workspace_id, process_run_id, actor_id, event_type, payload)
       VALUES ($1, $2, $3, $4, 'analysis.started', '{}'::jsonb)`,
      [organizationId, workspaceId, processRunId, actorId],
    );
    app = createApp(pool, {
      resolveTenantContext: async () => ({ organizationId, workspaceId, actorId }),
      enforceMembership: true,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('returns only the selected Run output and operational events', async () => {
    const response = await request(app).get(`/api/v1/process-runs/${processRunId}/trace`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.run).toMatchObject({ id: processRunId, status: 'succeeded' });
    expect(response.body.run.output.candidateEvaluations[0]).toMatchObject({
      candidateId: 'candidate-a',
      confidence: 0.82,
    });
    expect(response.body.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'analysis.started' })]),
    );
    expect(response.body).not.toHaveProperty('semanticRecords');
    expect(response.body).not.toHaveProperty('knowledgeClaims');
  });

  it('does not disclose the trace outside the resolved organization and workspace', async () => {
    const isolated = createApp(pool, {
      resolveTenantContext: async () => ({
        organizationId: randomUUID(),
        workspaceId: randomUUID(),
        actorId: randomUUID(),
      }),
      enforceMembership: false,
    });
    const response = await request(isolated).get(`/api/v1/process-runs/${processRunId}/trace`);
    expect(response.status).toBe(404);
  });
});
