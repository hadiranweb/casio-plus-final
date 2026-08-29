import { describe, expect, it } from 'vitest';
import { AuthenticationError, signSession, verifySession } from './auth.js';

const secret = 'local-test-session-secret-with-at-least-32-chars';
const claims = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  actorId: '00000000-0000-4000-8000-000000000003',
  expiresAt: 2_000,
};

describe('signed session boundary', () => {
  it('round-trips valid claims', () => {
    const token = signSession(claims, secret);

    expect(verifySession(token, secret, 1_000)).toEqual(claims);
  });

  it('rejects a modified payload or signature', () => {
    const token = signSession(claims, secret);
    const [payload, signature] = token.split('.');
    const modified = `${payload}x.${signature}`;

    expect(() => verifySession(modified, secret, 1_000)).toThrow(AuthenticationError);
  });

  it('rejects expired claims', () => {
    const token = signSession(claims, secret);

    expect(() => verifySession(token, secret, 2_000)).toThrow(AuthenticationError);
  });
});
