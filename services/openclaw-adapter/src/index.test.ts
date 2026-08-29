import { describe, expect, it } from 'vitest';
import { createOpenClawActionHeaders, createOpenClawActionRequest } from './index.js';

const secret = 'openclaw-shared-secret-with-at-least-32-characters';
const action = {
  action: 'post_webhook' as const,
  target: 'https://partner.example.com/callback',
  payload: { runId: 'run-1', artifactId: 'artifact-1' },
  approvalId: '00000000-0000-4000-8000-000000000010',
  idempotencyKey: 'openclaw-action-run-1',
  expiresAt: '2026-12-01T00:00:00.000Z',
};

describe('OpenClaw adapter boundary', () => {
  it('accepts only approved, expiring and idempotent action requests', () => {
    const result = createOpenClawActionRequest(action);
    expect(result).toMatchObject({
      action: 'post_webhook',
      approvalId: '00000000-0000-4000-8000-000000000010',
      idempotencyKey: 'openclaw-action-run-1',
    });
  });

  it('rejects actions outside the allowlist or without approval', () => {
    expect(() => createOpenClawActionRequest({ ...action, action: 'shell_exec' })).toThrow();
    expect(() => createOpenClawActionRequest({ ...action, approvalId: 'not-a-uuid' })).toThrow();
  });

  it('adds an HMAC signature and non-secret runtime marker', () => {
    const headers = createOpenClawActionHeaders(JSON.stringify(action), secret);
    expect(headers['x-casioplus-runtime']).toBe('openclaw');
    expect(headers['x-casioplus-action-signature']).toHaveLength(64);
  });
});
