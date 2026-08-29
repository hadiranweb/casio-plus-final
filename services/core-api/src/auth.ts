import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { organizationContextSchema } from '../../../packages/contracts/src/index.js';

const sessionClaimsSchema = organizationContextSchema.extend({
  expiresAt: z.number().int().positive(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = 'authentication_required';
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function signSession(claims: SessionClaims, secret: string): string {
  if (secret.trim().length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }
  const payload = encode(JSON.stringify(sessionClaimsSchema.parse(claims)));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): SessionClaims {
  if (secret.trim().length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    throw new AuthenticationError('Malformed session token');
  }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new AuthenticationError('Invalid session signature');
  }

  let claims: SessionClaims;
  try {
    claims = sessionClaimsSchema.parse(JSON.parse(decode(payload)));
  } catch {
    throw new AuthenticationError('Invalid session claims');
  }
  if (claims.expiresAt <= now) {
    throw new AuthenticationError('Session expired');
  }
  return claims;
}

function bearerToken(req: Request): string {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new AuthenticationError('Bearer session is required');
  }
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthenticationError('Bearer session is required');
  }
  return token;
}

export function authenticatedTenantContext(secret: string, now = Date.now()) {
  return (req: Request) => {
    const claims = verifySession(bearerToken(req), secret, now);
    return organizationContextSchema.parse(claims);
  };
}
