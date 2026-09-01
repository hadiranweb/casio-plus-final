import { once } from 'node:events';
import { createServer } from 'node:http';
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

async function withServer(
  executor: OpenClawExecutor,
  callback: (url: string) => Promise<void>,
  githubAppAdapterUrl?: string,
) {
  const server = createOpenClawAdapterServer(
    {
      port: 8084,
      adapterSecret,
      executable: 'openclaw',
      executorTargets: {
        'operations.primary': { channel: 'slack', target: 'channel:C123', account: 'ops' },
      },
      githubAppAdapterUrl,
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

  it('proxies only the approved repository action to the internal GitHub App adapter', async () => {
    const executor = vi.fn<OpenClawExecutor>();
    const forwarded: Array<{ headers: Headers; body: unknown }> = [];
    const githubAdapter = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      forwarded.push({
        headers: new Headers(request.headers as Record<string, string>),
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'succeeded',
          executionId: 'pull-request:11',
          output: {
            changeSetId: '11111111-1111-4111-8111-111111111111',
            repositoryFullName: 'hadiranweb/casio-plus-final',
            branchRef: 'casioplus/translation/11111111-1111-4111-8111-111111111111',
            pullRequestNumber: 11,
            pullRequestUrl: 'https://github.com/hadiranweb/casio-plus-final/pull/11',
            pullRequestHeadSha: 'b'.repeat(40),
          },
          runtime: 'openclaw',
          latencyMs: 3,
        }),
      );
    });
    githubAdapter.listen(0, '127.0.0.1');
    await once(githubAdapter, 'listening');
    const address = githubAdapter.address();
    if (!address || typeof address === 'string') throw new Error('server_address_missing');
    const githubUrl = `http://127.0.0.1:${address.port}`;
    const idempotencyKey = 'translation-sync:11111111-1111-4111-8111-111111111111';
    try {
      await withServer(
        executor,
        async (url) => {
          const response = await fetch(`${url}/dispatch`, {
            method: 'POST',
            headers: headers({
              'x-casioplus-operation': 'action.repository.open_translation_pr',
              'x-casioplus-idempotency-key': idempotencyKey,
            }),
            body: JSON.stringify({
              operation: 'action.repository.open_translation_pr',
              payload: {
                action: 'repository.open_translation_pr',
                executorRef: 'github-app.casio-plus-final',
                changeSetId: '11111111-1111-4111-8111-111111111111',
                approvalId: '22222222-2222-4222-8222-222222222222',
                processRunId: '33333333-3333-4333-8333-333333333333',
                repositoryFullName: 'hadiranweb/casio-plus-final',
                baseRef: 'main',
                baseCommitSha: 'a'.repeat(40),
                catalogHash: 'c'.repeat(64),
                sourceLocale: 'en',
                targetLocale: 'fa',
                branchRef: 'casioplus/translation/11111111-1111-4111-8111-111111111111',
                catalogPath: 'packages/i18n/messages/fa.json',
                sourceCatalogPath: 'packages/i18n/messages/en.json',
                items: [
                  {
                    messageKey: 'shared_greeting',
                    sourceText: 'Hello {name}',
                    currentTargetText: 'سلام {name}',
                    reviewedText: 'درود {name}',
                    sourceHash: 'd'.repeat(64),
                    currentTargetHash: 'e'.repeat(64),
                    placeholderSignature: ['name'],
                  },
                ],
                idempotencyKey,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
            }),
          });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ status: 'succeeded' });
        },
        githubUrl,
      );
    } finally {
      githubAdapter.close();
      await once(githubAdapter, 'close');
    }
    expect(executor).not.toHaveBeenCalled();
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]!.headers.get('x-casioplus-operation')).toBe(
      'action.repository.open_translation_pr',
    );
    expect(forwarded[0]!.body).toMatchObject({
      operation: 'action.repository.open_translation_pr',
    });
  });
});
