import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { openWebUiModelResponseSchema, openWebUiRuntimeRequestSchema } from './index.js';

const configurationSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8083),
  adapterSecret: z.string().min(32),
  baseUrl: z.string().url(),
  apiKey: z.string().min(16),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  maxBodyBytes: z.number().int().min(1_024).max(10_000_000).default(1_000_000),
});

const dispatchHeadersSchema = z.object({
  secret: z.string().min(1),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  operation: z.literal('model.chat.complete'),
  idempotencyKey: z.string().min(16).max(200),
});

const dispatchBodySchema = z
  .object({
    operation: z.literal('model.chat.complete'),
    payload: z.object({
      processRunId: z.string().uuid(),
      workItemId: z.string().uuid(),
      flowId: z.string().uuid(),
      flowVersionId: z.string().uuid(),
      actorId: z.string().uuid(),
      input: z.record(z.string(), z.unknown()),
      definition: z.record(z.string(), z.unknown()),
    }),
  })
  .strict();

export type OpenWebUiAdapterConfiguration = z.infer<typeof configurationSchema>;
type FetchLike = typeof fetch;

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
  if (error instanceof z.ZodError) return 'open_webui_dispatch_invalid';
  if (error instanceof SyntaxError) return 'open_webui_json_invalid';
  if (error instanceof Error && error.message === 'request_body_too_large') return error.message;
  return 'open_webui_adapter_failed';
}

export function createOpenWebUiAdapterServer(
  inputConfiguration: OpenWebUiAdapterConfiguration,
  fetchImplementation: FetchLike = fetch,
) {
  const configuration = configurationSchema.parse(inputConfiguration);
  return createServer(async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        respondJson(response, 200, { status: 'ok', service: 'open-webui-adapter' });
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
        respondJson(response, 401, { error: 'open_webui_adapter_unauthorized' });
        return;
      }
      const body = dispatchBodySchema.parse(await readJson(request, configuration.maxBodyBytes));
      if (body.operation !== headers.operation) {
        respondJson(response, 400, { error: 'open_webui_operation_header_mismatch' });
        return;
      }
      const modelRequest = openWebUiRuntimeRequestSchema.parse({
        input: body.payload.input,
        definition: body.payload.definition,
      });
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (modelRequest.systemPrompt) {
        messages.push({ role: 'system', content: modelRequest.systemPrompt });
      }
      messages.push({ role: 'user', content: modelRequest.prompt });
      const upstreamStartedAt = Date.now();
      let upstream: globalThis.Response;
      try {
        upstream = await fetchImplementation(
          `${configuration.baseUrl.replace(/\/$/, '')}/api/chat/completions`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${configuration.apiKey}`,
              'content-type': 'application/json',
              'x-casioplus-idempotency-key': headers.idempotencyKey,
            },
            body: JSON.stringify({
              model: modelRequest.model,
              messages,
              stream: false,
              ...(modelRequest.temperature === undefined
                ? {}
                : { temperature: modelRequest.temperature }),
              ...(modelRequest.maxTokens === undefined
                ? {}
                : { max_tokens: modelRequest.maxTokens }),
            }),
            signal: AbortSignal.timeout(configuration.timeoutMs),
          },
        );
      } catch {
        respondJson(response, 502, { error: 'open_webui_unavailable', retryable: true });
        return;
      }
      if (!upstream.ok) {
        respondJson(response, 502, {
          error: 'open_webui_request_failed',
          retryable: upstream.status >= 500 || upstream.status === 429,
          upstreamStatus: upstream.status,
        });
        return;
      }
      const parsed = openWebUiModelResponseSchema.safeParse(await upstream.json());
      if (!parsed.success) {
        respondJson(response, 502, { error: 'open_webui_response_invalid', retryable: true });
        return;
      }
      const usage = parsed.data.usage;
      const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
      respondJson(response, 200, {
        status: 'succeeded',
        executionId: parsed.data.id,
        output: { content: parsed.data.choices[0]!.message.content },
        runtime: 'open-webui',
        model: parsed.data.model ?? modelRequest.model,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
        },
        latencyMs: Date.now() - upstreamStartedAt,
      });
    } catch (error) {
      respondJson(response, 400, { error: safeErrorCode(error) });
    } finally {
      console.info(
        JSON.stringify({
          level: 'info',
          service: 'open-webui-adapter',
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
    port: Number(process.env.PORT ?? 8083),
    adapterSecret: process.env.ADAPTER_SHARED_SECRET,
    baseUrl: process.env.OPEN_WEBUI_BASE_URL,
    apiKey: process.env.OPEN_WEBUI_API_KEY,
    timeoutMs: Number(process.env.OPEN_WEBUI_TIMEOUT_MS ?? 120_000),
    maxBodyBytes: Number(process.env.OPEN_WEBUI_ADAPTER_MAX_BODY_BYTES ?? 1_000_000),
  });
  createOpenWebUiAdapterServer(configuration).listen(configuration.port, '0.0.0.0', () => {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'open-webui-adapter',
        event: 'service.started',
        port: configuration.port,
      }),
    );
  });
}
