import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const configurationSchema = z.object({
  port: z.number().int().min(1).max(65_535).default(8082),
  adapterSecret: z.string().min(32),
  webhookUrl: z.string().url(),
  webhookToken: z.string().min(32),
  timeoutMs: z.number().int().min(1_000).max(120_000).default(60_000),
  maxBodyBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
});

const dispatchBodySchema = z
  .object({
    operation: z.string().regex(/^n8n\.[a-z][a-z0-9_.-]{1,120}$/),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const dispatchHeadersSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(200),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  operation: z.string().regex(/^n8n\.[a-z][a-z0-9_.-]{1,120}$/),
});

const adapterResultSchema = z
  .object({
    status: z.enum(['succeeded', 'failed']),
    executionId: z.string().trim().min(1).max(200).optional(),
    output: z.record(z.string(), z.unknown()).optional(),
    errorCode: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{1,127}$/)
      .optional(),
  })
  .strict();

export type N8nAdapterConfiguration = z.infer<typeof configurationSchema>;

class AdapterError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maxBodyBytes) throw new AdapterError(413, 'request_body_too_large');
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AdapterError(400, 'invalid_json');
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

export function createN8nAdapterServer(configuration: N8nAdapterConfiguration) {
  const config = configurationSchema.parse(configuration);
  const webhook = new URL(config.webhookUrl);
  if (process.env.NODE_ENV === 'production' && webhook.protocol !== 'https:') {
    throw new Error('N8N_WEBHOOK_URL must use HTTPS in production');
  }

  return createServer(async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method === 'GET' && request.url === '/healthz') {
        sendJson(response, 200, { status: 'ok', service: 'n8n-adapter' });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/dispatch') {
        throw new AdapterError(404, 'route_not_found');
      }
      if (!safeEqual(header(request, 'x-casioplus-adapter-secret'), config.adapterSecret)) {
        throw new AdapterError(401, 'adapter_not_authorized');
      }
      const headers = dispatchHeadersSchema.parse({
        idempotencyKey: header(request, 'x-casioplus-idempotency-key'),
        organizationId: header(request, 'x-casioplus-organization-id'),
        workspaceId: header(request, 'x-casioplus-workspace-id'),
        operation: header(request, 'x-casioplus-operation'),
      });
      const body = dispatchBodySchema.parse(await readJson(request, config.maxBodyBytes));
      if (body.operation !== headers.operation) {
        throw new AdapterError(400, 'operation_header_mismatch');
      }

      let webhookResponse: Response;
      try {
        webhookResponse = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.webhookToken}`,
            'content-type': 'application/json',
            'x-casioplus-idempotency-key': headers.idempotencyKey,
          },
          body: JSON.stringify({
            schemaVersion: 'casioplus.n8n.dispatch.v1',
            context: {
              organizationId: headers.organizationId,
              workspaceId: headers.workspaceId,
            },
            operation: body.operation,
            payload: body.payload,
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch {
        throw new AdapterError(502, 'n8n_webhook_unavailable');
      }
      if (!webhookResponse.ok) {
        throw new AdapterError(
          webhookResponse.status === 429 ? 429 : 502,
          `n8n_webhook_http_${webhookResponse.status}`,
        );
      }
      let result: z.infer<typeof adapterResultSchema>;
      try {
        result = adapterResultSchema.parse(await webhookResponse.json());
      } catch {
        throw new AdapterError(502, 'n8n_webhook_invalid_response');
      }
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = error instanceof AdapterError ? error.statusCode : 400;
      const code = error instanceof AdapterError ? error.code : 'invalid_dispatch_request';
      sendJson(response, statusCode, { error: code });
    } finally {
      console.log(
        JSON.stringify({
          level: 'info',
          service: 'n8n-adapter',
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
    port: Number(process.env.PORT ?? 8082),
    adapterSecret: process.env.ADAPTER_SHARED_SECRET,
    webhookUrl: process.env.N8N_WEBHOOK_URL,
    webhookToken: process.env.N8N_WEBHOOK_TOKEN,
    timeoutMs: Number(process.env.N8N_WEBHOOK_TIMEOUT_MS ?? 60_000),
    maxBodyBytes: Number(process.env.N8N_ADAPTER_MAX_BODY_BYTES ?? 1_000_000),
  });
  createN8nAdapterServer(configuration).listen(configuration.port, () => {
    console.log(JSON.stringify({ level: 'info', service: 'n8n-adapter', event: 'started' }));
  });
}
