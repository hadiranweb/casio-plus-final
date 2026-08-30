import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

const configurationSchema = z.object({
  coreApiUrl: z.string().url(),
  dispatcherSecret: z.string().min(32),
  adapterSecret: z.string().min(32),
  n8nAdapterUrl: z.string().url().optional(),
  openWebuiAdapterUrl: z.string().url().optional(),
  openclawAdapterUrl: z.string().url().optional(),
  pollIntervalMs: z.number().int().min(100).max(60_000).default(1_000),
});

const adapterResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  executionId: z.string().trim().min(1).max(200).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  errorCode: z
    .string()
    .regex(/^[a-z][a-z0-9_.-]{1,127}$/)
    .optional(),
  runtime: z.enum(['n8n', 'open-webui', 'openclaw']).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

const outboxItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  destination: z.enum(['n8n', 'open-webui', 'openclaw']),
  operation: z.string(),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string(),
  attempts: z.number().int().positive(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
});

type OutboxItem = z.infer<typeof outboxItemSchema>;
type Configuration = z.infer<typeof configurationSchema>;

const configuration = configurationSchema.parse({
  coreApiUrl: process.env.CORE_API_URL,
  dispatcherSecret: process.env.DISPATCHER_SHARED_SECRET,
  adapterSecret: process.env.ADAPTER_SHARED_SECRET,
  n8nAdapterUrl: process.env.N8N_ADAPTER_URL,
  openWebuiAdapterUrl: process.env.OPEN_WEBUI_ADAPTER_URL,
  openclawAdapterUrl: process.env.OPENCLAW_ADAPTER_URL,
  pollIntervalMs: Number(process.env.DISPATCHER_POLL_INTERVAL_MS ?? 1_000),
});

let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
});
process.once('SIGINT', () => {
  stopping = true;
});

function targetUrl(item: OutboxItem, config: Configuration): string {
  const base = {
    n8n: config.n8nAdapterUrl,
    'open-webui': config.openWebuiAdapterUrl,
    openclaw: config.openclawAdapterUrl,
  }[item.destination];
  if (!base) throw new Error(`destination_not_configured:${item.destination}`);
  return `${base.replace(/\/$/, '')}/dispatch`;
}

async function claim(config: Configuration): Promise<OutboxItem | null> {
  const response = await fetch(`${config.coreApiUrl.replace(/\/$/, '')}/internal/v1/outbox/claim`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-casioplus-dispatcher-secret': config.dispatcherSecret,
    },
    body: '{}',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`claim_failed:${response.status}`);
  return outboxItemSchema.parse(await response.json());
}

async function acknowledge(
  config: Configuration,
  item: OutboxItem,
  result:
    | { status: 'dispatched'; adapterResult?: z.infer<typeof adapterResultSchema> }
    | { status: 'retry'; errorCode: string; retryAfterSeconds: number }
    | { status: 'dead_letter'; errorCode: string },
): Promise<void> {
  const response = await fetch(
    `${config.coreApiUrl.replace(/\/$/, '')}/internal/v1/outbox/${item.id}/result`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-casioplus-dispatcher-secret': config.dispatcherSecret,
      },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`acknowledgement_failed:${response.status}`);
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(900, 2 ** Math.min(attempts, 9));
}

async function dispatch(config: Configuration, item: OutboxItem): Promise<void> {
  try {
    const response = await fetch(targetUrl(item, config), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-casioplus-adapter-secret': config.adapterSecret,
        'x-casioplus-idempotency-key': item.idempotencyKey,
        'x-casioplus-organization-id': item.organizationId,
        'x-casioplus-workspace-id': item.workspaceId,
        'x-casioplus-operation': item.operation,
      },
      body: JSON.stringify({ operation: item.operation, payload: item.payload }),
      signal: AbortSignal.timeout(item.timeoutMs),
    });
    if (!response.ok) {
      const retryable =
        response.status === 408 || response.status === 429 || response.status >= 500;
      await acknowledge(
        config,
        item,
        retryable
          ? {
              status: 'retry',
              errorCode: `adapter_http_${response.status}`,
              retryAfterSeconds: retryDelaySeconds(item.attempts),
            }
          : { status: 'dead_letter', errorCode: `adapter_http_${response.status}` },
      );
      return;
    }
    let adapterResult: z.infer<typeof adapterResultSchema>;
    try {
      adapterResult = adapterResultSchema.parse(await response.json());
    } catch {
      await acknowledge(config, item, {
        status: item.attempts >= 8 ? 'dead_letter' : 'retry',
        errorCode: 'adapter_invalid_response',
        retryAfterSeconds: retryDelaySeconds(item.attempts),
      });
      return;
    }
    await acknowledge(config, item, { status: 'dispatched', adapterResult });
  } catch (error) {
    const errorCode =
      error instanceof Error && error.message.startsWith('destination_not_configured:')
        ? 'destination_not_configured'
        : 'adapter_unavailable';
    await acknowledge(
      config,
      item,
      item.attempts >= 8
        ? { status: 'dead_letter', errorCode }
        : {
            status: 'retry',
            errorCode,
            retryAfterSeconds: retryDelaySeconds(item.attempts),
          },
    );
  }
}

async function main(): Promise<void> {
  console.log(
    JSON.stringify({ level: 'info', service: 'integration-dispatcher', event: 'started' }),
  );
  while (!stopping) {
    try {
      const item = await claim(configuration);
      if (item) {
        await dispatch(configuration, item);
      } else {
        await sleep(configuration.pollIntervalMs);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          service: 'integration-dispatcher',
          event: 'loop_failed',
          errorCode: error instanceof Error ? error.message.split(':')[0] : 'unknown_error',
        }),
      );
      await sleep(Math.max(configuration.pollIntervalMs, 1_000));
    }
  }
}

void main();
