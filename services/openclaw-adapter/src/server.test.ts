import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createOpenClawAdapterServer, type OpenClawExecutor } from './server.js';

const adapterSecret = 'openclaw-adapter-secret-at-least-32-characters';
const context = {
  organizationId: '00000000-0000-4000-8000-000000000201',
  workspaceId: '00000000-0000-4000-8000-000000000202',
  operation: 'action.send_message',
  idempotencyKey: 'openclaw-run-00000001',
};

function dispatchBody(overrides: Record<string, unknown> = {}) {
  return {
    operation: context.operation,
    payload: {
      processRunId: '00000000-0000-4000-8000-000000000203',
      action: 'send_message',
      executorRef: 'operations.primary',
      message: 'Deployment is complete.',
      approvalId: '00000000-0000-4000-8000-000000000204',
      idempotencyKey: context.idempotencyKey,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    },
  };
}

function headers(overrides: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    'x-casioplus-adapter-secret': adapterSecret,
    'x-casioplus-organization-id': context.organizationId,
    'x-casioplus-workspace-id': context.workspaceId,
    'x-casioplus-operation': context.operation,
    'x-casioplus-idempotency-key': context.idempotencyKey,
    ...overrides,
  };
}

async function withServer(executor: OpenClawExecutor, callback: (url: string) => Promise<void>) {
  const server = createOpenClawAdapterServer(
    {
      port: 8084,
      adapterSecret,
      executable: 'openclaw',
      executorTargets: {
        'operations.primary': { channel: 'slack', target: 'channel:C123', account: 'ops' },
      },
      timeoutMs: 5_000,
      maxBodyBytes: 100_000,
    },
    executor,
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server_address_missing');
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

describe('OpenClaw adapter HTTP boundary', () => {
  it('returns health without configuration details', async () => {
    await withServer(vi.fn(), async (url) => {
      const response = await fetch(`${url}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', service: 'openclaw-adapter' });
    });
  });

  it('rejects unauthenticated requests before execution', async () => {
    const executor = vi.fn<OpenClawExecutor>();
    await withServer(executor, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers({ 'x-casioplus-adapter-secret': 'invalid' }),
        body: JSON.stringify(dispatchBody()),
      });
      expect(response.status).toBe(401);
      expect(executor).not.toHaveBeenCalled();
    });
  });

  it('executes only a server-resolved target after valid approval', async () => {
    const executor = vi.fn<OpenClawExecutor>().mockResolvedValue({
      channel: 'slack',
      messageId: 'message-42',
    });
    await withServer(executor, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(dispatchBody()),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'succeeded',
        executionId: 'message-42',
        output: { channel: 'slack', messageId: 'message-42' },
      });
      expect(executor).toHaveBeenCalledWith(
        { channel: 'slack', target: 'channel:C123', account: 'ops' },
        'Deployment is complete.',
        context.idempotencyKey,
      );
    });
  });

  it('fails closed for expired approvals and unknown executor references', async () => {
    const executor = vi.fn<OpenClawExecutor>();
    await withServer(executor, async (url) => {
      const expired = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(
          dispatchBody({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
        ),
      });
      expect(expired.status).toBe(409);
      const unknown = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(dispatchBody({ executorRef: 'unknown.target' })),
      });
      expect(unknown.status).toBe(403);
      expect(executor).not.toHaveBeenCalled();
    });
  });

  it('rejects idempotency mismatches between trusted header and approved payload', async () => {
    const executor = vi.fn<OpenClawExecutor>();
    await withServer(executor, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(dispatchBody({ idempotencyKey: 'different-idempotency-key' })),
      });
      expect(response.status).toBe(409);
      expect(executor).not.toHaveBeenCalled();
    });
  });
});
