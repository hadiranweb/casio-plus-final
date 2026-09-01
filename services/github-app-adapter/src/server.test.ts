import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitHubAppAdapterServer } from './server.js';

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server_address_missing');
  return `http://127.0.0.1:${address.port}`;
}

const adapterSecret = 'adapter-secret-with-at-least-thirty-two-characters';
const webhookSecret = 'github-webhook-secret-with-at-least-thirty-two';
const integrationSecret = 'integration-secret-with-at-least-thirty-two';
const deliveryId = '44444444-4444-4444-8444-444444444444';
const changeSetId = '11111111-1111-4111-8111-111111111111';

function pullRequestPayload() {
  return {
    action: 'closed',
    repository: { full_name: 'hadiranweb/casio-plus-final' },
    pull_request: {
      number: 9,
      html_url: 'https://github.com/hadiranweb/casio-plus-final/pull/9',
      merged: true,
      head: { ref: `casioplus/translation/${changeSetId}`, sha: 'b'.repeat(40) },
      base: { ref: 'main' },
    },
  };
}

function configuration(coreApiUrl: string) {
  return {
    port: 8085,
    adapterSecret,
    githubApiBaseUrl: 'https://api.github.test',
    githubAppId: '12345',
    githubInstallationId: '67890',
    githubPrivateKey: 'x'.repeat(128),
    githubWebhookSecret: webhookSecret,
    coreApiUrl,
    integrationExternalAppKey: 'github-app',
    integrationExternalTenantRef: 'hadiranweb',
    integrationExternalWorkspaceRef: 'casio-plus-final',
    integrationKeyId: 'github-key-v1',
    integrationSigningSecret: integrationSecret,
    requestTimeoutMs: 5_000,
    maxBodyBytes: 500_000,
  };
}

describe('GitHub App adapter server', () => {
  it('verifies GitHub raw-body HMAC and forwards a separately signed canonical event to Core', async () => {
    const forwarded: Array<{ headers: Record<string, string | undefined>; raw: Buffer }> = [];
    const core = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      forwarded.push({
        headers: {
          app: request.headers['x-casioplus-external-app'] as string | undefined,
          keyId: request.headers['x-casioplus-key-id'] as string | undefined,
          nonce: request.headers['x-casioplus-nonce'] as string | undefined,
          timestamp: request.headers['x-casioplus-timestamp'] as string | undefined,
          signature: request.headers['x-casioplus-signature'] as string | undefined,
        },
        raw,
      });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'completed' }));
    });
    const coreUrl = await listen(core);
    const adapterUrl = await listen(createGitHubAppAdapterServer(configuration(coreUrl)));
    const raw = Buffer.from(JSON.stringify(pullRequestPayload()), 'utf8');
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(raw).digest('hex')}`;
    const response = await fetch(`${adapterUrl}/webhooks/github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': signature,
      },
      body: raw,
    });
    expect(response.status).toBe(202);
    expect(forwarded).toHaveLength(1);
    const entry = forwarded[0]!;
    expect(entry.headers.app).toBe('github-app');
    expect(entry.headers.keyId).toBe('github-key-v1');
    expect(entry.headers.nonce).toBe(deliveryId);
    const expected = createHmac('sha256', integrationSecret)
      .update(`${entry.headers.timestamp}.${deliveryId}.`, 'utf8')
      .update(entry.raw)
      .digest('hex');
    expect(entry.headers.signature).toBe(expected);
    const body = JSON.parse(entry.raw.toString('utf8')) as {
      operation: string;
      idempotencyKey: string;
      payload: {
        action: string;
        changeSetId: string;
        pullRequestNumber: number;
        merged: boolean;
      };
    };
    expect(body.operation).toBe('repository.translation_pull_request_event');
    expect(body.idempotencyKey).toBe(`github-delivery:${deliveryId}`);
    expect(body.payload).toMatchObject({
      action: 'closed',
      changeSetId,
      pullRequestNumber: 9,
      merged: true,
    });
  });

  it('rejects an invalid webhook signature before parsing or forwarding', async () => {
    let forwarded = 0;
    const core = createServer((_request, response) => {
      forwarded += 1;
      response.writeHead(200).end();
    });
    const coreUrl = await listen(core);
    const adapterUrl = await listen(createGitHubAppAdapterServer(configuration(coreUrl)));
    const response = await fetch(`${adapterUrl}/webhooks/github`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      body: '{not-json',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'github_webhook_signature_invalid' });
    expect(forwarded).toBe(0);
  });

  it('requires the internal adapter secret before any GitHub dispatch', async () => {
    const core = createServer((_request, response) => response.writeHead(500).end());
    const coreUrl = await listen(core);
    const adapterUrl = await listen(createGitHubAppAdapterServer(configuration(coreUrl)));
    const response = await fetch(`${adapterUrl}/dispatch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-casioplus-adapter-secret': 'wrong-secret',
        'x-casioplus-organization-id': '55555555-5555-4555-8555-555555555555',
        'x-casioplus-workspace-id': '66666666-6666-4666-8666-666666666666',
        'x-casioplus-operation': 'action.repository.open_translation_pr',
        'x-casioplus-idempotency-key': `translation-sync:${changeSetId}`,
      },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'github_app_adapter_unauthorized' });
  });
});
