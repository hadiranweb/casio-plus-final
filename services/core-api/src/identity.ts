import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  acceptInvitationSchema,
  createExternalAppSchema,
  createExternalTenantMappingSchema,
  createIntegrationKeyMetadataSchema,
  createInvitationSchema,
  createOrganizationSchema,
  createWorkspaceSchema,
  identifierSchema,
  loginSchema,
  registerAccountSchema,
  switchContextSchema,
  updateMemberSchema,
} from '../../../packages/contracts/src/index.js';
import {
  assertCsrfForCookieRequest,
  createCsrfToken,
  csrfTokenFromRequest,
  hashPassword,
  sessionTokenDigest,
  sessionTokenFromRequest,
  signSession,
  verifyPassword,
  verifySession,
} from './auth.js';
import { withTransaction } from './db.js';

type DatabaseClient = Pool | PoolClient;
type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';

export class IdentityError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

interface Principal extends QueryResultRow {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
  role: OrganizationRole;
  expiresAt: Date;
}

interface SessionScope {
  userId: string;
  organizationId: string;
  workspaceId: string;
  actorId: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function ensureDefaultMemoryNamespace(
  database: DatabaseClient,
  organizationId: string,
): Promise<void> {
  const policy = await database.query<{ id: string }>(
    `INSERT INTO storage_policies (organization_id, mode, retention_days, deletion_propagation)
     VALUES ($1, 'casio_managed', 365, true)
     ON CONFLICT (organization_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [organizationId],
  );
  await database.query(
    `INSERT INTO memory_namespaces
        (organization_id, workspace_id, storage_policy_id, key, name, namespace_kind)
     VALUES ($1, NULL, $2, 'organization-memory', 'Organization Memory', 'governed')
     ON CONFLICT (organization_id, key) DO NOTHING`,
    [organizationId, policy.rows[0]!.id],
  );
}

async function issueSession(
  database: DatabaseClient,
  scope: SessionScope,
  secret: string,
): Promise<{ token: string; csrfToken: string; expiresAt: Date; sessionId: string }> {
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = signSession(
    {
      ...scope,
      sessionId,
      expiresAt: expiresAt.getTime(),
    },
    secret,
  );
  await database.query(
    `INSERT INTO identity_sessions
        (id, user_id, organization_id, workspace_id, actor_id, token_digest, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      scope.userId,
      scope.organizationId,
      scope.workspaceId,
      scope.actorId,
      sessionTokenDigest(token),
      expiresAt,
    ],
  );
  return { token, csrfToken: createCsrfToken(), expiresAt, sessionId };
}

function setSessionCookies(
  response: Response,
  session: { token: string; csrfToken: string; expiresAt: Date },
): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  response.setHeader('set-cookie', [
    `casioplus_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`,
    `casioplus_csrf=${encodeURIComponent(session.csrfToken)}; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`,
  ]);
}

function clearSessionCookies(response: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('set-cookie', [
    `casioplus_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    `casioplus_csrf=; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  ]);
}

async function loadPrincipal(request: Request, pool: Pool, secret: string): Promise<Principal> {
  const token = sessionTokenFromRequest(request);
  const claims = verifySession(token, secret);
  if (!claims.sessionId || !claims.userId) {
    throw new IdentityError(401, 'persistent_session_required');
  }
  const result = await pool.query<Principal>(
    `SELECT s.id AS "sessionId", u.id AS "userId", u.email, u.display_name AS "displayName",
            s.organization_id AS "organizationId", s.workspace_id AS "workspaceId",
            s.actor_id AS "actorId", wm.role, s.expires_at AS "expiresAt"
       FROM identity_sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN workspaces w
         ON w.organization_id = s.organization_id
        AND w.id = s.workspace_id
        AND w.status = 'active'
       JOIN workspace_memberships wm
         ON wm.organization_id = s.organization_id
        AND wm.workspace_id = s.workspace_id
        AND wm.actor_id = s.actor_id
        AND wm.status = 'active'
       JOIN members m
         ON m.organization_id = s.organization_id
        AND m.actor_id = s.actor_id
        AND m.status = 'active'
      WHERE s.id = $1 AND s.user_id = $2
        AND s.organization_id = $3 AND s.workspace_id = $4 AND s.actor_id = $5
        AND s.token_digest = $6 AND s.revoked_at IS NULL AND s.expires_at > now()
      LIMIT 1`,
    [
      claims.sessionId,
      claims.userId,
      claims.organizationId,
      claims.workspaceId,
      claims.actorId,
      sessionTokenDigest(token),
    ],
  );
  const principal = result.rows[0];
  if (!principal) throw new IdentityError(401, 'session_revoked_or_expired');
  return principal;
}

async function requireAdministrativeRole(
  database: DatabaseClient,
  principal: Principal,
): Promise<void> {
  const membership = await database.query<{ role: OrganizationRole }>(
    `SELECT role FROM members
      WHERE organization_id = $1 AND actor_id = $2 AND status = 'active'
      LIMIT 1`,
    [principal.organizationId, principal.actorId],
  );
  if (!['owner', 'admin'].includes(membership.rows[0]?.role ?? '')) {
    throw new IdentityError(403, 'administrative_role_required');
  }
}

