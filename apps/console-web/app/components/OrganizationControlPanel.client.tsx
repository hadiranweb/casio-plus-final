import { formatDateTime } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Clipboard,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { requestControlPlaneJson as requestJson } from './control-plane-api.client.js';
import IntegrationControlPanel from './IntegrationControlPanel.client.js';

export type OrganizationScope = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  actorId: string;
  role: string;
};

type Workspace = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  role: string;
  membershipStatus: string;
  createdAt: string;
};

type Member = {
  actorId: string;
  displayName: string;
  email: string | null;
  organizationRole: string;
  status: string;
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    role: string;
    status: string;
  }>;
};

type Invitation = {
  id: string;
  organizationId: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

function formatDate(value: string) {
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrganizationControlPanel({
  apiBase,
  csrfToken,
  currentActorId,
  currentRole,
  currentScope,
  availableScopes,
  onContextChanged,
  onNotice,
  onError,
}: {
  apiBase: string;
  csrfToken: string;
  currentActorId: string;
  currentRole: string;
  currentScope: OrganizationScope | null;
  availableScopes: OrganizationScope[];
  onContextChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const canAdminister = currentRole === 'owner' || currentRole === 'admin';
  const [loading, setLoading] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [organizationWorkspaceName, setOrganizationWorkspaceName] = useState('');
  const [organizationWorkspaceSlug, setOrganizationWorkspaceSlug] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteWorkspaceId, setInviteWorkspaceId] = useState(currentScope?.workspaceId ?? '');
  const [acceptToken, setAcceptToken] = useState('');
  const [latestInviteLink, setLatestInviteLink] = useState('');

  const groupedScopes = useMemo(() => {
    const organizations = new Map<string, { name: string; scopes: OrganizationScope[] }>();
    for (const scope of availableScopes) {
      const existing = organizations.get(scope.organizationId) ?? {
        name: scope.organizationName,
        scopes: [],
      };
      existing.scopes.push(scope);
      organizations.set(scope.organizationId, existing);
    }
    return [...organizations.entries()];
  }, [availableScopes]);

  const loadControlData = async () => {
    setLoading(true);
    try {
      const workspaceResponse = await requestJson<{ items: Workspace[] }>(
        apiBase,
        '/api/v1/workspaces',
        csrfToken,
      );
      setWorkspaces(workspaceResponse.items);
      setInviteWorkspaceId((current) => current || currentScope?.workspaceId || '');
      if (canAdminister) {
        const [memberResponse, invitationResponse] = await Promise.all([
          requestJson<{ items: Member[] }>(apiBase, '/api/v1/members', csrfToken),
          requestJson<{ items: Invitation[] }>(apiBase, '/api/v1/invitations', csrfToken),
        ]);
        setMembers(memberResponse.items);
        setInvitations(invitationResponse.items);
      } else {
        setMembers([]);
        setInvitations([]);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'organization_control_load_failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadControlData();
    // Refresh when the server-authoritative organization or role changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScope?.organizationId, currentRole]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite');
    if (token) setAcceptToken(token);
  }, []);

  const switchContext = async (value: string) => {
    const [organizationId, workspaceId] = value.split(':');
    if (!organizationId || !workspaceId || workspaceId === currentScope?.workspaceId) return;
    try {
      await requestJson(apiBase, '/api/v1/auth/switch-context', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ organizationId, workspaceId }),
      });
      setLatestInviteLink('');
      onNotice(m.console_organization_context_changed());
      await onContextChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'context_switch_failed');
    }
  };

  const createOrganization = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await requestJson(apiBase, '/api/v1/organizations', csrfToken, {
        method: 'POST',
        body: JSON.stringify({
          name: organizationName,
          slug: organizationSlug,
          workspaceName: organizationWorkspaceName,
          workspaceSlug: organizationWorkspaceSlug,
        }),
      });
      setOrganizationName('');
      setOrganizationSlug('');
      setOrganizationWorkspaceName('');
      setOrganizationWorkspaceSlug('');
      onNotice(m.console_organization_created());
      await onContextChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'organization_creation_failed');
    }
  };

  const createWorkspace = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await requestJson(apiBase, '/api/v1/workspaces', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ name: workspaceName, slug: workspaceSlug }),
      });
      setWorkspaceName('');
      setWorkspaceSlug('');
      onNotice(m.console_organization_workspace_created());
      await Promise.all([loadControlData(), onContextChanged()]);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'workspace_creation_failed');
    }
  };

  const createInvitation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const result = await requestJson<{ invitation: Invitation; token: string }>(
        apiBase,
        '/api/v1/invitations',
        csrfToken,
        {
          method: 'POST',
          body: JSON.stringify({
            email: inviteEmail,
            role: inviteRole,
            workspaceId: inviteWorkspaceId,
            expiresInHours: 168,
          }),
        },
      );
      const link = `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`;
      setLatestInviteLink(link);
      setInviteEmail('');
      onNotice(m.console_organization_invitation_created());
      await loadControlData();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'invitation_creation_failed');
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(latestInviteLink);
      onNotice(m.console_organization_invite_link_copied());
    } catch {
      onError('clipboard_unavailable');
    }
  };

  const acceptInvitation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await requestJson(apiBase, '/api/v1/invitations/accept', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ token: acceptToken }),
      });
      window.history.replaceState({}, '', window.location.pathname);
      setAcceptToken('');
      onNotice(m.console_organization_invitation_accepted());
      await onContextChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'invitation_acceptance_failed');
    }
  };

  const updateMember = async (
    actorId: string,
    update: { role?: string; status?: 'active' | 'revoked' },
  ) => {
    try {
      await requestJson(apiBase, `/api/v1/members/${actorId}`, csrfToken, {
        method: 'PATCH',
        body: JSON.stringify(update),
      });
      onNotice(
        update.status === 'revoked'
          ? m.console_organization_member_access_revoked()
          : m.console_organization_member_role_updated(),
      );
      await loadControlData();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'member_update_failed');
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    try {
      await requestJson(apiBase, `/api/v1/invitations/${invitationId}/revoke`, csrfToken, {
        method: 'POST',
      });
      onNotice(m.console_organization_invitation_revoked());
      await loadControlData();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'invitation_revoke_failed');
    }
  };

  return (
    <section
      className="organization-control"
      id="settings"
      aria-labelledby="organization-control-title"
    >
      <header className="organization-control-heading">
        <div>
          <span>{m.console_organization_control_plane_label()}</span>
          <h2 id="organization-control-title">{m.console_organization_title()}</h2>
          <p>{m.console_organization_subtitle()}</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void loadControlData()}>
          <RefreshCw size={15} />
          {loading ? m.console_organization_syncing() : m.console_organization_refresh()}
        </button>
      </header>

      <div className="control-plane-grid">
        <article className="control-block context-block">
          <div className="control-block-title">
            <Building2 size={18} />
            <div>
              <strong>{m.console_organization_active_context()}</strong>
              <span>{m.console_organization_context_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_organization_select_label()}
            <select
              value={
                currentScope ? `${currentScope.organizationId}:${currentScope.workspaceId}` : ''
              }
              onChange={(event) => void switchContext(event.target.value)}
            >
              {groupedScopes.map(([organizationId, organization]) => (
                <optgroup key={organizationId} label={organization.name}>
                  {organization.scopes.map((scope) => (
                    <option
                      key={`${scope.organizationId}:${scope.workspaceId}`}
                      value={`${scope.organizationId}:${scope.workspaceId}`}
                    >
                      {scope.workspaceName} — {scope.role}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <dl>
            <div>
              <dt>{m.console_organization_organization_label()}</dt>
              <dd>{currentScope?.organizationName ?? '—'}</dd>
            </div>
            <div>
              <dt>{m.console_organization_workspace_label()}</dt>
              <dd>{currentScope?.workspaceName ?? '—'}</dd>
            </div>
            <div>
              <dt>{m.console_organization_role_label()}</dt>
              <dd>{currentRole}</dd>
            </div>
          </dl>
        </article>

        <form className="control-block" onSubmit={createOrganization}>
          <div className="control-block-title">
            <Building2 size={18} />
            <div>
              <strong>{m.console_organization_new_organization()}</strong>
              <span>{m.console_organization_new_org_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_organization_name_label()}
            <input
              required
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
            />
          </label>
          <div className="control-form-row">
            <label>
              {m.console_organization_slug_label()}
              <input
                required
                dir="ltr"
                pattern="[a-z][a-z0-9-]{1,63}"
                value={organizationSlug}
                onChange={(event) => setOrganizationSlug(event.target.value)}
              />
            </label>
            <label>
              {m.console_organization_initial_workspace_label()}
              <input
                required
                value={organizationWorkspaceName}
                onChange={(event) => setOrganizationWorkspaceName(event.target.value)}
              />
            </label>
          </div>
          <label>
            {m.console_organization_initial_workspace_slug_label()}
            <input
              required
              dir="ltr"
              pattern="[a-z][a-z0-9-]{1,63}"
              value={organizationWorkspaceSlug}
              onChange={(event) => setOrganizationWorkspaceSlug(event.target.value)}
            />
          </label>
          <button className="secondary-action" type="submit">
            {m.console_organization_create_button()}
          </button>
        </form>

        <form className="control-block" onSubmit={acceptInvitation}>
          <div className="control-block-title">
            <CheckCircle2 size={18} />
            <div>
              <strong>{m.console_organization_accept_invite()}</strong>
              <span>{m.console_organization_accept_invite_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_organization_invitation_token()}
            <input
              required
              dir="ltr"
              minLength={32}
              value={acceptToken}
              onChange={(event) => setAcceptToken(event.target.value)}
            />
          </label>
          <button className="secondary-action" disabled={acceptToken.length < 32} type="submit">
            {m.console_organization_accept_button()}
          </button>
        </form>

        {canAdminister && (
          <form className="control-block" onSubmit={createWorkspace}>
            <div className="control-block-title">
              <Building2 size={18} />
              <div>
                <strong>{m.console_organization_new_workspace()}</strong>
                <span>{m.console_organization_new_workspace_desc()}</span>
              </div>
            </div>
            <label>
              {m.console_organization_workspace_name_label()}
              <input
                required
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
            <label>
              {m.console_organization_workspace_slug_label()}
              <input
                required
                dir="ltr"
                pattern="[a-z][a-z0-9-]{1,63}"
                value={workspaceSlug}
                onChange={(event) => setWorkspaceSlug(event.target.value)}
              />
            </label>
            <button className="secondary-action" type="submit">
              {m.console_organization_create_workspace_button()}
            </button>
          </form>
        )}

        {canAdminister && (
          <form className="control-block invite-block" onSubmit={createInvitation}>
            <div className="control-block-title">
              <MailPlus size={18} />
              <div>
                <strong>{m.console_organization_invite_member()}</strong>
                <span>{m.console_organization_invite_desc()}</span>
              </div>
            </div>
            <label>
              {m.console_organization_email_label()}
              <input
                required
                type="email"
                dir="ltr"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
              />
            </label>
            <div className="control-form-row">
              <label>
                {m.console_organization_workspace_label()}
                <select
                  required
                  value={inviteWorkspaceId}
                  onChange={(event) => setInviteWorkspaceId(event.target.value)}
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.console_organization_role_label()}
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}>
                  <option value="admin">{m.shared_role_admin()}</option>
                  <option value="editor">{m.shared_role_editor()}</option>
                  <option value="reviewer">{m.shared_role_reviewer()}</option>
                  <option value="viewer">{m.shared_role_viewer()}</option>
                  <option value="consumer">{m.shared_role_consumer()}</option>
                </select>
              </label>
            </div>
            <button className="secondary-action" type="submit">
              {m.console_organization_create_invite_button()}
            </button>
            {latestInviteLink && (
              <div className="invite-delivery" role="status">
                <code dir="ltr">{latestInviteLink}</code>
                <button type="button" onClick={() => void copyInviteLink()}>
                  <Clipboard size={14} /> {m.console_organization_copy_link()}
                </button>
              </div>
            )}
          </form>
        )}
      </div>

      {canAdminister && (
        <div className="organization-records">
          <article className="control-records-block">
            <div className="control-block-title">
              <Users size={18} />
              <div>
                <strong>{m.console_organization_members_title()}</strong>
                <span>
                  {members.length} {m.console_organization_members_count()}
                </span>
              </div>
            </div>
            {members.length === 0 ? (
              <div className="control-empty">{m.console_organization_no_members()}</div>
            ) : (
              <div
                className="control-table"
                role="region"
                aria-label={m.console_organization_members_aria()}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{m.console_organization_th_member()}</th>
                      <th>{m.console_organization_th_workspaces()}</th>
                      <th>{m.console_organization_role_label()}</th>
                      <th>{m.console_organization_th_status()}</th>
                      <th>{m.console_organization_th_action()}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.actorId}>
                        <td>
                          <strong>{member.displayName}</strong>
                          <span>{member.email ?? m.console_organization_no_account()}</span>
                        </td>
                        <td>
                          {member.workspaces.filter((item) => item.status === 'active').length}
                        </td>
                        <td>
                          {member.organizationRole === 'owner' ? (
                            <span>{member.organizationRole}</span>
                          ) : (
                            <select
                              aria-label={m.console_organization_member_role_aria({
                                name: member.displayName,
                              })}
                              value={member.organizationRole}
                              onChange={(event) =>
                                void updateMember(member.actorId, { role: event.target.value })
                              }
                            >
                              <option value="admin">{m.shared_role_admin()}</option>
                              <option value="editor">{m.shared_role_editor()}</option>
                              <option value="reviewer">{m.shared_role_reviewer()}</option>
                              <option value="viewer">{m.shared_role_viewer()}</option>
                              <option value="consumer">{m.shared_role_consumer()}</option>
                            </select>
                          )}
                        </td>
                        <td>{member.status}</td>
                        <td>
                          <button
                            className="danger-text-action"
                            type="button"
                            disabled={
                              member.actorId === currentActorId || member.status === 'revoked'
                            }
                            onClick={() => void updateMember(member.actorId, { status: 'revoked' })}
                          >
                            <UserMinus size={14} /> {m.console_organization_revoke_access()}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="control-records-block">
            <div className="control-block-title">
              <ShieldCheck size={18} />
              <div>
                <strong>{m.console_organization_invitations_title()}</strong>
                <span>{m.console_organization_invitations_desc()}</span>
              </div>
            </div>
            {invitations.length === 0 ? (
              <div className="control-empty">{m.console_organization_no_invitations()}</div>
            ) : (
              <div className="invitation-list">
                {invitations.map((invitation) => (
                  <div key={invitation.id}>
                    <div>
                      <strong>{invitation.email}</strong>
                      <span>
                        {invitation.workspaceName} · {invitation.role} ·{' '}
                        {formatDate(invitation.expiresAt)}
                      </span>
                    </div>
                    <b>{invitation.status}</b>
                    <button
                      className="danger-text-action"
                      type="button"
                      disabled={invitation.status !== 'pending'}
                      onClick={() => void revokeInvitation(invitation.id)}
                    >
                      {m.console_organization_revoke_button()}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      )}

      {canAdminister && (
        <IntegrationControlPanel
          apiBase={apiBase}
          csrfToken={csrfToken}
          organizationId={currentScope?.organizationId ?? ''}
          workspaces={workspaces}
          onNotice={onNotice}
          onError={onError}
        />
      )}
    </section>
  );
}
