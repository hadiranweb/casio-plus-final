import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArtifactObjectStore } from './artifact-storage.js';
import { createApp, type TenantContext } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const dispatcherSecret = 'casioplus-usage-recorder-secret-2026';

describeWithDatabase('artifact storage and immutable usage ledger', () => {
  let pool!: ReturnType<typeof createPool>;
  let context!: TenantContext;
  let app!: ReturnType<typeof createApp>;
  let namespaceId = '';
  let flowId = '';
  let flowVersionId = '';
  let processRunId = '';
  let pricingVersionId = '';
  let artifactId = '';
  const unique = randomUUID().slice(0, 8);
  const checksum = `sha256-${'a'.repeat(64)}`;
  const objectStore: ArtifactObjectStore = {
    createUploadUrl: vi.fn(async () => 'https://storage.example/upload/signed'),
    headObject: vi.fn(async () => ({ sizeBytes: 128, checksum })),
    deleteObject: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Artifact ${unique}`, `artifact-${unique}`],
    );
    const organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Artifact Workspace', 'artifact-workspace') RETURNING id`,
      [organizationId],
    );
    const workspaceId = workspace.rows[0]!.id;
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', 'Artifact Owner') RETURNING id`,
      [organizationId, workspaceId],
    );
    const actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, actorId],
    );
    const policy = await pool.query<{ id: string }>(
      `INSERT INTO storage_policies (organization_id) VALUES ($1) RETURNING id`,
      [organizationId],
    );
    const namespace = await pool.query<{ id: string }>(
      `INSERT INTO memory_namespaces
          (organization_id, storage_policy_id, key, name, namespace_kind)
       VALUES ($1, $2, 'organization-memory', 'Organization Memory', 'governed') RETURNING id`,
      [organizationId, policy.rows[0]!.id],
    );
    namespaceId = namespace.rows[0]!.id;
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'Artifact Work', $3) RETURNING id`,
      [organizationId, workspaceId, actorId],
    );
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, 'artifact-flow', 'Artifact Flow', $3) RETURNING id`,
      [organizationId, workspaceId, actorId],
    );
    flowId = flow.rows[0]!.id;
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions (flow_id, version, runtime_binding, created_by_actor_id)
       VALUES ($1, 1, 'native', $2) RETURNING id`,
      [flowId, actorId],
    );
    flowVersionId = version.rows[0]!.id;
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded') RETURNING id`,
      [
        organizationId,
        workspaceId,
        workItem.rows[0]!.id,
        flowId,
        flowVersionId,
        `artifact-run-${unique}`,
        actorId,
      ],
    );
    processRunId = run.rows[0]!.id;
    context = { organizationId, workspaceId, actorId };
    app = createApp(pool, {
      resolveTenantContext: async () => context,
      artifactObjectStore: objectStore,
      dispatcherSecret,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates, verifies, and deletes an artifact without client-controlled object keys', async () => {
    const upload = await request(app)
      .post('/api/v1/artifact-uploads')
      .send({
        processRunId,
        namespaceId,
        artifactType: 'json',
        contentType: 'application/json',
        sizeBytes: 128,
        checksum,
        sourceHash: 'b'.repeat(64),
        sourceVersion: 'run-output-v1',
        idempotencyKey: `artifact-upload-${unique}`,
      });
    expect(upload.status).toBe(201);
    expect(upload.body.upload.url).toBe('https://storage.example/upload/signed');
    artifactId = upload.body.artifact.id;

    const completed = await request(app)
      .post(`/api/v1/artifact-uploads/${artifactId}/complete`)
      .send({ observedSizeBytes: 128, observedChecksum: checksum });
    expect(completed.status).toBe(200);
    expect(completed.body.artifact.integrityStatus).toBe('verified');

    const deleted = await request(app).post(`/api/v1/artifacts/${artifactId}/delete`).send({});
    expect(deleted.status).toBe(200);
    expect(objectStore.deleteObject).toHaveBeenCalledTimes(1);
  });

  it('records versioned usage once and keeps P&L separate from ecosystem TCO', async () => {
    const pricing = await request(app)
      .post('/api/v1/pricing-assumptions')
      .send({
        key: 'native.runtime.planning',
        version: 1,
        status: 'active',
        assumptions: { basis: 'organization-approved planning assumption' },
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(pricing.status).toBe(201);
    pricingVersionId = pricing.body.pricingVersion.id;

    const usageBody = {
      ...context,
      flowId,
      flowVersionId,
      processRunId,
      namespaceId,
      operation: 'native.diagnosis',
      runtime: 'native',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      inputBytes: 256,
      outputBytes: 512,
      latencyMs: 140,
      unitCost: '0.01000000',
      allocatedSharedCost: '0.00200000',
      billableAmount: '0.02000000',
      currency: 'USD',
      payer: 'casioplus',
      pricingVersionId,
      idempotencyKey: `usage-event-${unique}`,
    };
    const recorded = await request(app)
      .post('/internal/v1/usage-events')
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send(usageBody);
    expect(recorded.status).toBe(201);

    const duplicate = await request(app)
      .post('/internal/v1/usage-events')
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send(usageBody);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.idempotent).toBe(true);

    const pnl = await request(app).get('/api/v1/usage/summary?view=casioplus_pnl');
    const tco = await request(app).get('/api/v1/usage/summary?view=ecosystem_tco');
    expect(pnl.status).toBe(200);
    expect(tco.status).toBe(200);
    expect(pnl.body.view).not.toBe(tco.body.view);
    expect(pnl.body.summary[0].revenue).toBe('0.02000000');
    expect(tco.body.summary[0].ecosystem_tco).toBe('0.01200000');
  });

  it('rejects mutation of immutable usage rows', async () => {
    await expect(
      pool.query(
        `UPDATE usage_events SET latency_ms = latency_ms + 1
          WHERE organization_id = $1 AND idempotency_key = $2`,
        [context.organizationId, `usage-event-${unique}`],
      ),
    ).rejects.toThrow(/immutable ledger rows/);
  });
});
