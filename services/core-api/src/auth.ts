import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { organizationContextSchema } from '../../../packages/contracts/src/index.js';

const scrypt = promisify(scryptCallback);
const sessionClaimsSchema = organizationContextSchema.extend({
  sessionId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  expiresAt: z.number().int().positive(),
});

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = 'authentication_required';

  constructor(message = 'Authentication is required') {
    super(message);
    this.name = 'AuthenticationError';
  }
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

function cookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.header('cookie');
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = pair.trim().split('=');
    if (rawName === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

export function sessionTokenFromRequest(req: Request): string {
  const authorization = req.header('authorization');
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const token = cookieValue(req, 'casioplus_session');
  if (!token) throw new AuthenticationError('Session is required');
  return token;
}

export function sessionTokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function csrfTokenFromRequest(req: Request): string | null {
  return cookieValue(req, 'casioplus_csrf');
}

export function assertCsrfForCookieRequest(req: Request): void {
  if (!cookieValue(req, 'casioplus_session')) return;
  const cookieToken = cookieValue(req, 'casioplus_csrf');
  const headerToken = req.header('x-casioplus-csrf');
  if (!cookieToken || !headerToken) {
    const error = new AuthenticationError('CSRF token is required');
    Object.assign(error, { statusCode: 403, code: 'csrf_required' });
    throw error;
  }
  const cookieBytes = Buffer.from(cookieToken);
  const headerBytes = Buffer.from(headerToken);
  if (cookieBytes.length !== headerBytes.length || !timingSafeEqual(cookieBytes, headerBytes)) {
    const error = new AuthenticationError('CSRF token is invalid');
    Object.assign(error, { statusCode: 403, code: 'csrf_invalid' });
    throw error;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, encodedSalt, encodedHash] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedHash) return false;
  const expected = Buffer.from(encodedHash, 'base64url');
  const actual = (await scrypt(
    password,
    Buffer.from(encodedSalt, 'base64url'),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function authenticatedTenantContext(secret: string, now = Date.now()) {
  return (req: Request) => verifySession(sessionTokenFromRequest(req), secret, now);
}

export function persistentTenantContext(pool: Pool, secret: string, now = Date.now()) {
  return async (req: Request) => {
    const claims = verifySession(sessionTokenFromRequest(req), secret, now);
    if (!claims.sessionId || !claims.userId) {
      throw new AuthenticationError('Persistent session is required');
    }
    const active = await pool.query(
      `SELECT 1
         FROM identity_sessions
        WHERE id = $1 AND user_id = $2
          AND organization_id = $3 AND workspace_id = $4 AND actor_id = $5
          AND token_digest = $6
          AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [
        claims.sessionId,
        claims.userId,
        claims.organizationId,
        claims.workspaceId,
        claims.actorId,
        sessionTokenDigest(sessionTokenFromRequest(req)),
      ],
    );
    if (active.rowCount !== 1) {
      throw new AuthenticationError('Session is revoked or expired');
    }
    return claims;
  };
}
