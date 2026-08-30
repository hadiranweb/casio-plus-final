import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const sessionSecret = 'casioplus-identity-integration-secret-2026';

function cookieHeader(setCookie: string[]): string {
  return setCookie.map((value) => value.split(';')[0]).join('; ');
}

function csrfFromCookies(setCookie: string[]): string {
  const cookie = setCookie.find((value) => value.startsWith('casioplus_csrf='));
  if (!cookie) throw new Error('CSRF cookie was not issued');
  return decodeURIComponent(cookie.split(';')[0]!.split('=').slice(1).join('='));
}

describeWithDatabase('persistent identity and tenant boundary', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  const unique = randomUUID().slice(0, 8);
  const ownerEmail = `owner-${unique}@example.test`;
  const memberEmail = `member-${unique}@example.test`;
  const password = 'Correct-Horse-Battery-2026';
  let ownerCookies: string[] = [];
  let ownerCookieHeader = '';
  let ownerCsrf = '';
  let memberOldCookieHeader = '';
  let memberOldCsrf = '';
  let invitationToken = '';

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    app = createApp(pool, { sessionSecret, enforceMembership: true });
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('registers an owner and issues secure server-managed session cookies', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: ownerEmail,
        password,
        displayName: 'Casioplus Owner',
        organizationName: `Casioplus ${unique}`,
        organizationSlug: `casioplus-${unique}`,
        workspaceName: 'Primary Workspace',
        workspaceSlug: 'primary-workspace',
      });

    expect(response.status).toBe(201);
    expect(response.body.context.role).toBe('owner');
    ownerCookies = response.headers['set-cookie'] as unknown as string[];
    expect(ownerCookies.some((value) => value.includes('HttpOnly'))).toBe(true);
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);
  });

  it('resolves the persisted session and denies state changes without CSRF', async () => {
    const session = await request(app).get('/api/v1/auth/session').set('Cookie', ownerCookieHeader);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(ownerEmail);

    const denied = await request(app)
      .post('/api/v1/workspaces')
      .set('Cookie', ownerCookieHeader)
      .send({ name: 'Denied Workspace', slug: `denied-${unique}` });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('csrf_required');

    const deniedCoreWrite = await request(app)
      .post('/api/v1/work-items')
      .set('Cookie', ownerCookieHeader)
      .send({ title: 'Denied Core Write' });
    expect(deniedCoreWrite.status).toBe(403);
    expect(deniedCoreWrite.body.error).toBe('csrf_required');

    const acceptedCoreWrite = await request(app)
      .post('/api/v1/work-items')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ title: 'CSRF Protected Core Write' });
    expect(acceptedCoreWrite.status).toBe(201);
  });

  it('creates a workspace and invitation through the canonical writer', async () => {
    const workspace = await request(app)
      .post('/api/v1/workspaces')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ name: 'Operations', slug: `operations-${unique}` });
    expect(workspace.status).toBe(201);

    const invitation = await request(app)
      .post('/api/v1/invitations')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ email: memberEmail, role: 'editor', expiresInHours: 24 });
    expect(invitation.status).toBe(201);
    expect(invitation.body.invitation.status).toBe('pending');
    invitationToken = invitation.body.token;
  });

  it('accepts an invitation, rotates scope, and revokes the previous session', async () => {
    const registration = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: memberEmail,
        password,
        displayName: 'Casioplus Member',
        organizationName: `Member ${unique}`,
        organizationSlug: `member-${unique}`,
        workspaceName: 'Member Workspace',
        workspaceSlug: 'member-workspace',
      });
    expect(registration.status).toBe(201);
    const memberCookies = registration.headers['set-cookie'] as unknown as string[];
    memberOldCookieHeader = cookieHeader(memberCookies);
    memberOldCsrf = csrfFromCookies(memberCookies);

    const accepted = await request(app)
      .post('/api/v1/invitations/accept')
      .set('Cookie', memberOldCookieHeader)
      .set('x-casioplus-csrf', memberOldCsrf)
      .send({ token: invitationToken });
    expect(accepted.status).toBe(200);
    expect(accepted.body.context.role).toBe('editor');

    const revoked = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', memberOldCookieHeader);
    expect(revoked.status).toBe(401);

    const newCookies = accepted.headers['set-cookie'] as unknown as string[];
    const active = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookieHeader(newCookies));
    expect(active.status).toBe(200);
    expect(active.body.context.role).toBe('editor');
  });

  it('revokes the owner session on logout', async () => {
    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf);
    expect(logout.status).toBe(204);

    const revoked = await request(app).get('/api/v1/auth/session').set('Cookie', ownerCookieHeader);
    expect(revoked.status).toBe(401);
  });
});
