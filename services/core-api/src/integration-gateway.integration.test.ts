import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const integrationSecret = 'casioplus-integration-signing-secret-2026';
const dispatcherSecret = 'casioplus-dispatcher-shared-secret-2026';
const keyId = 'key-2026-08';
const externalAppKey = 'casioplus-test-client';

function signedHeaders(rawBody: string, nonce: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', integrationSecret)
    .update(`${timestamp}.${nonce}.`, 'utf8')
    .update(Buffer.from(rawBody))
    .digest('hex');
  return {
    'content-type': 'application/json',
    'x-casioplus-external-app': externalAppKey,
    'x-casioplus-key-id': keyId,
    'x-casioplus-nonce': nonce,
    'x-casioplus-timestamp': timestamp,
    'x-casioplus-signature': signature,
  };
}

describeWithDatabase('Integration Gateway boundary', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  const unique = randomUUID().slice(0, 8);
  const idempotencyKey = `integration-${unique}-0001`;
  let outboxId = '';

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    app = createApp(pool, {
      integrationSecrets: { CASIOPLUS_TEST_CLIENT_SECRET: integrationSecret },
      dispatcherSecret,
    });
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Gateway ${unique}`, `gateway-${unique}`],
    );
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Gateway Workspace', 'gateway-workspace') RETURNING id`,
      [organization.rows[0]!.id],
    );
    const externalApp = await pool.query<{ id: string }>(
      `INSERT INTO external_apps (key, name) VALUES ($1, 'Casioplus Test Client') RETURNING id`,
      [externalAppKey],
    );
    await pool.query(
      `INSERT INTO integration_keys (external_app_id, key_id, secret_ref)
       VALUES ($1, $2, 'CASIOPLUS_TEST_CLIENT_SECRET')`,
      [externalApp.rows[0]!.id, keyId],
    );
    const externalTenant = await pool.query<{ id: string }>(
      `INSERT INTO external_tenants (external_app_id, external_tenant_ref, organization_id)
       VALUES ($1, $2, $3) RETURNING id`,
      [externalApp.rows[0]!.id, `tenant-${unique}`, organization.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO external_workspace_mappings
          (external_tenant_id, external_workspace_ref, organization_id, workspace_id)
       VALUES ($1, $2, $3, $4)`,
      [
        externalTenant.rows[0]!.id,
        `workspace-${unique}`,
        organization.rows[0]!.id,
        workspace.rows[0]!.id,
      ],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('rejects an invalid signature before accepting the request', async () => {
    const rawBody = JSON.stringify({
      externalTenantRef: `tenant-${unique}`,
      externalWorkspaceRef: `workspace-${unique}`,
      operation: 'n8n.execute',
      idempotencyKey,
      payload: { value: 1 },
    });
    const response = await request(app)
      .post('/api/v1/integrations/events')
      .set({
        ...signedHeaders(rawBody, `invalid-${unique}-0001`),
        'x-casioplus-signature': '0'.repeat(64),
      })
      .send(rawBody);
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('integration_signature_invalid');
  });

  it('accepts a signed request and writes exactly one outbox item', async () => {
    const rawBody = JSON.stringify({
      externalTenantRef: `tenant-${unique}`,
      externalWorkspaceRef: `workspace-${unique}`,
      operation: 'n8n.execute',
      idempotencyKey,
      payload: { value: 1 },
    });
    const response = await request(app)
      .post('/api/v1/integrations/events')
      .set(signedHeaders(rawBody, `valid-${unique}-0001`))
      .send(rawBody);
    expect(response.status).toBe(202);
    expect(response.body.idempotent).toBe(false);

    const duplicate = await request(app)
      .post('/api/v1/integrations/events')
      .set(signedHeaders(rawBody, `valid-${unique}-0002`))
      .send(rawBody);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.idempotent).toBe(true);
  });

  it('blocks nonce replay and idempotency payload conflicts', async () => {
    const rawBody = JSON.stringify({
      externalTenantRef: `tenant-${unique}`,
      externalWorkspaceRef: `workspace-${unique}`,
      operation: 'n8n.execute',
      idempotencyKey: `${idempotencyKey}-replay`,
      payload: { value: 2 },
    });
    const nonce = `replay-${unique}-0001`;
    const accepted = await request(app)
      .post('/api/v1/integrations/events')
      .set(signedHeaders(rawBody, nonce))
      .send(rawBody);
    expect(accepted.status).toBe(202);

    const replay = await request(app)
      .post('/api/v1/integrations/events')
      .set(signedHeaders(rawBody, nonce))
      .send(rawBody);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('integration_nonce_replayed');

    const conflictingBody = JSON.stringify({
      externalTenantRef: `tenant-${unique}`,
      externalWorkspaceRef: `workspace-${unique}`,
      operation: 'n8n.execute',
      idempotencyKey,
      payload: { value: 999 },
    });
    const conflict = await request(app)
      .post('/api/v1/integrations/events')
      .set(signedHeaders(conflictingBody, `valid-${unique}-0003`))
      .send(conflictingBody);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_payload_conflict');
  });

  it('requires dispatcher authentication and supports claim/result lifecycle', async () => {
    const denied = await request(app).post('/internal/v1/outbox/claim').send({});
    expect(denied.status).toBe(401);

    const claimed = await request(app)
      .post('/internal/v1/outbox/claim')
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({});
    expect(claimed.status).toBe(200);
    expect(claimed.body.destination).toBe('n8n');
    outboxId = claimed.body.id;

    const completed = await request(app)
      .post(`/internal/v1/outbox/${outboxId}/result`)
      .set('x-casioplus-dispatcher-secret', dispatcherSecret)
      .send({ status: 'dispatched' });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('dispatched');
  });
});