function publicPrincipal(principal: Principal) {
  return {
    user: {
      id: principal.userId,
      email: principal.email,
      displayName: principal.displayName,
    },
    context: {
      organizationId: principal.organizationId,
      workspaceId: principal.workspaceId,
      actorId: principal.actorId,
      role: principal.role,
    },
    expiresAt: principal.expiresAt,
  };
}

export function mountIdentityRoutes(app: Express, pool: Pool, sessionSecret: string): void {
  app.post('/api/v1/auth/register', async (request, response, next) => {
    try {
      const input = registerAccountSchema.parse(request.body);
      const passwordHash = await hashPassword(input.password);
      const result = await withTransaction(pool, async (client) => {
        const user = await client.query<{ id: string }>(
          `INSERT INTO users (email, normalized_email, password_hash, display_name)
           VALUES ($1, $1, $2, $3)
           RETURNING id`,
          [input.email, passwordHash, input.displayName],
        );
        const organization = await client.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
          [input.organizationName, input.organizationSlug],
        );
        const organizationId = organization.rows[0]!.id;
        await ensureDefaultMemoryNamespace(client, organizationId);
        const workspace = await client.query<{ id: string }>(
          `INSERT INTO workspaces (organization_id, name, slug)
           VALUES ($1, $2, $3) RETURNING id`,
          [organizationId, input.workspaceName, input.workspaceSlug],
        );
        const workspaceId = workspace.rows[0]!.id;
        const actor = await client.query<{ id: string }>(
          `INSERT INTO actors (organization_id, kind, external_subject, display_name)
           VALUES ($1, 'human', $2, $3) RETURNING id`,
          [organizationId, `user:${user.rows[0]!.id}`, input.displayName],
        );
        const actorId = actor.rows[0]!.id;
        await client.query(`INSERT INTO actor_identities (actor_id, user_id) VALUES ($1, $2)`, [
          actorId,
          user.rows[0]!.id,
        ]);
        await client.query(
          `INSERT INTO members (organization_id, actor_id, role, status)
           VALUES ($1, $2, 'owner', 'active')`,
          [organizationId, actorId],
        );
        await client.query(
          `INSERT INTO workspace_memberships
              (organization_id, workspace_id, actor_id, role, status)
           VALUES ($1, $2, $3, 'owner', 'active')`,
          [organizationId, workspaceId, actorId],
        );
        const session = await issueSession(
          client,
          { userId: user.rows[0]!.id, organizationId, workspaceId, actorId },
          sessionSecret,
        );
        await client.query(
          `INSERT INTO audit_events (organization_id, actor_id, event_type, subject_type, subject_id)
           VALUES ($1, $2, 'identity.registered', 'organization', $1)`,
          [organizationId, actorId],
        );
        return {
          session,
          user: { id: user.rows[0]!.id, email: input.email, displayName: input.displayName },
          context: { organizationId, workspaceId, actorId, role: 'owner' as const },
        };
      });
      setSessionCookies(response, result.session);
      response.status(201).json({
        user: result.user,
        context: result.context,
        csrfToken: result.session.csrfToken,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return next(new IdentityError(409, 'identity_or_slug_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/auth/login', async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      const user = await pool.query<{
        id: string;
        email: string;
        displayName: string;
        passwordHash: string;
      }>(
        `SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash"
           FROM users WHERE normalized_email = $1 AND status = 'active' LIMIT 1`,
        [input.email],
      );
      const userRow = user.rows[0];
      if (!userRow || !(await verifyPassword(input.password, userRow.passwordHash))) {
        throw new IdentityError(401, 'invalid_credentials');
      }
      const context = await pool.query<{
        organizationId: string;
        workspaceId: string;
        actorId: string;
        role: OrganizationRole;
      }>(
        `SELECT wm.organization_id AS "organizationId", wm.workspace_id AS "workspaceId",
                wm.actor_id AS "actorId", wm.role
           FROM actor_identities ai
           JOIN workspace_memberships wm ON wm.actor_id = ai.actor_id AND wm.status = 'active'
           JOIN members m
             ON m.organization_id = wm.organization_id
            AND m.actor_id = wm.actor_id
            AND m.status = 'active'
          WHERE ai.user_id = $1
            AND ($2::uuid IS NULL OR wm.organization_id = $2)
            AND ($3::uuid IS NULL OR wm.workspace_id = $3)
          ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, wm.created_at
          LIMIT 1`,
        [userRow.id, input.organizationId ?? null, input.workspaceId ?? null],
      );
      const selected = context.rows[0];
      if (!selected) throw new IdentityError(403, 'workspace_membership_required');
      const session = await issueSession(pool, { userId: userRow.id, ...selected }, sessionSecret);
      setSessionCookies(response, session);
      response.json({
        user: { id: userRow.id, email: userRow.email, displayName: userRow.displayName },
        context: selected,
        csrfToken: session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/session', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      response.json({
        ...publicPrincipal(principal),
        csrfToken: csrfTokenFromRequest(request),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/switch-context', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      const input = switchContextSchema.parse(request.body);
      const target = await pool.query<{
        organizationId: string;
        workspaceId: string;
        actorId: string;
        role: OrganizationRole;
      }>(
        `SELECT wm.organization_id AS "organizationId", wm.workspace_id AS "workspaceId",
                wm.actor_id AS "actorId", wm.role
           FROM actor_identities ai
           JOIN workspace_memberships wm ON wm.actor_id = ai.actor_id AND wm.status = 'active'
           JOIN members m
             ON m.organization_id = wm.organization_id
            AND m.actor_id = wm.actor_id
            AND m.status = 'active'
           JOIN organizations o ON o.id = wm.organization_id
           JOIN workspaces w
             ON w.organization_id = wm.organization_id
            AND w.id = wm.workspace_id
            AND w.status = 'active'
          WHERE ai.user_id = $1 AND wm.organization_id = $2 AND wm.workspace_id = $3
          LIMIT 1`,
        [principal.userId, input.organizationId, input.workspaceId],
      );
      const selected = target.rows[0];
      if (!selected) throw new IdentityError(403, 'workspace_membership_required');
      const session = await withTransaction(pool, async (client) => {
        await client.query(`UPDATE identity_sessions SET revoked_at = now() WHERE id = $1`, [
          principal.sessionId,
        ]);
        const issued = await issueSession(
          client,
          { userId: principal.userId, ...selected },
          sessionSecret,
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $3, 'identity.context_switched', 'workspace', $2::uuid,
                   jsonb_build_object('workspaceId', ($2::uuid)::text,
                                      'previousOrganizationId', $4::text,
                                      'previousWorkspaceId', $5::text))`,
          [
            selected.organizationId,
            selected.workspaceId,
            selected.actorId,
            principal.organizationId,
            principal.workspaceId,
          ],
        );
        return issued;
      });
      setSessionCookies(response, session);
      response.json({
        user: {
          id: principal.userId,
          email: principal.email,
          displayName: principal.displayName,
        },
        context: selected,
        csrfToken: session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/logout', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await pool.query(`UPDATE identity_sessions SET revoked_at = now() WHERE id = $1`, [
        principal.sessionId,
      ]);
      clearSessionCookies(response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/organizations', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      const organizations = await pool.query(
        `SELECT o.id AS "organizationId", o.name AS "organizationName", o.slug AS "organizationSlug",
                w.id AS "workspaceId", w.name AS "workspaceName", w.slug AS "workspaceSlug",
                wm.actor_id AS "actorId", wm.role
           FROM actor_identities ai
           JOIN workspace_memberships wm ON wm.actor_id = ai.actor_id AND wm.status = 'active'
           JOIN members m
             ON m.organization_id = wm.organization_id
            AND m.actor_id = wm.actor_id
            AND m.status = 'active'
           JOIN organizations o ON o.id = wm.organization_id
           JOIN workspaces w
             ON w.id = wm.workspace_id
            AND w.organization_id = o.id
            AND w.status = 'active'
          WHERE ai.user_id = $1
          ORDER BY o.name, w.name`,
        [principal.userId],
      );
      response.json({ items: organizations.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/organizations', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      const input = createOrganizationSchema.parse(request.body);
      const result = await withTransaction(pool, async (client) => {
        const organization = await client.query<{ id: string }>(
          `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
          [input.name, input.slug],
        );
        const organizationId = organization.rows[0]!.id;
        await ensureDefaultMemoryNamespace(client, organizationId);
        const workspace = await client.query<{ id: string }>(
          `INSERT INTO workspaces (organization_id, name, slug)
           VALUES ($1, $2, $3) RETURNING id`,
          [organizationId, input.workspaceName, input.workspaceSlug],
        );
        const workspaceId = workspace.rows[0]!.id;
        const actor = await client.query<{ id: string }>(
          `INSERT INTO actors (organization_id, kind, external_subject, display_name)
           VALUES ($1, 'human', $2, $3) RETURNING id`,
          [organizationId, `user:${principal.userId}`, principal.displayName],
        );
        const actorId = actor.rows[0]!.id;
        await client.query(`INSERT INTO actor_identities (actor_id, user_id) VALUES ($1, $2)`, [
          actorId,
          principal.userId,
        ]);
        await client.query(
          `INSERT INTO members (organization_id, actor_id, role, status)
           VALUES ($1, $2, 'owner', 'active')`,
          [organizationId, actorId],
        );
        await client.query(
          `INSERT INTO workspace_memberships
              (organization_id, workspace_id, actor_id, role, status)
           VALUES ($1, $2, $3, 'owner', 'active')`,
          [organizationId, workspaceId, actorId],
        );
        await client.query(`UPDATE identity_sessions SET revoked_at = now() WHERE id = $1`, [
          principal.sessionId,
        ]);
        const session = await issueSession(
          client,
          { userId: principal.userId, organizationId, workspaceId, actorId },
          sessionSecret,
        );
        return {
          session,
          context: { organizationId, workspaceId, actorId, role: 'owner' as const },
        };
      });
      setSessionCookies(response, result.session);
      response.status(201).json({
        context: result.context,
        csrfToken: result.session.csrfToken,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/workspaces', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createWorkspaceSchema.parse({ ...request.body, ...principal });
      const workspace = await withTransaction(pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO workspaces (organization_id, name, slug)
           VALUES ($1, $2, $3)
           RETURNING id, organization_id AS "organizationId", name, slug, status`,
          [principal.organizationId, input.name, input.slug],
        );
        await client.query(
          `INSERT INTO workspace_memberships
              (organization_id, workspace_id, actor_id, role, status)
           VALUES ($1, $2, $3, $4, 'active')`,
          [principal.organizationId, inserted.rows[0].id, principal.actorId, principal.role],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $3, 'identity.workspace_created', 'workspace', $2::uuid,
                   jsonb_build_object('workspaceId', ($2::uuid)::text))`,
          [principal.organizationId, inserted.rows[0].id, principal.actorId],
        );
        return inserted.rows[0];
      });
      response.status(201).json({ workspace });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/workspaces', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      const workspaces = await pool.query(
        `SELECT w.id, w.organization_id AS "organizationId", w.name, w.slug, w.status,
                wm.role, wm.status AS "membershipStatus", w.created_at AS "createdAt"
           FROM actor_identities ai
           JOIN workspace_memberships wm
             ON wm.actor_id = ai.actor_id
            AND wm.organization_id = $2
            AND wm.status = 'active'
           JOIN workspaces w
             ON w.organization_id = wm.organization_id
            AND w.id = wm.workspace_id
          WHERE ai.user_id = $1
          ORDER BY w.name`,
        [principal.userId, principal.organizationId],
      );
      response.json({ items: workspaces.rows });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/members', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const members = await pool.query(
        `SELECT m.actor_id AS "actorId", a.display_name AS "displayName", u.email,
                m.role AS "organizationRole", m.status,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'workspaceId', wm.workspace_id,
                      'workspaceName', w.name,
                      'role', wm.role,
                      'status', wm.status
                    ) ORDER BY w.name
                  ) FILTER (WHERE wm.workspace_id IS NOT NULL),
                  '[]'::jsonb
                ) AS workspaces
           FROM members m
           JOIN actors a
             ON a.organization_id = m.organization_id
            AND a.id = m.actor_id
           LEFT JOIN actor_identities ai ON ai.actor_id = m.actor_id
           LEFT JOIN users u ON u.id = ai.user_id
           LEFT JOIN workspace_memberships wm
             ON wm.organization_id = m.organization_id
            AND wm.actor_id = m.actor_id
           LEFT JOIN workspaces w
             ON w.organization_id = wm.organization_id
            AND w.id = wm.workspace_id
          WHERE m.organization_id = $1
          GROUP BY m.actor_id, a.display_name, u.email, m.role, m.status, m.created_at
          ORDER BY m.created_at`,
        [principal.organizationId],
      );
      response.json({ items: members.rows });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v1/members/:actorId', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const actorId = identifierSchema.parse(request.params.actorId);
      const input = updateMemberSchema.parse(request.body);
      if (actorId === principal.actorId && input.status === 'revoked') {
        throw new IdentityError(409, 'cannot_revoke_active_session_member');
      }
      const member = await withTransaction(pool, async (client) => {
        const current = await client.query<{ role: OrganizationRole; status: string }>(
          `SELECT role, status FROM members
            WHERE organization_id = $1 AND actor_id = $2
            FOR UPDATE`,
          [principal.organizationId, actorId],
        );
        const selected = current.rows[0];
        if (!selected) throw new IdentityError(404, 'member_not_found');
        if (selected.role === 'owner' && principal.role !== 'owner') {
          throw new IdentityError(403, 'owner_role_required');
        }
        if (selected.role === 'owner' && (input.role !== undefined || input.status === 'revoked')) {
          const owners = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM members
              WHERE organization_id = $1 AND role = 'owner' AND status = 'active'`,
            [principal.organizationId],
          );
          if (Number(owners.rows[0]?.count ?? 0) <= 1) {
            throw new IdentityError(409, 'last_owner_must_remain_active');
          }
        }
        const updated = await client.query(
          `UPDATE members
              SET role = COALESCE($3, role), status = COALESCE($4, status)
            WHERE organization_id = $1 AND actor_id = $2
          RETURNING actor_id AS "actorId", role AS "organizationRole", status`,
          [principal.organizationId, actorId, input.role ?? null, input.status ?? null],
        );
        if (input.role) {
          await client.query(
            `UPDATE workspace_memberships
                SET role = $3, updated_at = now()
              WHERE organization_id = $1 AND actor_id = $2 AND status = 'active'`,
            [principal.organizationId, actorId, input.role],
          );
        }
        if (input.status === 'revoked') {
          await client.query(
            `UPDATE workspace_memberships
                SET status = 'revoked', updated_at = now()
              WHERE organization_id = $1 AND actor_id = $2`,
            [principal.organizationId, actorId],
          );
          await client.query(
            `UPDATE identity_sessions SET revoked_at = now()
              WHERE organization_id = $1 AND actor_id = $2 AND revoked_at IS NULL`,
            [principal.organizationId, actorId],
          );
        }
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $3, 'identity.member_updated', 'member', $4,
                   jsonb_build_object('workspaceId', $2::text,
                                      'role', $5::text,
                                      'status', $6::text))`,
          [
            principal.organizationId,
            principal.workspaceId,
            principal.actorId,
            actorId,
            input.role ?? selected.role,
            input.status ?? selected.status,
          ],
        );
        return updated.rows[0];
      });
      response.json({ member });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/external-apps', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const applications = await pool.query(
        `SELECT ea.id, ea.key, ea.name, ea.status, ea.created_at AS "createdAt",
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'id', ik.id,
                           'keyId', ik.key_id,
                           'secretRef', ik.secret_ref,
                           'status', ik.status,
                           'validFrom', ik.valid_from,
                           'validUntil', ik.valid_until,
                           'createdAt', ik.created_at
                         ) ORDER BY ik.created_at DESC)
                    FROM integration_keys ik
                   WHERE ik.external_app_id = ea.id
                ), '[]'::jsonb) AS keys,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object(
                           'id', ewm.id,
                           'externalTenantRef', et.external_tenant_ref,
                           'externalWorkspaceRef', ewm.external_workspace_ref,
                           'workspaceId', ewm.workspace_id,
                           'workspaceName', w.name,
                           'status', ewm.status,
                           'createdAt', ewm.created_at
                         ) ORDER BY ewm.created_at DESC)
                    FROM external_tenants et
                    JOIN external_workspace_mappings ewm ON ewm.external_tenant_id = et.id
                    JOIN workspaces w ON w.id = ewm.workspace_id
                   WHERE et.external_app_id = ea.id
                     AND ewm.organization_id = $1
                ), '[]'::jsonb) AS mappings
           FROM external_apps ea
          WHERE ea.managing_organization_id = $1
          ORDER BY ea.created_at DESC`,
        [principal.organizationId],
      );
      response.json({ items: applications.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/external-apps', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createExternalAppSchema.parse(request.body);
      const application = await withTransaction(pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO external_apps (key, name, managing_organization_id)
           VALUES ($1, $2, $3)
           RETURNING id, key, name, status, created_at AS "createdAt"`,
          [input.key, input.name, principal.organizationId],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'integration.external_app_created', 'external_app', $3,
                   jsonb_build_object('key', $4::text))`,
          [principal.organizationId, principal.actorId, inserted.rows[0].id, input.key],
        );
        return inserted.rows[0];
      });
      response.status(201).json({ application });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return next(new IdentityError(409, 'external_app_key_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/external-apps/:externalAppId/disable', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const externalAppId = identifierSchema.parse(request.params.externalAppId);
      const application = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE external_apps
              SET status = 'disabled'
            WHERE id = $1 AND managing_organization_id = $2 AND status = 'active'
          RETURNING id, key, name, status`,
          [externalAppId, principal.organizationId],
        );
        if (updated.rowCount !== 1) throw new IdentityError(404, 'active_external_app_not_found');
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'integration.external_app_disabled', 'external_app', $3, '{}'::jsonb)`,
          [principal.organizationId, principal.actorId, externalAppId],
        );
        return updated.rows[0];
      });
      response.json({ application });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/integration-keys', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createIntegrationKeyMetadataSchema.parse(request.body);
      if (input.retiringValidUntil && new Date(input.retiringValidUntil).getTime() <= Date.now()) {
        throw new IdentityError(400, 'retiring_key_valid_until_must_be_future');
      }
      const integrationKey = await withTransaction(pool, async (client) => {
        const application = await client.query(
          `SELECT 1 FROM external_apps
            WHERE id = $1 AND managing_organization_id = $2 AND status = 'active'
            FOR UPDATE`,
          [input.externalAppId, principal.organizationId],
        );
        if (application.rowCount !== 1)
          throw new IdentityError(404, 'active_external_app_not_found');
        if (input.retiringKeyId && input.retiringValidUntil) {
          const retiring = await client.query(
            `UPDATE integration_keys
                SET status = 'retiring', valid_until = $3::timestamptz
              WHERE external_app_id = $1 AND key_id = $2
                AND status IN ('active', 'retiring')
            RETURNING id`,
            [input.externalAppId, input.retiringKeyId, input.retiringValidUntil],
          );
          if (retiring.rowCount !== 1) throw new IdentityError(404, 'retiring_key_not_found');
        }
        const inserted = await client.query(
          `INSERT INTO integration_keys
              (external_app_id, key_id, secret_ref, valid_from, valid_until)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5::timestamptz)
           RETURNING id, external_app_id AS "externalAppId", key_id AS "keyId",
                     secret_ref AS "secretRef", status, valid_from AS "validFrom",
                     valid_until AS "validUntil", created_at AS "createdAt"`,
          [
            input.externalAppId,
            input.keyId,
            input.secretRef,
            input.validFrom ?? null,
            input.validUntil ?? null,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'integration.key_metadata_created', 'integration_key', $3,
                   jsonb_build_object('externalAppId', ($4::uuid)::text,
                                      'keyId', $5::text,
                                      'secretRef', $6::text,
                                      'retiringKeyId', $7::text))`,
          [
            principal.organizationId,
            principal.actorId,
            inserted.rows[0].id,
            input.externalAppId,
            input.keyId,
            input.secretRef,
            input.retiringKeyId ?? null,
          ],
        );
        return inserted.rows[0];
      });
      response.status(201).json({ integrationKey });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return next(new IdentityError(409, 'integration_key_id_conflict'));
      }
      next(error);
    }
  });

  app.post('/api/v1/integration-keys/:integrationKeyId/revoke', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const integrationKeyId = identifierSchema.parse(request.params.integrationKeyId);
      const integrationKey = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE integration_keys ik
              SET status = 'revoked', valid_until = LEAST(COALESCE(valid_until, now()), now())
             FROM external_apps ea
            WHERE ik.id = $1
              AND ea.id = ik.external_app_id
              AND ea.managing_organization_id = $2
              AND ik.status IN ('active', 'retiring')
          RETURNING ik.id, ik.external_app_id AS "externalAppId", ik.key_id AS "keyId",
                    ik.status, ik.valid_until AS "validUntil"`,
          [integrationKeyId, principal.organizationId],
        );
        if (updated.rowCount !== 1)
          throw new IdentityError(404, 'active_integration_key_not_found');
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'integration.key_revoked', 'integration_key', $3, '{}'::jsonb)`,
          [principal.organizationId, principal.actorId, integrationKeyId],
        );
        return updated.rows[0];
      });
      response.json({ integrationKey });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/external-workspace-mappings', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createExternalTenantMappingSchema.parse(request.body);
      const mapping = await withTransaction(pool, async (client) => {
        const application = await client.query(
          `SELECT 1 FROM external_apps
            WHERE id = $1 AND managing_organization_id = $2 AND status = 'active'
            FOR UPDATE`,
          [input.externalAppId, principal.organizationId],
        );
        if (application.rowCount !== 1)
          throw new IdentityError(404, 'active_external_app_not_found');
        const workspace = await client.query(
          `SELECT 1 FROM workspaces
            WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
          [input.workspaceId, principal.organizationId],
        );
        if (workspace.rowCount !== 1) throw new IdentityError(404, 'workspace_not_found');

        const existingTenant = await client.query<{
          id: string;
          organizationId: string;
        }>(
          `SELECT id, organization_id AS "organizationId"
             FROM external_tenants
            WHERE external_app_id = $1 AND external_tenant_ref = $2
            FOR UPDATE`,
          [input.externalAppId, input.externalTenantRef],
        );
        if (
          existingTenant.rows[0] &&
          existingTenant.rows[0].organizationId !== principal.organizationId
        ) {
          throw new IdentityError(409, 'external_tenant_ref_owned_elsewhere');
        }
        let externalTenantId = existingTenant.rows[0]?.id;
        if (!externalTenantId) {
          const insertedTenant = await client.query<{ id: string }>(
            `INSERT INTO external_tenants
                (external_app_id, external_tenant_ref, organization_id)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [input.externalAppId, input.externalTenantRef, principal.organizationId],
          );
          externalTenantId = insertedTenant.rows[0]!.id;
        }

        const existingMapping = await client.query<{
          id: string;
          workspaceId: string;
        }>(
          `SELECT id, workspace_id AS "workspaceId"
             FROM external_workspace_mappings
            WHERE external_tenant_id = $1 AND external_workspace_ref = $2
            FOR UPDATE`,
          [externalTenantId, input.externalWorkspaceRef],
        );
        if (existingMapping.rows[0] && existingMapping.rows[0].workspaceId !== input.workspaceId) {
          throw new IdentityError(409, 'external_workspace_ref_conflict');
        }
        const mapped = existingMapping.rows[0]
          ? await client.query(
              `UPDATE external_workspace_mappings
                  SET status = 'active'
                WHERE id = $1
              RETURNING id, external_tenant_id AS "externalTenantId",
                        organization_id AS "organizationId", workspace_id AS "workspaceId",
                        external_workspace_ref AS "externalWorkspaceRef", status`,
              [existingMapping.rows[0].id],
            )
          : await client.query(
              `INSERT INTO external_workspace_mappings
                  (external_tenant_id, organization_id, workspace_id, external_workspace_ref)
               VALUES ($1, $2, $3, $4)
               RETURNING id, external_tenant_id AS "externalTenantId",
                         organization_id AS "organizationId", workspace_id AS "workspaceId",
                         external_workspace_ref AS "externalWorkspaceRef", status`,
              [
                externalTenantId,
                principal.organizationId,
                input.workspaceId,
                input.externalWorkspaceRef,
              ],
            );
        if (input.callbackOrigin) {
          await client.query(
            `INSERT INTO integration_callback_allowlist
                (external_tenant_id, callback_origin, path_prefix)
             VALUES ($1, $2, $3)
             ON CONFLICT (external_tenant_id, callback_origin, path_prefix)
             DO UPDATE SET status = 'active'`,
            [externalTenantId, input.callbackOrigin, input.callbackPathPrefix],
          );
        }
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'integration.workspace_mapping_created',
                   'external_workspace_mapping', $3,
                   jsonb_build_object('externalAppId', ($4::uuid)::text,
                                      'externalTenantRef', $5::text,
                                      'externalWorkspaceRef', $6::text,
                                      'workspaceId', ($7::uuid)::text,
                                      'callbackAllowlisted', $8::boolean))`,
          [
            principal.organizationId,
            principal.actorId,
            mapped.rows[0].id,
            input.externalAppId,
            input.externalTenantRef,
            input.externalWorkspaceRef,
            input.workspaceId,
            Boolean(input.callbackOrigin),
          ],
        );
        return mapped.rows[0];
      });
      response.status(201).json({ mapping });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/v1/external-workspace-mappings/:mappingId/disable',
    async (request, response, next) => {
      try {
        assertCsrfForCookieRequest(request);
        const principal = await loadPrincipal(request, pool, sessionSecret);
        await requireAdministrativeRole(pool, principal);
        const mappingId = identifierSchema.parse(request.params.mappingId);
        const mapping = await withTransaction(pool, async (client) => {
          const updated = await client.query(
            `UPDATE external_workspace_mappings
                SET status = 'disabled'
              WHERE id = $1 AND organization_id = $2 AND status = 'active'
            RETURNING id, external_tenant_id AS "externalTenantId", workspace_id AS "workspaceId",
                      external_workspace_ref AS "externalWorkspaceRef", status`,
            [mappingId, principal.organizationId],
          );
          if (updated.rowCount !== 1) throw new IdentityError(404, 'active_mapping_not_found');
          await client.query(
            `INSERT INTO audit_events
                (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
             VALUES ($1, $2, 'integration.workspace_mapping_disabled',
                     'external_workspace_mapping', $3, '{}'::jsonb)`,
            [principal.organizationId, principal.actorId, mappingId],
          );
          return updated.rows[0];
        });
        response.json({ mapping });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/v1/invitations', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      await pool.query(
        `UPDATE organization_invitations
            SET status = 'expired'
          WHERE organization_id = $1 AND status = 'pending' AND expires_at <= now()`,
        [principal.organizationId],
      );
      const invitations = await pool.query(
        `SELECT i.id, i.organization_id AS "organizationId", i.workspace_id AS "workspaceId",
                w.name AS "workspaceName", i.normalized_email AS email, i.role, i.status,
                i.expires_at AS "expiresAt", i.created_at AS "createdAt"
           FROM organization_invitations i
           LEFT JOIN workspaces w
             ON w.organization_id = i.organization_id
            AND w.id = i.workspace_id
          WHERE i.organization_id = $1
          ORDER BY i.created_at DESC`,
        [principal.organizationId],
      );
      response.json({ items: invitations.rows });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/invitations/:invitationId/revoke', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const invitationId = identifierSchema.parse(request.params.invitationId);
      const invitation = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE organization_invitations
              SET status = 'revoked'
            WHERE id = $1 AND organization_id = $2 AND status = 'pending'
          RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                    normalized_email AS email, role, status, expires_at AS "expiresAt"`,
          [invitationId, principal.organizationId],
        );
        if (updated.rowCount !== 1) {
          throw new IdentityError(404, 'pending_invitation_not_found');
        }
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $3, 'identity.invitation_revoked', 'invitation', $4,
                   jsonb_build_object('workspaceId', $2::text))`,
          [principal.organizationId, principal.workspaceId, principal.actorId, invitationId],
        );
        return updated.rows[0];
      });
      response.json({ invitation });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/invitations', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createInvitationSchema.parse({
        ...request.body,
        organizationId: principal.organizationId,
        workspaceId: request.body.workspaceId ?? principal.workspaceId,
        actorId: principal.actorId,
      });
      const workspaceId = input.workspaceId ?? principal.workspaceId;
      const token = randomBytes(32).toString('base64url');
      const invitation = await withTransaction(pool, async (client) => {
        const workspace = await client.query(
          `SELECT 1 FROM workspaces
            WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
          [workspaceId, principal.organizationId],
        );
        if (workspace.rowCount !== 1) throw new IdentityError(404, 'workspace_not_found');
        await client.query(
          `UPDATE organization_invitations
              SET status = 'expired'
            WHERE organization_id = $1 AND workspace_id = $2 AND normalized_email = $3
              AND status = 'pending' AND expires_at <= now()`,
          [principal.organizationId, workspaceId, input.email],
        );
        const inserted = await client.query(
          `INSERT INTO organization_invitations
              (organization_id, workspace_id, normalized_email, role, token_digest,
               invited_by_actor_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::text || ' hours')::interval)
           RETURNING id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                     normalized_email AS email, role, status, expires_at AS "expiresAt"`,
          [
            principal.organizationId,
            workspaceId,
            input.email,
            input.role,
            digest(token),
            principal.actorId,
            input.expiresInHours,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $3, 'identity.invitation_created', 'invitation', $4,
                   jsonb_build_object('workspaceId', $2::text,
                                      'email', $5::text,
                                      'role', $6::text))`,
          [
            principal.organizationId,
            workspaceId,
            principal.actorId,
            inserted.rows[0].id,
            input.email,
            input.role,
          ],
        );
        return inserted.rows[0];
      });
      response.status(201).json({ invitation, token, delivery: 'manual_link' });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        return next(new IdentityError(409, 'invitation_already_pending'));
      }
      next(error);
    }
  });

  app.post('/api/v1/invitations/accept', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      const input = acceptInvitationSchema.parse(request.body);
      const result = await withTransaction(pool, async (client) => {
        const invitation = await client.query<{
          id: string;
          organizationId: string;
          workspaceId: string;
          email: string;
          role: OrganizationRole;
        }>(
          `SELECT id, organization_id AS "organizationId", workspace_id AS "workspaceId",
                  normalized_email AS email, role
             FROM organization_invitations
            WHERE token_digest = $1 AND status = 'pending' AND expires_at > now()
            FOR UPDATE`,
          [digest(input.token)],
        );
        const invite = invitation.rows[0];
        if (!invite) throw new IdentityError(404, 'invitation_not_found_or_expired');
        if (invite.email !== principal.email.toLowerCase()) {
          throw new IdentityError(403, 'invitation_email_mismatch');
        }
        const existingActor = await client.query<{ actorId: string }>(
          `SELECT ai.actor_id AS "actorId"
             FROM actor_identities ai
             JOIN actors a ON a.id = ai.actor_id
            WHERE ai.user_id = $1 AND a.organization_id = $2
            LIMIT 1`,
          [principal.userId, invite.organizationId],
        );
        let actorId = existingActor.rows[0]?.actorId;
        if (!actorId) {
          const actor = await client.query<{ id: string }>(
            `INSERT INTO actors (organization_id, kind, external_subject, display_name)
             VALUES ($1, 'human', $2, $3) RETURNING id`,
            [invite.organizationId, `user:${principal.userId}`, principal.displayName],
          );
          actorId = actor.rows[0]!.id;
          await client.query(`INSERT INTO actor_identities (actor_id, user_id) VALUES ($1, $2)`, [
            actorId,
            principal.userId,
          ]);
        }
        await client.query(
          `INSERT INTO members (organization_id, actor_id, role, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (organization_id, actor_id)
           DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
          [invite.organizationId, actorId, invite.role],
        );
        await client.query(
          `INSERT INTO workspace_memberships
              (organization_id, workspace_id, actor_id, role, status)
           VALUES ($1, $2, $3, $4, 'active')
           ON CONFLICT (workspace_id, actor_id)
           DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`,
          [invite.organizationId, invite.workspaceId, actorId, invite.role],
        );
        await client.query(
          `UPDATE organization_invitations
              SET status = 'accepted', accepted_by_actor_id = $1, accepted_at = now()
            WHERE id = $2`,
          [actorId, invite.id],
        );
        await client.query(
          `INSERT INTO audit_events
              (organization_id, actor_id, event_type, subject_type, subject_id, metadata)
           VALUES ($1, $2, 'identity.invitation_accepted', 'invitation', $3,
                   jsonb_build_object('workspaceId', ($4::uuid)::text, 'role', $5::text))`,
          [invite.organizationId, actorId, invite.id, invite.workspaceId, invite.role],
        );
        await client.query(`UPDATE identity_sessions SET revoked_at = now() WHERE id = $1`, [
          principal.sessionId,
        ]);
        const session = await issueSession(
          client,
          {
            userId: principal.userId,
            organizationId: invite.organizationId,
            workspaceId: invite.workspaceId,
            actorId,
          },
          sessionSecret,
        );
        return {
          session,
          context: {
            organizationId: invite.organizationId,
            workspaceId: invite.workspaceId,
            actorId,
            role: invite.role,
          },
        };
      });
      setSessionCookies(response, result.session);
      response.json({ context: result.context, csrfToken: result.session.csrfToken });
    } catch (error) {
      next(error);
    }
  });
}
