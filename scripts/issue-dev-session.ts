import { signSession } from '../services/core-api/src/auth.js';

const required = ['SESSION_SECRET', 'ORGANIZATION_ID', 'WORKSPACE_ID', 'ACTOR_ID'] as const;
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`${name} must be configured`);
  }
}

const expiresInSeconds = Number(process.env.SESSION_TTL_SECONDS ?? 3600);
if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0 || expiresInSeconds > 86_400) {
  throw new Error('SESSION_TTL_SECONDS must be a positive integer no greater than 86400');
}

const token = signSession(
  {
    organizationId: process.env.ORGANIZATION_ID!,
    workspaceId: process.env.WORKSPACE_ID!,
    actorId: process.env.ACTOR_ID!,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  },
  process.env.SESSION_SECRET!,
);
console.log(token);
