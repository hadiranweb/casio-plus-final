import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createN8nAdapterServer } from './server.js';

const adapterSecret = 'casioplus-n8n-adapter-shared-secret-2026';
const webhookToken = 'casioplus-n8n-webhook-token-secret-2026';
const organizationId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const idempotencyKey = 'process-run-idempotency-0001';

async function runningServer() {
  const server = createN8nAdapterServer({
    port: 8082,
    adapterSecret,
    webhookUrl: 'https://n8n.example.test/webhook/casioplus-runtime',
    webhookToken,
    timeoutMs: 5_000,
    maxBodyBytes: 20_000,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

function dispatchHeaders(overrides: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    'x-casioplus-adapter-secret': adapterSecret,
    'x-casioplus-idempotency-key': idempotencyKey,
    'x-casioplus-organization-id': organizationId,
    'x-casioplus-workspace-id': workspaceId,
    'x-casioplus-operation': 'n8n.flow.execute',
    ...overrides,
  };
}

describe('n8n adapter HTTP boundary', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('exposes only a non-sensitive health response', async () => {
    const { server, url } = await runningServer();
    try {
      const response = await fetch(`${url}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', service: 'n8n-adapter' });
    } finally {
      server.close();
    }
  });

  it('rejects unauthenticated dispatch before calling n8n', async () => {
    const webhookFetch = vi.fn();
    globalThis.fetch = webhookFetch as typeof fetch;
    const { server, url } = await runningServer();
    try {
      const response = await originalFetch(`${url}/dispatch`, {
        method: 'POST',
        headers: { ...dispatchHeaders(), 'x-casioplus-adapter-secret': 'wrong' },
        body: JSON.stringify({ operation: 'n8n.flow.execute', payload: {} }),
      });
      expect(response.status).toBe(401);
      expect(webhookFetch).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('forwards a validated envelope and returns a typed workflow result', async () => {
    const webhookFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'succeeded',
          executionId: 'n8n-execution-42',
          output: { decision: 'approved' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    globalThis.fetch = webhookFetch as typeof fetch;
    const { server, url } = await runningServer();
    try {
      const response = await originalFetch(`${url}/dispatch`, {
        method: 'POST',
        headers: dispatchHeaders(),
        body: JSON.stringify({
          operation: 'n8n.flow.execute',
          payload: { processRunId: '00000000-0000-4000-8000-000000000003' },
        }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'succeeded',
        executionId: 'n8n-execution-42',
        output: { decision: 'approved' },
      });
      const [, request] = webhookFetch.mock.calls[0] as [string, RequestInit];
      expect(request.headers).toMatchObject({
        authorization: `Bearer ${webhookToken}`,
        'x-casioplus-idempotency-key': idempotencyKey,
      });
      expect(JSON.parse(String(request.body))).toMatchObject({
        schemaVersion: 'casioplus.n8n.dispatch.v1',
        context: { organizationId, workspaceId },
        operation: 'n8n.flow.execute',
      });
    } finally {
      server.close();
    }
  });

  it('rejects header and body operation mismatch', async () => {
    const webhookFetch = vi.fn();
    globalThis.fetch = webhookFetch as typeof fetch;
    const { server, url } = await runningServer();
    try {
      const response = await originalFetch(`${url}/dispatch`, {
        method: 'POST',
        headers: dispatchHeaders(),
        body: JSON.stringify({ operation: 'n8n.flow.other', payload: {} }),
      });
      expect(response.status).toBe(400);
      expect(webhookFetch).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it('maps an invalid workflow response to a retryable gateway error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ) as typeof fetch;
    const { server, url } = await runningServer();
    try {
      const response = await originalFetch(`${url}/dispatch`, {
        method: 'POST',
        headers: dispatchHeaders(),
        body: JSON.stringify({ operation: 'n8n.flow.execute', payload: {} }),
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: 'n8n_webhook_invalid_response' });
    } finally {
      server.close();
    }
  });
});
