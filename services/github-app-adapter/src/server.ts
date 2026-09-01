import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  repositoryOpenTranslationPrPayloadSchema,
  translationRepositoryWebhookEventSchema,
} from '@casioplus/contracts';
import { z } from 'zod';
import {
  GitHubAppError,
  openTranslationPullRequest,
  type GitHubAppConfiguration,
} from './github-client.js';

const configurationSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8085),
  adapterSecret: z.string().min(32),
  githubApiBaseUrl: z.string().url().default('https://api.github.com'),
  githubAppId: z.string().regex(/^[0-9]+$/),
  githubInstallationId: z.string().regex(/^[0-9]+$/),
  githubPrivateKey: z.string().min(64),
  githubWebhookSecret: z.string().min(32),
  coreApiUrl: z.string().url(),
  integrationExternalAppKey: z.string().regex(/^[A-Za-z0-9._-]{3,100}$/),
  integrationExternalTenantRef: z.string().trim().min(1).max(300),
  integrationExternalWorkspaceRef: z.string().trim().min(1).max(300),
  integrationKeyId: z.string().regex(/^[A-Za-z0-9._-]{3,100}$/),
  integrationSigningSecret: z.string().min(32),
  requestTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000),
  maxBodyBytes: z.number().int().min(1_024).max(2_000_000).default(500_000),
});

const dispatchHeadersSchema = z.object({
  secret: z.string().min(1),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  operation: z.literal('action.repository.open_translation_pr'),
  idempotencyKey: z.string().min(16).max(200),
});
const dispatchBodySchema = z
  .object({
    operation: z.literal('action.repository.open_translation_pr'),
    payload: repositoryOpenTranslationPrPayloadSchema,
  })
  .strict();
