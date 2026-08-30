import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { persistentTenantContext } from './auth.js';
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
  let ownerOrganizationId = '';
  let ownerPrimaryWorkspaceId = '';
  let ownerActorId = '';
  let operationsWorkspaceId = '';
  let memberActiveCookieHeader = '';
  let memberActiveCsrf = '';
  let memberActorId = '';
  let memberOriginalOrganizationId = '';
  let memberOriginalWorkspaceId = '';
  let secondOrganizationId = '';
  let secondWorkspaceId = '';

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    app = createApp(pool, {
      sessionSecret,
      enforceMembership: true,
      resolveTenantContext: persistentTenantContext(pool, sessionSecret),
    });
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
    ownerOrganizationId = response.body.context.organizationId;
    ownerPrimaryWorkspaceId = response.body.context.workspaceId;
    ownerActorId = response.body.context.actorId;
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
    operationsWorkspaceId = workspace.body.workspace.id;

    const invitation = await request(app)
      .post('/api/v1/invitations')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ email: memberEmail, role: 'editor', expiresInHours: 24 });
    expect(invitation.status).toBe(201);
    expect(invitation.body.invitation.status).toBe('pending');
    invitationToken = invitation.body.token;
  });

  it('lists accessible scopes and rotates the session when switching Workspace', async () => {
    const scopes = await request(app).get('/api/v1/organizations').set('Cookie', ownerCookieHeader);
    expect(scopes.status).toBe(200);
    expect(scopes.body.items).toHaveLength(2);

    const switched = await request(app)
      .post('/api/v1/auth/switch-context')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ organizationId: ownerOrganizationId, workspaceId: operationsWorkspaceId });
    expect(switched.status).toBe(200);
    expect(switched.body.context.workspaceId).toBe(operationsWorkspaceId);

    const oldSession = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', ownerCookieHeader);
    expect(oldSession.status).toBe(401);

    ownerCookies = switched.headers['set-cookie'] as unknown as string[];
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);
    const activeSession = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', ownerCookieHeader);
    expect(activeSession.status).toBe(200);
    expect(activeSession.body.context.workspaceId).toBe(operationsWorkspaceId);
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
    memberOriginalOrganizationId = registration.body.context.organizationId;
    memberOriginalWorkspaceId = registration.body.context.workspaceId;
    const crossTenantSwitch = await request(app)
      .post('/api/v1/auth/switch-context')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        organizationId: memberOriginalOrganizationId,
        workspaceId: memberOriginalWorkspaceId,
      });
    expect(crossTenantSwitch.status).toBe(403);
    expect(crossTenantSwitch.body.error).toBe('workspace_membership_required');

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
    memberActiveCookieHeader = cookieHeader(newCookies);
    memberActiveCsrf = csrfFromCookies(newCookies);
    const active = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', memberActiveCookieHeader);
    expect(active.status).toBe(200);
    expect(active.body.context.role).toBe('editor');
    expect(active.body.csrfToken).toBe(memberActiveCsrf);
    memberActorId = active.body.context.actorId;

    const membersDenied = await request(app)
      .get('/api/v1/members')
      .set('Cookie', memberActiveCookieHeader);
    expect(membersDenied.status).toBe(403);
    expect(membersDenied.body.error).toBe('administrative_role_required');

    const workspaceDenied = await request(app)
      .post('/api/v1/workspaces')
      .set('Cookie', memberActiveCookieHeader)
      .set('x-casioplus-csrf', memberActiveCsrf)
      .send({ name: 'Unauthorized', slug: `unauthorized-${unique}` });
    expect(workspaceDenied.status).toBe(403);
    expect(workspaceDenied.body.error).toBe('administrative_role_required');
  });

  it('lists members, updates roles, revokes access, and preserves the final owner', async () => {
    const listed = await request(app).get('/api/v1/members').set('Cookie', ownerCookieHeader);
    expect(listed.status).toBe(200);
    expect(
      listed.body.items.some((member: { email: string }) => member.email === memberEmail),
    ).toBe(true);

    const updated = await request(app)
      .patch(`/api/v1/members/${memberActorId}`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ role: 'reviewer' });
    expect(updated.status).toBe(200);
    expect(updated.body.member.organizationRole).toBe('reviewer');

    const memberSession = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', memberActiveCookieHeader);
    expect(memberSession.status).toBe(200);
    expect(memberSession.body.context.role).toBe('reviewer');

    const finalOwner = await request(app)
      .patch(`/api/v1/members/${ownerActorId}`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ role: 'viewer' });
    expect(finalOwner.status).toBe(409);
    expect(finalOwner.body.error).toBe('last_owner_must_remain_active');

    const revoked = await request(app)
      .patch(`/api/v1/members/${memberActorId}`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ status: 'revoked' });
    expect(revoked.status).toBe(200);
    expect(revoked.body.member.status).toBe('revoked');

    const revokedSession = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', memberActiveCookieHeader);
    expect(revokedSession.status).toBe(401);
  });

  it('lists, de-duplicates, and revokes pending invitations', async () => {
    const email = `pending-${unique}@example.test`;
    const created = await request(app)
      .post('/api/v1/invitations')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        email,
        role: 'viewer',
        workspaceId: ownerPrimaryWorkspaceId,
        expiresInHours: 24,
      });
    expect(created.status).toBe(201);
    expect(created.body.delivery).toBe('manual_link');

    const duplicate = await request(app)
      .post('/api/v1/invitations')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        email,
        role: 'viewer',
        workspaceId: ownerPrimaryWorkspaceId,
        expiresInHours: 24,
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe('invitation_already_pending');

    const listed = await request(app).get('/api/v1/invitations').set('Cookie', ownerCookieHeader);
    expect(listed.status).toBe(200);
    expect(
      listed.body.items.some(
        (invitation: { id: string; email: string; status: string }) =>
          invitation.id === created.body.invitation.id &&
          invitation.email === email &&
          invitation.status === 'pending',
      ),
    ).toBe(true);

    const revoked = await request(app)
      .post(`/api/v1/invitations/${created.body.invitation.id}/revoke`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf);
    expect(revoked.status).toBe(200);
    expect(revoked.body.invitation.status).toBe('revoked');
  });

  it('creates a second Organization, rotates session, and can switch back safely', async () => {
    const created = await request(app)
      .post('/api/v1/organizations')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        name: `Second ${unique}`,
        slug: `second-${unique}`,
        workspaceName: 'Second Workspace',
        workspaceSlug: `second-workspace-${unique}`,
      });
    expect(created.status).toBe(201);
    expect(created.body.csrfToken).toBeTruthy();
    secondOrganizationId = created.body.context.organizationId;
    secondWorkspaceId = created.body.context.workspaceId;

    const previousSession = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', ownerCookieHeader);
    expect(previousSession.status).toBe(401);

    ownerCookies = created.headers['set-cookie'] as unknown as string[];
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);
    const scopes = await request(app).get('/api/v1/organizations').set('Cookie', ownerCookieHeader);
    expect(scopes.status).toBe(200);
    expect(scopes.body.items).toHaveLength(3);

    const switchedBack = await request(app)
      .post('/api/v1/auth/switch-context')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ organizationId: ownerOrganizationId, workspaceId: operationsWorkspaceId });
    expect(switchedBack.status).toBe(200);

    ownerCookies = switchedBack.headers['set-cookie'] as unknown as string[];
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);
  });

  it('manages ExternalApp keys and server-resolved mappings without accepting secrets', async () => {
    const application = await request(app)
      .post('/api/v1/external-apps')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ key: `client-${unique}`, name: 'Casioplus Integration QA' });
    expect(application.status).toBe(201);
    const externalAppId = application.body.application.id as string;

    const secretRejected = await request(app)
      .post('/api/v1/integration-keys')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        externalAppId,
        keyId: `key-${unique}-rejected`,
        secretRef: `CASIOPLUS_QA_${unique.toUpperCase()}`,
        secret: 'must-never-be-accepted',
      });
    expect(secretRejected.status).toBe(400);

    const initialKey = await request(app)
      .post('/api/v1/integration-keys')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        externalAppId,
        keyId: `key-${unique}-1`,
        secretRef: `CASIOPLUS_QA_${unique.toUpperCase()}_1`,
      });
    expect(initialKey.status).toBe(201);
    expect(initialKey.body.integrationKey.secretRef).toContain('CASIOPLUS_QA_');

    const retiringValidUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const rotatedKey = await request(app)
      .post('/api/v1/integration-keys')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        externalAppId,
        keyId: `key-${unique}-2`,
        secretRef: `CASIOPLUS_QA_${unique.toUpperCase()}_2`,
        retiringKeyId: `key-${unique}-1`,
        retiringValidUntil,
      });
    expect(rotatedKey.status).toBe(201);

    const mapping = await request(app)
      .post('/api/v1/external-workspace-mappings')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        externalAppId,
        externalTenantRef: `tenant-${unique}`,
        workspaceId: operationsWorkspaceId,
        externalWorkspaceRef: `workspace-${unique}`,
        callbackOrigin: 'https://callbacks.example.test',
        callbackPathPrefix: '/casioplus/events',
      });
    expect(mapping.status).toBe(201);
    expect(mapping.body.mapping.workspaceId).toBe(operationsWorkspaceId);

    const listed = await request(app).get('/api/v1/external-apps').set('Cookie', ownerCookieHeader);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyId: `key-${unique}-1`, status: 'retiring' }),
        expect.objectContaining({ keyId: `key-${unique}-2`, status: 'active' }),
      ]),
    );
    expect(listed.body.items[0].mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalTenantRef: `tenant-${unique}`,
          externalWorkspaceRef: `workspace-${unique}`,
          workspaceId: operationsWorkspaceId,
          status: 'active',
        }),
      ]),
    );

    const disabledMapping = await request(app)
      .post(`/api/v1/external-workspace-mappings/${mapping.body.mapping.id}/disable`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf);
    expect(disabledMapping.status).toBe(200);
    expect(disabledMapping.body.mapping.status).toBe('disabled');

    const revokedKey = await request(app)
      .post(`/api/v1/integration-keys/${rotatedKey.body.integrationKey.id}/revoke`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf);
    expect(revokedKey.status).toBe(200);
    expect(revokedKey.body.integrationKey.status).toBe('revoked');

    const switched = await request(app)
      .post('/api/v1/auth/switch-context')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ organizationId: secondOrganizationId, workspaceId: secondWorkspaceId });
    expect(switched.status).toBe(200);
    ownerCookies = switched.headers['set-cookie'] as unknown as string[];
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);

    const isolatedList = await request(app)
      .get('/api/v1/external-apps')
      .set('Cookie', ownerCookieHeader);
    expect(isolatedList.status).toBe(200);
    expect(isolatedList.body.items).toHaveLength(0);

    const foreignMappingDenied = await request(app)
      .post('/api/v1/external-workspace-mappings')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({
        externalAppId,
        externalTenantRef: `foreign-${unique}`,
        workspaceId: secondWorkspaceId,
        externalWorkspaceRef: `foreign-workspace-${unique}`,
      });
    expect(foreignMappingDenied.status).toBe(404);
    expect(foreignMappingDenied.body.error).toBe('active_external_app_not_found');

    const switchedBack = await request(app)
      .post('/api/v1/auth/switch-context')
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf)
      .send({ organizationId: ownerOrganizationId, workspaceId: operationsWorkspaceId });
    expect(switchedBack.status).toBe(200);
    ownerCookies = switchedBack.headers['set-cookie'] as unknown as string[];
    ownerCookieHeader = cookieHeader(ownerCookies);
    ownerCsrf = csrfFromCookies(ownerCookies);

    const disabledApp = await request(app)
      .post(`/api/v1/external-apps/${externalAppId}/disable`)
      .set('Cookie', ownerCookieHeader)
      .set('x-casioplus-csrf', ownerCsrf);
    expect(disabledApp.status).toBe(200);
    expect(disabledApp.body.application.status).toBe('disabled');

    const audit = await pool.query(
      `SELECT count(*)::integer AS count
         FROM audit_events
        WHERE organization_id = $1
          AND event_type LIKE 'integration.%'`,
      [ownerOrganizationId],
    );
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(6);
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
