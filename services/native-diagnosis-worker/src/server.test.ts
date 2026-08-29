import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkerServer } from './server.js';

const secret = 'local-worker-secret-with-at-least-32-characters';
const job = {
  schemaVersion: 'business-diagnosis.v1' as const,
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  actorId: '00000000-0000-4000-8000-000000000003',
  workItemId: '00000000-0000-4000-8000-000000000004',
  processRunId: '00000000-0000-4000-8000-000000000005',
  input: {
    business: { industry: 'technology', size: 'small' },
    position: {
      title: 'Operations Lead',
      responsibilities: ['operations'],
      requiredCapabilities: ['operations'],
    },
    candidates: [
      {
        id: 'candidate-1',
        skills: ['operations'],
        experience: ['operations'],
        industry: 'technology',
      },
    ],
  },
};

describe('native worker server', () => {
  const server = createWorkerServer(secret);
  let baseUrl = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('exposes a private health endpoint', async () => {
    const response = await fetch(`${baseUrl}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'native-diagnosis-worker',
    });
  });

  it('rejects unsigned jobs', async () => {
    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'runtime_signature_required' });
  });

  it('executes a signed structured diagnosis job', async () => {
    const rawBody = JSON.stringify(job);
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    const response = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-casioplus-runtime-signature': signature,
      },
      body: rawBody,
    });
    const result = (await response.json()) as {
      schemaVersion: string;
      output: { schemaVersion: string; candidateEvaluations: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(result.schemaVersion).toBe('business-diagnosis.v1');
    expect(result.output.schemaVersion).toBe('business-diagnosis.v1');
    expect(result.output.candidateEvaluations).toHaveLength(1);
  });
});
