import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  nativeDiagnosisJobSchema,
  nativeExecutionResultSchema,
} from '../../../packages/contracts/src/index.js';
import { diagnoseBusiness, type BusinessDiagnosisRequest } from './index.js';

const maxBodyBytes = 512 * 1024;

const structuredInputSchema = z.object({
  business: z
    .object({
      name: z.string().optional(),
      industry: z.string().optional(),
      size: z.string().optional(),
      stage: z.string().optional(),
    })
    .optional(),
  position: z
    .object({
      title: z.string(),
      responsibilities: z.array(z.string()),
      requiredCapabilities: z.array(z.string()).optional(),
      successCriteria: z.array(z.string()).optional(),
    })
    .optional(),
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        skills: z.array(z.string()).optional(),
        experience: z.array(z.string()).optional(),
        industry: z.string().optional(),
        workStyle: z.array(z.string()).optional(),
        motivation: z.array(z.string()).optional(),
        constraints: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  evidence: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        source: z.string().optional(),
      }),
    )
    .optional(),
});

class WorkerHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'WorkerHttpError';
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw new WorkerHttpError(413, 'payload_too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function verifySignature(
  rawBody: string,
  providedSignature: string | undefined,
  secret: string,
): void {
  if (!providedSignature) {
    throw new WorkerHttpError(401, 'runtime_signature_required');
  }
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const providedBytes = Buffer.from(providedSignature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new WorkerHttpError(401, 'runtime_signature_invalid');
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sharedSecret: string,
): Promise<void> {
  if (request.method === 'GET' && request.url === '/healthz') {
    writeJson(response, 200, { status: 'ok', service: 'native-diagnosis-worker' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/execute') {
    writeJson(response, 404, { error: 'not_found' });
    return;
  }

  const rawBody = await readBody(request);
  verifySignature(
    rawBody,
    request.headers['x-casioplus-runtime-signature'] as string | undefined,
    sharedSecret,
  );
  const parsed = JSON.parse(rawBody) as unknown;
  const job = nativeDiagnosisJobSchema.extend({ input: structuredInputSchema }).parse(parsed);
  const diagnosisRequest: BusinessDiagnosisRequest = {
    organizationId: job.organizationId,
    workspaceId: job.workspaceId,
    actorId: job.actorId,
    workItemId: job.workItemId,
    processRunId: job.processRunId,
    input: job.input,
  };
  const output = diagnoseBusiness(diagnosisRequest);
  const result = nativeExecutionResultSchema.parse({
    schemaVersion: job.schemaVersion,
    output,
  });
  writeJson(response, 200, result);
}

export function createWorkerServer(sharedSecret: string): Server {
  if (sharedSecret.trim().length < 32) {
    throw new Error('RUNTIME_SHARED_SECRET must contain at least 32 characters');
  }
  return createServer((request, response) => {
    void handleRequest(request, response, sharedSecret).catch((error: unknown) => {
      if (error instanceof WorkerHttpError) {
        writeJson(response, error.statusCode, { error: error.code });
        return;
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        writeJson(response, 400, { error: 'invalid_job' });
        return;
      }
      console.error(JSON.stringify({ level: 'error', service: 'native-diagnosis-worker', error }));
      writeJson(response, 500, { error: 'worker_failed' });
    });
  });
}

const sharedSecret = process.env.RUNTIME_SHARED_SECRET;
if (process.env.NODE_ENV !== 'test') {
  if (!sharedSecret || sharedSecret.trim().length < 32) {
    throw new Error('RUNTIME_SHARED_SECRET must contain at least 32 characters');
  }
  const port = Number(process.env.NATIVE_WORKER_PORT ?? 8090);
  const server = createWorkerServer(sharedSecret);
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', service: 'native-diagnosis-worker', port }));
  });
  const close = () => server.close();
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