const pullRequestWebhookSchema = z
  .object({
    action: z.enum(['opened', 'reopened', 'synchronize', 'closed']),
    repository: z.object({ full_name: z.literal('hadiranweb/casio-plus-final') }).passthrough(),
    pull_request: z
      .object({
        number: z.number().int().positive(),
        html_url: z.string().url(),
        merged: z.boolean(),
        head: z.object({ ref: z.string(), sha: z.string().regex(/^[a-f0-9]{40}$/) }).passthrough(),
        base: z.object({ ref: z.literal('main') }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type GitHubAppAdapterConfiguration = z.infer<typeof configurationSchema>;

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readRawBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing_header:${name}`);
  return value.trim();
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new Error('request_json_invalid');
  }
}

function safeError(error: unknown): { status: number; code: string; retryable: boolean } {
  if (error instanceof GitHubAppError) {
    return {
      status: error.retryable ? 502 : error.statusCode,
      code: error.code,
      retryable: error.retryable,
    };
  }
  if (error instanceof z.ZodError) {
    return { status: 400, code: 'github_app_dispatch_invalid', retryable: false };
  }
  if (error instanceof Error && error.message === 'request_body_too_large') {
    return { status: 413, code: error.message, retryable: false };
  }
  return { status: 400, code: 'github_app_adapter_failed', retryable: false };
}

function githubClientConfiguration(
  configuration: GitHubAppAdapterConfiguration,
): GitHubAppConfiguration {
  return {
    apiBaseUrl: configuration.githubApiBaseUrl,
    appId: configuration.githubAppId,
    installationId: configuration.githubInstallationId,
    privateKey: configuration.githubPrivateKey,
    requestTimeoutMs: configuration.requestTimeoutMs,
  };
}

async function forwardWebhookToCore(
  configuration: GitHubAppAdapterConfiguration,
  deliveryId: string,
  event: z.infer<typeof translationRepositoryWebhookEventSchema>,
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = Buffer.from(
    JSON.stringify({
      externalTenantRef: configuration.integrationExternalTenantRef,
      externalWorkspaceRef: configuration.integrationExternalWorkspaceRef,
      operation: 'repository.translation_pull_request_event',
      idempotencyKey: `github-delivery:${deliveryId}`,
      payload: event,
    }),
    'utf8',
  );
  const signature = createHmac('sha256', configuration.integrationSigningSecret)
    .update(`${timestamp}.${deliveryId}.`, 'utf8')
    .update(body)
    .digest('hex');
  let response: Response;
  try {
    response = await fetch(
      `${configuration.coreApiUrl.replace(/\/$/, '')}/api/v1/integrations/events`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-casioplus-external-app': configuration.integrationExternalAppKey,
          'x-casioplus-key-id': configuration.integrationKeyId,
          'x-casioplus-nonce': deliveryId,
          'x-casioplus-timestamp': timestamp,
          'x-casioplus-signature': signature,
        },
        body,
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      },
    );
  } catch {
    throw new GitHubAppError('github_webhook_core_unavailable', 502, true);
  }
  if (response.ok) return;
  const result = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (response.status === 409 && result.error === 'integration_nonce_replayed') return;
  throw new GitHubAppError(
    'github_webhook_core_forward_failed',
    response.status,
    response.status === 408 || response.status === 429 || response.status >= 500,
  );
}

export function createGitHubAppAdapterServer(rawConfiguration: GitHubAppAdapterConfiguration) {
  const configuration = configurationSchema.parse(rawConfiguration);
  return createServer(async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        respondJson(response, 200, { status: 'ok', service: 'github-app-adapter' });
        return;
      }
      if (request.method === 'POST' && request.url === '/dispatch') {
        const headers = dispatchHeadersSchema.parse({
          secret: requiredHeader(request, 'x-casioplus-adapter-secret'),
          organizationId: requiredHeader(request, 'x-casioplus-organization-id'),
          workspaceId: requiredHeader(request, 'x-casioplus-workspace-id'),
          operation: requiredHeader(request, 'x-casioplus-operation'),
          idempotencyKey: requiredHeader(request, 'x-casioplus-idempotency-key'),
        });
        if (!safeEqual(headers.secret, configuration.adapterSecret)) {
          respondJson(response, 401, { error: 'github_app_adapter_unauthorized' });
          return;
        }
        const body = dispatchBodySchema.parse(
          parseJson(await readRawBody(request, configuration.maxBodyBytes)),
        );
        if (
          body.operation !== headers.operation ||
          body.payload.idempotencyKey !== headers.idempotencyKey
        ) {
          respondJson(response, 409, { error: 'github_app_dispatch_context_mismatch' });
          return;
        }
        const result = await openTranslationPullRequest(
          githubClientConfiguration(configuration),
          body.payload,
        );
        respondJson(response, 200, {
          status: 'succeeded',
          executionId: `pull-request:${result.pullRequestNumber}`,
          output: result,
          runtime: 'openclaw',
          latencyMs: Date.now() - startedAt,
        });
        return;
      }
      if (request.method === 'POST' && request.url === '/webhooks/github') {
        const eventName = requiredHeader(request, 'x-github-event');
        const deliveryId = requiredHeader(request, 'x-github-delivery');
        const signature = requiredHeader(request, 'x-hub-signature-256');
        const rawBody = await readRawBody(request, configuration.maxBodyBytes);
        const expected = `sha256=${createHmac('sha256', configuration.githubWebhookSecret)
          .update(rawBody)
          .digest('hex')}`;
        if (!safeEqual(signature, expected)) {
          respondJson(response, 401, { error: 'github_webhook_signature_invalid' });
          return;
        }
        if (eventName !== 'pull_request') {
          respondJson(response, 202, { status: 'ignored', event: eventName });
          return;
        }
        const payload = pullRequestWebhookSchema.parse(parseJson(rawBody));
        const branchPrefix = 'casioplus/translation/';
        if (!payload.pull_request.head.ref.startsWith(branchPrefix)) {
          respondJson(response, 202, { status: 'ignored', reason: 'branch_not_allowlisted' });
          return;
        }
        const changeSetId = payload.pull_request.head.ref.slice(branchPrefix.length);
        const event = translationRepositoryWebhookEventSchema.parse({
          action: payload.action,
          changeSetId,
          repositoryFullName: payload.repository.full_name,
          baseRef: payload.pull_request.base.ref,
          branchRef: payload.pull_request.head.ref,
          pullRequestNumber: payload.pull_request.number,
          pullRequestUrl: payload.pull_request.html_url,
          pullRequestHeadSha: payload.pull_request.head.sha,
          merged: payload.pull_request.merged,
        });
        await forwardWebhookToCore(configuration, deliveryId, event);
        respondJson(response, 202, { status: 'accepted', deliveryId });
        return;
      }
      respondJson(response, 404, { error: 'not_found' });
    } catch (caught) {
      const failure = safeError(caught);
      respondJson(response, failure.status, {
        error: failure.code,
        retryable: failure.retryable,
      });
    } finally {
      console.info(
        JSON.stringify({
          level: 'info',
          service: 'github-app-adapter',
          event: 'http.request',
          method: request.method,
          path: request.url,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        }),
      );
    }
  });
}

if (process.env.NODE_ENV !== 'test') {
  const privateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
  const configuration = configurationSchema.parse({
    port: Number(process.env.PORT ?? 8085),
    adapterSecret: process.env.ADAPTER_SHARED_SECRET,
    githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? 'https://api.github.com',
    githubAppId: process.env.GITHUB_APP_ID,
    githubInstallationId: process.env.GITHUB_APP_INSTALLATION_ID,
    githubPrivateKey: privateKeyBase64
      ? Buffer.from(privateKeyBase64, 'base64').toString('utf8')
      : undefined,
    githubWebhookSecret: process.env.GITHUB_APP_WEBHOOK_SECRET,
    coreApiUrl: process.env.CORE_API_URL,
    integrationExternalAppKey: process.env.GITHUB_INTEGRATION_EXTERNAL_APP_KEY,
    integrationExternalTenantRef: process.env.GITHUB_INTEGRATION_EXTERNAL_TENANT_REF,
    integrationExternalWorkspaceRef: process.env.GITHUB_INTEGRATION_EXTERNAL_WORKSPACE_REF,
    integrationKeyId: process.env.GITHUB_INTEGRATION_KEY_ID,
    integrationSigningSecret: process.env.GITHUB_INTEGRATION_SIGNING_SECRET,
    requestTimeoutMs: Number(process.env.GITHUB_APP_REQUEST_TIMEOUT_MS ?? 30_000),
    maxBodyBytes: Number(process.env.GITHUB_APP_ADAPTER_MAX_BODY_BYTES ?? 500_000),
  });
  createGitHubAppAdapterServer(configuration).listen(configuration.port, '0.0.0.0', () => {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'github-app-adapter',
        event: 'service.started',
        port: configuration.port,
      }),
    );
  });
}
