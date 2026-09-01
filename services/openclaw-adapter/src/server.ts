import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { repositoryOpenTranslationPrPayloadSchema } from '@casioplus/contracts';
import { z } from 'zod';
import {
  openClawActionRequestSchema,
  parseOpenClawExecutorTargets,
  type OpenClawExecutorTarget,
} from './index.js';
import { sendOpenClawGatewayMessage } from './gateway-client.js';

const configurationSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8084),
  adapterSecret: z.string().min(32),
  executable: z.string().trim().min(1).default('openclaw'),
  gatewayUrl: z.string().url().optional(),
  gatewayToken: z.string().min(32).optional(),
  executorTargets: z.record(z.string(), z.custom<OpenClawExecutorTarget>()),
  githubAppAdapterUrl: z.string().url().optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(60_000),
  maxBodyBytes: z.number().int().min(1_024).max(2_000_000).default(500_000),
});

const dispatchHeadersSchema = z.object({
  secret: z.string().min(1),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  operation: z.enum(['action.send_message', 'action.repository.open_translation_pr']),
  idempotencyKey: z.string().min(16).max(200),
});

const dispatchBodySchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('action.send_message'),
      payload: openClawActionRequestSchema.extend({
        processRunId: z.string().uuid(),
      }),
    })
    .strict(),
  z
    .object({
      operation: z.literal('action.repository.open_translation_pr'),
      payload: repositoryOpenTranslationPrPayloadSchema,
    })
    .strict(),
]);

export type OpenClawAdapterConfiguration = z.infer<typeof configurationSchema>;
export type OpenClawExecutor = (
  target: OpenClawExecutorTarget,
  message: string,
  idempotencyKey: string,
) => Promise<{ runId?: string; messageId?: string; channel: string }>;

function respondJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) throw new Error('request_body_too_large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing_header:${name}`);
  return value;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'openclaw_dispatch_invalid';
  if (error instanceof SyntaxError) return 'openclaw_json_invalid';
  if (error instanceof Error && error.message === 'request_body_too_large') return error.message;
  return 'openclaw_adapter_failed';
}

export function createOpenClawAdapterServer(
  inputConfiguration: OpenClawAdapterConfiguration,
  executorOverride?: OpenClawExecutor,
) {
  const configuration = configurationSchema.parse(inputConfiguration);
  const executor: OpenClawExecutor =
    executorOverride ??
    ((target, message, idempotencyKey) =>
      sendOpenClawGatewayMessage(
        {
          executable: configuration.executable,
          url: configuration.gatewayUrl,
          token: configuration.gatewayToken,
          timeoutMs: configuration.timeoutMs,
        },
        target,
        message,
        idempotencyKey,
      ));
  return createServer(async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        respondJson(response, 200, { status: 'ok', service: 'openclaw-adapter' });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/dispatch') {
        respondJson(response, 404, { error: 'not_found' });
        return;
      }
      const headers = dispatchHeadersSchema.parse({
        secret: requiredHeader(request, 'x-casioplus-adapter-secret'),
        organizationId: requiredHeader(request, 'x-casioplus-organization-id'),
        workspaceId: requiredHeader(request, 'x-casioplus-workspace-id'),
        operation: requiredHeader(request, 'x-casioplus-operation'),
        idempotencyKey: requiredHeader(request, 'x-casioplus-idempotency-key'),
      });
      if (headers.secret !== configuration.adapterSecret) {
        respondJson(response, 401, { error: 'openclaw_adapter_unauthorized' });
        return;
      }
      const body = dispatchBodySchema.parse(await readJson(request, configuration.maxBodyBytes));
      if (
        body.operation !== headers.operation ||
        body.payload.idempotencyKey !== headers.idempotencyKey
      ) {
        respondJson(response, 409, { error: 'openclaw_dispatch_context_mismatch' });
        return;
      }
      if (new Date(body.payload.expiresAt).getTime() <= Date.now()) {
        respondJson(response, 409, { error: 'openclaw_approval_expired', retryable: false });
        return;
      }
      if (body.operation === 'action.repository.open_translation_pr') {
        if (!configuration.githubAppAdapterUrl) {
          respondJson(response, 503, {
            error: 'github_app_adapter_not_configured',
            retryable: true,
          });
          return;
        }
        const upstream = await fetch(
          `${configuration.githubAppAdapterUrl.replace(/\/$/, '')}/dispatch`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-casioplus-adapter-secret': headers.secret,
              'x-casioplus-organization-id': headers.organizationId,
              'x-casioplus-workspace-id': headers.workspaceId,
              'x-casioplus-operation': headers.operation,
              'x-casioplus-idempotency-key': headers.idempotencyKey,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(configuration.timeoutMs),
          },
        );
        const upstreamText = await upstream.text();
        let upstreamBody: unknown;
        try {
          upstreamBody = upstreamText ? (JSON.parse(upstreamText) as unknown) : {};
        } catch {
          respondJson(response, 502, {
            error: 'github_app_adapter_response_invalid',
            retryable: true,
          });
          return;
        }
        respondJson(response, upstream.status, upstreamBody);
        return;
      }
      const target = configuration.executorTargets[body.payload.executorRef];
      if (!target) {
        respondJson(response, 403, { error: 'openclaw_target_not_allowlisted', retryable: false });
        return;
      }
      try {
        const result = await executor(target, body.payload.message, body.payload.idempotencyKey);
        respondJson(response, 200, {
          status: 'succeeded',
          executionId: result.messageId ?? result.runId,
          output: { channel: result.channel, messageId: result.messageId },
          runtime: 'openclaw',
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        respondJson(response, 502, {
          error: 'openclaw_execution_failed',
          retryable:
            typeof error === 'object' &&
            error !== null &&
            'retryable' in error &&
            typeof error.retryable === 'boolean'
              ? error.retryable
              : true,
        });
      }
    } catch (error) {
      respondJson(response, 400, { error: safeErrorCode(error) });
    } finally {
      console.info(
        JSON.stringify({
          level: 'info',
          service: 'openclaw-adapter',
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
  const configuration = configurationSchema.parse({
    port: Number(process.env.PORT ?? 8084),
    adapterSecret: process.env.ADAPTER_SHARED_SECRET,
    executable: process.env.OPENCLAW_EXECUTABLE ?? 'openclaw',
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    executorTargets: parseOpenClawExecutorTargets(
      process.env.OPENCLAW_EXECUTOR_TARGETS_JSON ?? '{}',
    ),
    githubAppAdapterUrl: process.env.GITHUB_APP_ADAPTER_URL,
    timeoutMs: Number(process.env.OPENCLAW_TIMEOUT_MS ?? 60_000),
    maxBodyBytes: Number(process.env.OPENCLAW_ADAPTER_MAX_BODY_BYTES ?? 500_000),
  });
  createOpenClawAdapterServer(configuration).listen(configuration.port, '0.0.0.0', () => {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'openclaw-adapter',
        event: 'service.started',
        port: configuration.port,
      }),
    );
  });
}
