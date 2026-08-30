import { describe, expect, it } from 'vitest';
import { openClawActionRequestSchema, parseOpenClawExecutorTargets } from './index.js';

const action = {
  action: 'send_message' as const,
  executorRef: 'operations.primary',
  message: 'Production deployment completed.',
  approvalId: '00000000-0000-4000-8000-000000000010',
  idempotencyKey: 'openclaw-action-run-1',
  expiresAt: '2026-12-01T00:00:00.000Z',
};

describe('OpenClaw action-plane contracts', () => {
  it('accepts only the deterministic approved message action', () => {
    expect(openClawActionRequestSchema.parse(action)).toMatchObject({
      action: 'send_message',
      executorRef: 'operations.primary',
      approvalId: '00000000-0000-4000-8000-000000000010',
    });
    expect(() => openClawActionRequestSchema.parse({ ...action, action: 'shell_exec' })).toThrow();
  });

  it('requires approval, expiry and idempotency for every action', () => {
    expect(() => openClawActionRequestSchema.parse({ ...action, approvalId: 'invalid' })).toThrow();
    expect(() =>
      openClawActionRequestSchema.parse({ ...action, idempotencyKey: 'short' }),
    ).toThrow();
  });

  it('loads only typed server-side executor targets', () => {
    expect(
      parseOpenClawExecutorTargets(
        JSON.stringify({
          'operations.primary': { channel: 'slack', target: 'channel:C123', account: 'ops' },
        }),
      ),
    ).toEqual({
      'operations.primary': { channel: 'slack', target: 'channel:C123', account: 'ops' },
    });
    expect(() =>
      parseOpenClawExecutorTargets(JSON.stringify({ unsafe: { channel: 'unknown', target: '*' } })),
    ).toThrow();
  });
});
