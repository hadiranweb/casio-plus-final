import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createApp } from './app.js';
import { authenticatedTenantContext, signSession } from './auth.js';

const sessionSecret = 'local-test-session-secret-with-at-least-32-chars';
const sessionClaims = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  actorId: '00000000-0000-4000-8000-000000000003',
  expiresAt: Date.now() + 60_000,
};
const contextHeaders = {
  'x-casioplus-organization-id': '00000000-0000-4000-8000-000000000001',
  'x-casioplus-workspace-id': '00000000-0000-4000-8000-000000000002',
  'x-casioplus-actor-id': '00000000-0000-4000-8000-000000000003',
};

function createTestPool() {
  const query = vi.fn(async (text: string) => {
    if (text.includes('INSERT INTO work_items')) {
      return {
        rows: [
          {
            id: '00000000-0000-4000-8000-000000000004',
            organizationId: '00000000-0000-4000-8000-000000000001',
            workspaceId: '00000000-0000-4000-8000-000000000002',
            title: 'Diagnose hiring process',
            intent: 'business-diagnosis',
            status: 'open',
            createdByActorId: '00000000-0000-4000-8000-000000000003',
          },
        ],
        rowCount: 1,
      };
    }
    if (text.includes('FROM work_items')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.trim() === 'SELECT 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  return { pool: { query } as unknown as Pool, query };
}

describe('Core/API application boundary', () => {
  it('reports database health', async () => {
    const { pool } = createTestPool();
    const response = await request(createApp(pool)).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'core-api',
      database: 'ready',
    });
  });

  it('accepts a valid signed session as the tenant context', async () => {
    const { pool } = createTestPool();
    const token = signSession(sessionClaims, sessionSecret);
    const response = await request(
      createApp(pool, {
        resolveTenantContext: authenticatedTenantContext(sessionSecret),
      }),
    )
      .get('/api/v1/work-items')
      .set('authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('rejects requests without a complete tenant context', async () => {
    const { pool } = createTestPool();
    const response = await request(createApp(pool))
      .get('/api/v1/work-items')
      .set('x-correlation-id', 'req-invalid-context');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: 'invalid_request',
      requestId: 'req-invalid-context',
    });
  });

  it('rejects an invalid signed session with 401', async () => {
    const { pool } = createTestPool();
    const response = await request(
      createApp(pool, {
        resolveTenantContext: authenticatedTenantContext(sessionSecret),
      }),
    )
      .get('/api/v1/work-items')
      .set('authorization', 'Bearer invalid.session');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('authentication_required');
  });

  it('scopes work-item reads to the supplied organization and workspace', async () => {
    const { pool, query } = createTestPool();
    const response = await request(createApp(pool))
      .get('/api/v1/work-items')
      .set(contextHeaders)
      .set('x-correlation-id', 'req-list');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [], requestId: 'req-list' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND workspace_id = $2'),
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    );
  });

  it('rejects an actor without active membership when enforcement is enabled', async () => {
    const { pool } = createTestPool();
    const response = await request(createApp(pool, { enforceMembership: true }))
      .get('/api/v1/work-items')
      .set(contextHeaders);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('membership_required');
  });

  it('validates and creates a work item through the typed boundary', async () => {
    const { pool, query } = createTestPool();
    const response = await request(createApp(pool))
      .post('/api/v1/work-items')
      .set(contextHeaders)
      .send({ title: 'Diagnose hiring process', intent: 'business-diagnosis' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: '00000000-0000-4000-8000-000000000004',
      organizationId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      createdByActorId: '00000000-0000-4000-8000-000000000003',
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO work_items'), [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      'Diagnose hiring process',
      'business-diagnosis',
      '00000000-0000-4000-8000-000000000003',
    ]);
  });

  it('returns a typed validation error for an invalid work item', async () => {
    const { pool } = createTestPool();
    const response = await request(createApp(pool))
      .post('/api/v1/work-items')
      .set(contextHeaders)
      .send({ title: '' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_request');
  });

  it('handles allowlisted CORS preflight and preserves correlation IDs', async () => {
    const { pool } = createTestPool();
    const response = await request(createApp(pool))
      .options('/api/v1/work-items')
      .set('origin', 'http://localhost:5173')
      .set('x-correlation-id', 'req-cors');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['x-correlation-id']).toBe('req-cors');
  });
});
