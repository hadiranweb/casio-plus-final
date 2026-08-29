import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  createOrganizationSchema,
  createWorkspaceSchema,
  loginSchema,
  registerAccountSchema,
} from '../../../packages/contracts/src/index.js';
import {
  assertCsrfForCookieRequest,
  createCsrfToken,
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
      response.status(201).json({ user: result.user, context: result.context });
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
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/session', async (request, response, next) => {
    try {
      const principal = await loadPrincipal(request, pool, sessionSecret);
      response.json(publicPrincipal(principal));
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
           JOIN workspaces w ON w.id = wm.workspace_id AND w.organization_id = o.id
          WHERE ai.user_id = $1 AND o.id = $2
          ORDER BY o.name, w.name`,
        [principal.userId, principal.organizationId],
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
      response.status(201).json({ context: result.context });
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
        return inserted.rows[0];
      });
      response.status(201).json({ workspace });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/invitations', async (request, response, next) => {
    try {
      assertCsrfForCookieRequest(request);
      const principal = await loadPrincipal(request, pool, sessionSecret);
      await requireAdministrativeRole(pool, principal);
      const input = createInvitationSchema.parse({ ...request.body, ...principal });
      const workspaceId = input.workspaceId ?? principal.workspaceId;
      const workspace = await pool.query(
        `SELECT 1 FROM workspaces
          WHERE id = $1 AND organization_id = $2 AND status = 'active'`,
        [workspaceId, principal.organizationId],
      );
      if (workspace.rowCount !== 1) throw new IdentityError(404, 'workspace_not_found');
      const token = randomBytes(32).toString('base64url');
      const invitation = await pool.query(
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
      response.status(201).json({ invitation: invitation.rows[0], token });
    } catch (error) {
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
      response.json({ context: result.context });
    } catch (error) {
      next(error);
    }
  });
}
