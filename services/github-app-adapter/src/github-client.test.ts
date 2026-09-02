import { createHash, generateKeyPairSync } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitHubAppError,
  openTranslationPullRequest,
  readTranslationCatalogSnapshot,
} from './github-client.js';

const baseCommitSha = 'a'.repeat(40);
const pullRequestHeadSha = 'b'.repeat(40);
const sourceRaw = `${JSON.stringify({ shared_greeting: 'Hello {name}' }, null, 2)}\n`;
const targetRaw = `${JSON.stringify({ shared_greeting: 'سلام {name}' }, null, 2)}\n`;
const nextTargetRaw = `${JSON.stringify({ shared_greeting: 'درود {name}' }, null, 2)}\n`;
const sourceHash = createHash('sha256').update('Hello {name}', 'utf8').digest('hex');
const targetHash = createHash('sha256').update('سلام {name}', 'utf8').digest('hex');
const catalogHash = createHash('sha256').update(targetRaw, 'utf8').digest('hex');

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

function payload() {
  const changeSetId = '11111111-1111-4111-8111-111111111111';
  return {
    action: 'repository.open_translation_pr' as const,
    executorRef: 'github-app.casio-plus-final' as const,
    changeSetId,
    approvalId: '22222222-2222-4222-8222-222222222222',
    processRunId: '33333333-3333-4333-8333-333333333333',
    repositoryFullName: 'hadiranweb/casio-plus-final' as const,
    baseRef: 'main' as const,
    baseCommitSha,
    catalogHash,
    sourceLocale: 'en' as const,
    targetLocale: 'fa' as const,
    branchRef: `casioplus/translation/${changeSetId}`,
    catalogPath: 'packages/i18n/messages/fa.json' as const,
    sourceCatalogPath: 'packages/i18n/messages/en.json' as const,
    items: [
      {
        messageKey: 'shared_greeting',
        sourceText: 'Hello {name}',
        currentTargetText: 'سلام {name}',
        reviewedText: 'درود {name}',
        sourceHash,
        currentTargetHash: targetHash,
        placeholderSignature: ['name'],
      },
    ],
    idempotencyKey: `translation-sync:${changeSetId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
): Promise<{ baseUrl: string; requests: Array<{ method: string; url: string; body: unknown }> }> {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      body: raw ? (JSON.parse(raw) as unknown) : null,
    });
    await handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server_address_missing');
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function configuration(apiBaseUrl: string) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    apiBaseUrl,
    appId: '12345',
    installationId: '67890',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    requestTimeoutMs: 5_000,
  };
}

function respond(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

describe('GitHub App translation client', () => {
  it('reads a fixed English/Persian catalog snapshot with read-only contents permission', async () => {
    const { baseUrl, requests } = await listen((request, response) => {
      const url = request.url ?? '';
      if (url.includes('/access_tokens')) {
        respond(response, 201, {
          token: 'read-installation-token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { metadata: 'read', contents: 'read' },
          repositories: [{ full_name: 'hadiranweb/casio-plus-final', private: true }],
        });
      } else if (url === '/repos/hadiranweb/casio-plus-final/git/ref/heads/main') {
        respond(response, 200, { object: { sha: baseCommitSha } });
      } else if (url.includes('/contents/packages/i18n/messages/en.json')) {
        respond(response, 200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(sourceRaw).toString('base64'),
          sha: 'c'.repeat(40),
        });
      } else if (url.includes('/contents/packages/i18n/messages/fa.json')) {
        respond(response, 200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(targetRaw).toString('base64'),
          sha: 'd'.repeat(40),
        });
      } else {
        respond(response, 404, { error: 'unexpected_test_route', url });
      }
    });
    const snapshot = await readTranslationCatalogSnapshot(configuration(baseUrl));
    expect(snapshot).toMatchObject({
      repositoryFullName: 'hadiranweb/casio-plus-final',
      baseRef: 'main',
      baseCommitSha,
      catalogHash,
      sourceLocale: 'en',
      targetLocale: 'fa',
      sourceCatalog: { shared_greeting: 'Hello {name}' },
      targetCatalog: { shared_greeting: 'سلام {name}' },
    });
    const tokenRequest = requests.find((entry) => entry.url.includes('/access_tokens'))!;
    expect(tokenRequest.body).toEqual({
      repositories: ['casio-plus-final'],
      permissions: { metadata: 'read', contents: 'read' },
    });
    expect(
      requests.some((entry) => entry.method !== 'GET' && !entry.url.includes('/access_tokens')),
    ).toBe(false);
  });

  it('creates only the allowlisted catalog commit and pull request with narrowed permissions', async () => {
    const input = payload();
    const { baseUrl, requests } = await listen((request, response) => {
      const url = request.url ?? '';
      if (url.includes('/access_tokens')) {
        respond(response, 201, {
          token: 'installation-token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
          repositories: [{ full_name: 'hadiranweb/casio-plus-final', private: true }],
        });
      } else if (url === '/repos/hadiranweb/casio-plus-final/git/ref/heads/main') {
        respond(response, 200, { object: { sha: baseCommitSha } });
      } else if (url.startsWith('/repos/hadiranweb/casio-plus-final/pulls?')) {
        respond(response, 200, []);
      } else if (url.includes('/contents/packages/i18n/messages/en.json')) {
        respond(response, 200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(sourceRaw).toString('base64'),
          sha: 'c'.repeat(40),
        });
      } else if (
        url.includes('/contents/packages/i18n/messages/fa.json') &&
        request.method === 'GET'
      ) {
        respond(response, 200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(targetRaw).toString('base64'),
          sha: 'd'.repeat(40),
        });
      } else if (url.endsWith('/git/refs')) {
        respond(response, 201, { ref: `refs/heads/${input.branchRef}` });
      } else if (url.endsWith('/contents/packages/i18n/messages/fa.json')) {
        respond(response, 200, { commit: { sha: pullRequestHeadSha } });
      } else if (url.endsWith('/pulls')) {
        respond(response, 201, {
          number: 7,
          state: 'open',
          merged_at: null,
          html_url: 'https://github.com/hadiranweb/casio-plus-final/pull/7',
          head: { sha: pullRequestHeadSha, ref: input.branchRef },
          base: { ref: 'main' },
        });
      } else {
        respond(response, 404, { error: 'unexpected_test_route', url });
      }
    });

    const result = await openTranslationPullRequest(configuration(baseUrl), input);
    expect(result).toEqual({
      changeSetId: input.changeSetId,
      repositoryFullName: 'hadiranweb/casio-plus-final',
      branchRef: input.branchRef,
      pullRequestNumber: 7,
      pullRequestUrl: 'https://github.com/hadiranweb/casio-plus-final/pull/7',
      pullRequestHeadSha,
    });
    const tokenRequest = requests.find((entry) => entry.url.includes('/access_tokens'))!;
    expect(tokenRequest.body).toEqual({
      repositories: ['casio-plus-final'],
      permissions: { metadata: 'read', contents: 'write', pull_requests: 'write' },
    });
    const updateRequest = requests.find(
      (entry) => entry.method === 'PUT' && entry.url.endsWith('/messages/fa.json'),
    )!;
    expect(
      Buffer.from((updateRequest.body as { content: string }).content, 'base64').toString(),
    ).toBe(nextTargetRaw);
    expect(requests.some((entry) => entry.url.includes('/merge'))).toBe(false);
  });

  it('fails closed before catalog mutation when the main branch moved', async () => {
    const { baseUrl, requests } = await listen((request, response) => {
      const url = request.url ?? '';
      if (url.includes('/access_tokens')) {
        respond(response, 201, {
          token: 'installation-token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { contents: 'write', pull_requests: 'write' },
          repositories: [{ full_name: 'hadiranweb/casio-plus-final', private: true }],
        });
      } else if (url.endsWith('/git/ref/heads/main')) {
        respond(response, 200, { object: { sha: 'f'.repeat(40) } });
      } else {
        respond(response, 500, { error: 'must_not_be_called' });
      }
    });
    await expect(
      openTranslationPullRequest(configuration(baseUrl), payload()),
    ).rejects.toMatchObject({
      code: 'github_translation_base_stale',
      retryable: false,
    } satisfies Partial<GitHubAppError>);
    expect(requests.some((entry) => entry.method === 'PUT' || entry.url.endsWith('/pulls'))).toBe(
      false,
    );
  });

  it('returns the existing scoped pull request idempotently without another commit', async () => {
    const input = payload();
    const { baseUrl, requests } = await listen((request, response) => {
      const url = request.url ?? '';
      if (url.includes('/access_tokens')) {
        respond(response, 201, {
          token: 'installation-token',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { contents: 'write', pull_requests: 'write' },
          repositories: [{ full_name: 'hadiranweb/casio-plus-final', private: true }],
        });
      } else if (url.endsWith('/git/ref/heads/main')) {
        respond(response, 200, { object: { sha: baseCommitSha } });
      } else if (url.startsWith('/repos/hadiranweb/casio-plus-final/pulls?')) {
        respond(response, 200, [
          {
            number: 7,
            state: 'open',
            merged_at: null,
            html_url: 'https://github.com/hadiranweb/casio-plus-final/pull/7',
            head: { sha: pullRequestHeadSha, ref: input.branchRef },
            base: { ref: 'main' },
          },
        ]);
      } else {
        respond(response, 500, { error: 'must_not_be_called' });
      }
    });
    const result = await openTranslationPullRequest(configuration(baseUrl), input);
    expect(result.pullRequestNumber).toBe(7);
    expect(requests.some((entry) => entry.method === 'PUT')).toBe(false);
  });
});
