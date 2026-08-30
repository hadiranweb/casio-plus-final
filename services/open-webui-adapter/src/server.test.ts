import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenWebUiAdapterServer } from './server.js';

const adapterSecret = 'open-webui-adapter-secret-at-least-32-characters';
const context = {
  organizationId: '00000000-0000-4000-8000-000000000101',
  workspaceId: '00000000-0000-4000-8000-000000000102',
  operation: 'model.chat.complete',
  idempotencyKey: 'open-webui-run-00000001',
};

function dispatchBody() {
  return {
    operation: context.operation,
    payload: {
      processRunId: '00000000-0000-4000-8000-000000000103',
      workItemId: '00000000-0000-4000-8000-000000000104',
      flowId: '00000000-0000-4000-8000-000000000105',
      flowVersionId: '00000000-0000-4000-8000-000000000106',
      actorId: '00000000-0000-4000-8000-000000000107',
      input: { prompt: 'Summarize this governed record.' },
      definition: { model: 'model-a', temperature: 0.1, maxTokens: 256 },
    },
  };
}

async function withServer(
  fetchImplementation: typeof fetch,
  callback: (url: string) => Promise<void>,
) {
  const server = createOpenWebUiAdapterServer(
    {
      port: 8083,
      adapterSecret,
      baseUrl: 'http://open-webui.internal',
      apiKey: 'open-webui-service-account-key',
      timeoutMs: 5_000,
      maxBodyBytes: 100_000,
    },
    fetchImplementation,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Open WebUI adapter HTTP boundary', () => {
  it('returns health without revealing configuration or credentials', async () => {
    await withServer(vi.fn<typeof fetch>(), async (url) => {
      const response = await fetch(`${url}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', service: 'open-webui-adapter' });
    });
  });

  it('rejects unauthenticated dispatch before calling Open WebUI', async () => {
    const upstream = vi.fn<typeof fetch>();
    await withServer(upstream, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers({ 'x-casioplus-adapter-secret': 'invalid' }),
        body: JSON.stringify(dispatchBody()),
      });
      expect(response.status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
    });
  });

  it('forwards only model input and maps whole-reply usage', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'completion-42',
          model: 'model-a',
          choices: [{ message: { content: 'Governed summary' } }],
          usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await withServer(upstream, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(dispatchBody()),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'succeeded',
        executionId: 'completion-42',
        output: { content: 'Governed summary' },
        usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
      });
      const request = upstream.mock.calls[0]!;
      expect(request[0]).toBe('http://open-webui.internal/api/chat/completions');
      const options = request[1]!;
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: 'model-a', stream: false, max_tokens: 256 });
      expect(body).not.toHaveProperty('tools');
      expect(body).not.toHaveProperty('tool_ids');
      expect(body).not.toHaveProperty('chat_id');
    });
  });

  it('rejects an operation outside the model-plane contract', async () => {
    const upstream = vi.fn<typeof fetch>();
    await withServer(upstream, async (url) => {
      const response = await fetch(`${url}/dispatch`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ ...dispatchBody(), operation: 'action.send_message' }),
      });
      expect(response.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
    });
  });
});
