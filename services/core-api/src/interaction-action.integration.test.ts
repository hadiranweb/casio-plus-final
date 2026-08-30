import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const dispatcherSecret = 'casioplus-runtime-result-dispatcher-secret-2026';

describeWithDatabase('interaction and action runtime boundaries', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  let organizationId = '';
  let workspaceId = '';
  let actorId = '';
  let pricingVersionId = '';
  const unique = randomUUID().slice(0, 8);

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Runtime Planes ${unique}`, `runtime-planes-${unique}`],
    );
    organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Runtime Planes Workspace', 'runtime-planes') RETURNING id`,
      [organizationId],
    );
    workspaceId = workspace.rows[0]!.id;
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', 'Runtime Planes Owner') RETURNING id`,
      [organizationId, workspaceId],
    );
    actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, actorId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships
          (organization_id, workspace_id, actor_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [organizationId, workspaceId, actorId],
    );
    const storagePolicy = await pool.query<{ id: string }>(
      `INSERT INTO storage_policies (organization_id, mode, retention_days, deletion_propagation)
       VALUES ($1, 'casio_managed', 365, true) RETURNING id`,
      [organizationId],
    );
    await pool.query(
      `INSERT INTO memory_namespaces
          (organization_id, workspace_id, storage_policy_id, key, name, namespace_kind)
       VALUES ($1, NULL, $2, 'organization-memory', 'Organization Memory', 'governed')`,
      [organizationId, storagePolicy.rows[0]!.id],
    );
    app = createApp(pool, {
      resolveTenantContext: async () => ({ organizationId, workspaceId, actorId }),
      dispatcherSecret,
      integrationSecrets: {},
      enforceMembership: true,
    });
    const pricing = await request(app)
      .post('/api/v1/pricing-assumptions')
      .send({
        key: 'runtime-metering',
        version: 1,
        status: 'active',
        assumptions: { source: 'integration-test-only' },
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(pricing.status, JSON.stringify(pricing.body)).toBe(201);
    pricingVersionId = pricing.body.pricingVersion.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function createRun(
    runtimeBinding: 'open-webui' | 'openclaw',
    definition: Record<string, unknown>,
    input: Record<string, unknown>,
  ) {
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, workspaceId, `${runtimeBinding} work`, actorId],
    );
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        organizationId,
        workspaceId,
        `${runtimeBinding}-${randomUUID()}`,
        `${runtimeBinding} flow`,
        actorId,
      ],
    );
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, $2, $3, $4) RETURNING id`,
      [flow.rows[0]!.id, runtimeBinding, definition, actorId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status, input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8) RETURNING id`,
      [
        organizationId,
        workspaceId,
        workItem.rows[0]!.id,
        flow.rows[0]!.id,
        version.rows[0]!.id,
        `${runtimeBinding}-${randomUUID()}`,
        actorId,
        input,
      ],
    );
    return {
      workItemId: workItem.rows[0]!.id,
      flowId: flow.rows[0]!.id,
      flowVersionId: version.rows[0]!.id,
      processRunId: run.rows[0]!.id,
    };
  }

  async function createMeterBinding(input: {
    runtime: 'open-webui' | 'openclaw';
    operation: 'model.chat.complete' | 'action.send_message';
    resourceKey: string;
    directUnitCost: string;
    inputTokenUnitCost?: string;
    outputTokenUnitCost?: string;
  }) {
    const response = await request(app)
      .post('/api/v1/runtime-meter-bindings')
      .send({
        ...input,
        pricingVersionId,
        currency: 'USD',
        payer: 'casioplus',
        inputTokenUnitCost: input.inputTokenUnitCost ?? '0',
        outputTokenUnitCost: input.outputTokenUnitCost ?? '0',
        allocatedSharedCost: '0.00010000',
        billableMultiplier: '1.200000',
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.binding;
  }

  async function claimOutbox(processRunId: string) {
    const claimed = await pool.query<{
      id: string;
      destination: string;
      operation: string;
      payload: Record<string, unknown>;
    }>(
      `UPDATE integration_outbox SET status = 'in_progress', attempts = attempts + 1
        WHERE process_run_id = $1
        RETURNING id, destination, operation, payload`,
      [processRunId],
    );
    return claimed.rows[0]!;
  }

  it('fails closed before queueing a runtime without an active meter binding', async () => {
    const fixture = await createRun(
      'open-webui',
      { model: 'unpriced-model', maxTokens: 64 },
      { prompt: 'This request must not be queued.' },
    );
    const denied = await request(app)
      .post(`/api/v1/process-runs/${fixture.processRunId}/execute`)
      .send({});
    expect(denied.status).toBe(503);
    expect(denied.body.error).toBe('runtime_metering_not_configured');
    const outbox = await pool.query(`SELECT 1 FROM integration_outbox WHERE process_run_id = $1`, [
      fixture.processRunId,
    ]);
    expect(outbox.rowCount).toBe(0);
  });

  it('queues model-only Open WebUI execution and completes the canonical run', async () => {
    await createMeterBinding({
      runtime: 'open-webui',
      operation: 'model.chat.complete',
      resourceKey: 'casioplus-general',
      directUnitCost: '0',
      inputTokenUnitCost: '0.000001000000',
      outputTokenUnitCost: '0.000002000000',
    });
    const fixture = await createRun(
      'open-webui',
      { model: 'casioplus-general', systemPrompt: 'Respond with verified facts.', maxTokens: 128 },
      { prompt: 'Summarize the governed record.' },
    );
    const queued = await request(app)
      .post(`/api/v1/process-runs/${fixture.processRunId}/execute`)
      .send({});
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    expect(queued.body.dispatch.status).toBe('pending');

    const outbox = await claimOutbox(fixture.processRunId);
    expect(outbox).toMatchObject({
      destination: 'open-webui',
      operation: 'model.chat.complete',
    });
    expect(outbox.payload).toMatchObject({
      processRunId: fixture.processRunId,
      definition: { model: 'casioplus-general' },
    });

    const result = await request(app)
      .post(`/internal/v1/outbox/${outbox.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({
        status: 'dispatched',
        adapterResult: {
          status: 'succeeded',
          executionId: 'completion-42',
          runtime: 'open-webui',
          model: 'casioplus-general',
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
          latencyMs: 240,
          output: { content: 'Governed summary' },
        },
      });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const run = await pool.query<{ status: string; output: Record<string, unknown> }>(
      `SELECT status, output FROM flow_runs WHERE id = $1`,
      [fixture.processRunId],
    );
    expect(run.rows[0]).toEqual({ status: 'succeeded', output: { content: 'Governed summary' } });
    const event = await pool.query(
      `SELECT 1 FROM runtime_events
        WHERE process_run_id = $1 AND event_type = 'open-webui.execution.succeeded'`,
      [fixture.processRunId],
    );
    expect(event.rowCount).toBe(1);
    const usage = await pool.query<{
      runtime: string;
      inputTokens: string;
      outputTokens: string;
      billableAmount: string;
    }>(
      `SELECT runtime, input_tokens AS "inputTokens", output_tokens AS "outputTokens",
              billable_amount AS "billableAmount"
         FROM usage_events WHERE process_run_id = $1`,
      [fixture.processRunId],
    );
    expect(usage.rows[0]).toMatchObject({
      runtime: 'open-webui',
      inputTokens: '20',
      outputTokens: '8',
    });
    expect(Number(usage.rows[0]!.billableAmount)).toBeGreaterThan(0);
  });

  it('keeps OpenClaw default-deny until a valid human approval and resolves only a server target', async () => {
    await createMeterBinding({
      runtime: 'openclaw',
      operation: 'action.send_message',
      resourceKey: 'send_message',
      directUnitCost: '0.001000000000',
    });
    const fixture = await createRun(
      'openclaw',
      { action: 'send_message', targetKey: 'operations-primary' },
      { message: 'Deployment completed successfully.' },
    );
    const target = await request(app).post('/api/v1/action-targets').send({
      key: 'operations-primary',
      action: 'send_message',
      executorRef: 'operations.primary',
    });
    expect(target.status, JSON.stringify(target.body)).toBe(201);
    const policy = await request(app).post('/api/v1/action-policies').send({
      flowId: fixture.flowId,
      flowVersionId: fixture.flowVersionId,
      targetId: target.body.target.id,
      action: 'send_message',
      riskClass: 'high',
    });
    expect(policy.status, JSON.stringify(policy.body)).toBe(201);

    const denied = await request(app)
      .post(`/api/v1/process-runs/${fixture.processRunId}/execute`)
      .send({});
    expect(denied.status).toBe(409);
    expect(denied.body.error).toBe('openclaw_approval_required');

    const requested = await request(app).post('/api/v1/action-approvals').send({
      processRunId: fixture.processRunId,
      expiresInSeconds: 600,
    });
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    expect(requested.body.approval.status).toBe('pending');
    const approved = await request(app)
      .post(`/api/v1/action-approvals/${requested.body.approval.id}/decisions`)
      .send({ decision: 'approved', reason: 'Verified release evidence.' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.approval.status).toBe('approved');

    const queued = await request(app)
      .post(`/api/v1/process-runs/${fixture.processRunId}/execute`)
      .send({});
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    const outbox = await claimOutbox(fixture.processRunId);
    expect(outbox).toMatchObject({
      destination: 'openclaw',
      operation: 'action.send_message',
    });
    expect(outbox.payload).toMatchObject({
      action: 'send_message',
      executorRef: 'operations.primary',
      message: 'Deployment completed successfully.',
      approvalId: requested.body.approval.id,
    });
    expect(outbox.payload).not.toHaveProperty('target');

    const result = await request(app)
      .post(`/internal/v1/outbox/${outbox.id}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({
        status: 'dispatched',
        adapterResult: {
          status: 'succeeded',
          executionId: 'openclaw-message-42',
          runtime: 'openclaw',
          latencyMs: 320,
          output: { channel: 'slack', messageId: 'openclaw-message-42' },
        },
      });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const execution = await pool.query<{
      status: string;
      externalResultRef: string;
    }>(
      `SELECT status, external_result_ref AS "externalResultRef"
         FROM action_executions WHERE process_run_id = $1`,
      [fixture.processRunId],
    );
    expect(execution.rows[0]).toEqual({
      status: 'succeeded',
      externalResultRef: 'openclaw-message-42',
    });
    const usage = await pool.query<{ runtime: string; operation: string }>(
      `SELECT runtime, operation FROM usage_events WHERE process_run_id = $1`,
      [fixture.processRunId],
    );
    expect(usage.rows[0]).toEqual({ runtime: 'openclaw', operation: 'action.send_message' });
  });
});
