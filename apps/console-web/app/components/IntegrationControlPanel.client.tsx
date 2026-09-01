import { m } from '@casioplus/i18n/messages';
import { useEffect, useMemo, useState } from 'react';
import { Ban, KeyRound, Link2, PlugZap, RefreshCw, RotateCw } from 'lucide-react';
import { requestControlPlaneJson } from './control-plane-api.client.js';

type Workspace = {
  id: string;
  name: string;
  status: string;
};

type IntegrationKey = {
  id: string;
  keyId: string;
  secretRef: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
};

type ExternalMapping = {
  id: string;
  externalTenantRef: string;
  externalWorkspaceRef: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  createdAt: string;
};

type ExternalApplication = {
  id: string;
  key: string;
  name: string;
  status: string;
  createdAt: string;
  keys: IntegrationKey[];
  mappings: ExternalMapping[];
};

export default function IntegrationControlPanel({
  apiBase,
  csrfToken,
  organizationId,
  workspaces,
  onNotice,
  onError,
}: {
  apiBase: string;
  csrfToken: string;
  organizationId: string;
  workspaces: Workspace[];
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [applications, setApplications] = useState<ExternalApplication[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  const [applicationName, setApplicationName] = useState('');
  const [applicationKey, setApplicationKey] = useState('');
  const [keyId, setKeyId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [retiringKeyId, setRetiringKeyId] = useState('');
  const [retiringValidUntil, setRetiringValidUntil] = useState('');
  const [externalTenantRef, setExternalTenantRef] = useState('');
  const [externalWorkspaceRef, setExternalWorkspaceRef] = useState('');
  const [mappingWorkspaceId, setMappingWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [callbackOrigin, setCallbackOrigin] = useState('');
  const [callbackPathPrefix, setCallbackPathPrefix] = useState('/');

  const selectedApplication = useMemo(
    () => applications.find((application) => application.id === selectedApplicationId) ?? null,
    [applications, selectedApplicationId],
  );

  const loadApplications = async () => {
    setLoading(true);
    try {
      const response = await requestControlPlaneJson<{ items: ExternalApplication[] }>(
        apiBase,
        '/api/v1/external-apps',
        csrfToken,
      );
      setApplications(response.items);
      setSelectedApplicationId((current) => {
        if (response.items.some((application) => application.id === current)) return current;
        return response.items.find((application) => application.status === 'active')?.id ?? '';
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_app_load_failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setApplications([]);
    setSelectedApplicationId('');
    void loadApplications();
    // Refresh when the server-authoritative organization changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  useEffect(() => {
    setMappingWorkspaceId((current) =>
      workspaces.some((workspace) => workspace.id === current)
        ? current
        : (workspaces[0]?.id ?? ''),
    );
  }, [workspaces]);

  const createApplication = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await requestControlPlaneJson<{ application: ExternalApplication }>(
        apiBase,
        '/api/v1/external-apps',
        csrfToken,
        {
          method: 'POST',
          body: JSON.stringify({ key: applicationKey, name: applicationName }),
        },
      );
      setApplicationName('');
      setApplicationKey('');
      setSelectedApplicationId(response.application.id);
      onNotice(m.console_integration_app_created_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_app_creation_failed');
    }
  };

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplicationId) return;
    try {
      await requestControlPlaneJson(apiBase, '/api/v1/integration-keys', csrfToken, {
        method: 'POST',
        body: JSON.stringify({
          externalAppId: selectedApplicationId,
          keyId,
          secretRef,
          ...(retiringKeyId && retiringValidUntil
            ? {
                retiringKeyId,
                retiringValidUntil: new Date(retiringValidUntil).toISOString(),
              }
            : {}),
        }),
      });
      setKeyId('');
      setSecretRef('');
      setRetiringKeyId('');
      setRetiringValidUntil('');
      onNotice(m.console_integration_key_created_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'integration_key_creation_failed');
    }
  };

  const createMapping = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedApplicationId || !mappingWorkspaceId) return;
    try {
      await requestControlPlaneJson(apiBase, '/api/v1/external-workspace-mappings', csrfToken, {
        method: 'POST',
        body: JSON.stringify({
          externalAppId: selectedApplicationId,
          externalTenantRef,
          workspaceId: mappingWorkspaceId,
          externalWorkspaceRef,
          ...(callbackOrigin
            ? { callbackOrigin, callbackPathPrefix: callbackPathPrefix || '/' }
            : {}),
        }),
      });
      setExternalTenantRef('');
      setExternalWorkspaceRef('');
      setCallbackOrigin('');
      setCallbackPathPrefix('/');
      onNotice(m.console_integration_mapping_created_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_mapping_creation_failed');
    }
  };

  const revokeKey = async (integrationKeyId: string) => {
    try {
      await requestControlPlaneJson(
        apiBase,
        `/api/v1/integration-keys/${integrationKeyId}/revoke`,
        csrfToken,
        { method: 'POST' },
      );
      onNotice(m.console_integration_key_revoked_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'integration_key_revoke_failed');
    }
  };

  const disableMapping = async (mappingId: string) => {
    try {
      await requestControlPlaneJson(
        apiBase,
        `/api/v1/external-workspace-mappings/${mappingId}/disable`,
        csrfToken,
        { method: 'POST' },
      );
      onNotice(m.console_integration_mapping_disabled_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_mapping_disable_failed');
    }
  };

  const disableApplication = async (externalAppId: string) => {
    try {
      await requestControlPlaneJson(
        apiBase,
        `/api/v1/external-apps/${externalAppId}/disable`,
        csrfToken,
        { method: 'POST' },
      );
      onNotice(m.console_integration_app_disabled_notice());
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_app_disable_failed');
    }
  };

  return (
    <section className="integration-control" aria-labelledby="integration-control-title">
      <header className="organization-control-heading">
        <div>
          <span>{m.console_integration_control_plane_label()}</span>
          <h3 id="integration-control-title">{m.console_integration_control_title()}</h3>
          <p>{m.console_integration_control_description()}</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void loadApplications()}>
          <RefreshCw size={15} />{' '}
          {loading ? m.console_integration_syncing() : m.console_integration_refresh()}
        </button>
      </header>

      <div className="integration-control-grid">
        <form className="control-block" onSubmit={createApplication}>
          <div className="control-block-title">
            <PlugZap size={18} />
            <div>
              <strong>{m.console_integration_new_app_title()}</strong>
              <span>{m.console_integration_new_app_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_integration_name_label()}
            <input
              required
              value={applicationName}
              onChange={(event) => setApplicationName(event.target.value)}
            />
          </label>
          <label>
            {m.console_integration_key_label()}
            <input
              required
              dir="ltr"
              pattern="[a-z][a-z0-9-]{1,63}"
              value={applicationKey}
              onChange={(event) => setApplicationKey(event.target.value)}
            />
          </label>
          <button className="secondary-action" type="submit">
            {m.console_integration_submit_app()}
          </button>
        </form>

        <article className="control-block integration-selection">
          <div className="control-block-title">
            <PlugZap size={18} />
            <div>
              <strong>{m.console_integration_active_app_title()}</strong>
              <span>{m.console_integration_active_app_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_integration_application_label()}
            <select
              value={selectedApplicationId}
              onChange={(event) => setSelectedApplicationId(event.target.value)}
            >
              <option value="">{m.console_integration_select_placeholder()}</option>
              {applications.map((application) => (
                <option
                  key={application.id}
                  value={application.id}
                  disabled={application.status !== 'active'}
                >
                  {application.name} — {application.status}
                </option>
              ))}
            </select>
          </label>
          {selectedApplication ? (
            <dl>
              <div>
                <dt>{m.console_integration_key_label()}</dt>
                <dd dir="ltr">{selectedApplication.key}</dd>
              </div>
              <div>
                <dt>{m.console_integration_keys_heading()}</dt>
                <dd>{selectedApplication.keys.length}</dd>
              </div>
              <div>
                <dt>{m.console_integration_mappings_heading()}</dt>
                <dd>{selectedApplication.mappings.length}</dd>
              </div>
            </dl>
          ) : (
            <div className="control-empty">{m.console_integration_no_active_app()}</div>
          )}
        </article>

        <form className="control-block" onSubmit={createKey}>
          <div className="control-block-title">
            <KeyRound size={18} />
            <div>
              <strong>{m.console_integration_key_meta_title()}</strong>
              <span>{m.console_integration_key_meta_desc()}</span>
            </div>
          </div>
          <label>
            {m.console_integration_key_id_label()}
            <input
              required
              dir="ltr"
              pattern="[A-Za-z0-9._-]{3,100}"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
          </label>
          <label>
            {m.console_integration_secret_ref_label()}
            <input
              required
              dir="ltr"
              pattern="[A-Z][A-Z0-9_]{2,127}"
              placeholder="CASIOPLUS_CLIENT_KEY_V1"
              value={secretRef}
              onChange={(event) => setSecretRef(event.target.value)}
            />
          </label>
          <div className="control-form-row">
            <label>
              {m.console_integration_retiring_key_label()}
              <select
                value={retiringKeyId}
                onChange={(event) => setRetiringKeyId(event.target.value)}
              >
                <option value="">{m.console_integration_no_rotation()}</option>
                {selectedApplication?.keys
                  .filter((item) => item.status === 'active' || item.status === 'retiring')
                  .map((item) => (
                    <option key={item.id} value={item.keyId}>
                      {item.keyId}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {m.console_integration_prev_key_validity_label()}
              <input
                type="datetime-local"
                disabled={!retiringKeyId}
                required={Boolean(retiringKeyId)}
                value={retiringValidUntil}
                onChange={(event) => setRetiringValidUntil(event.target.value)}
              />
            </label>
          </div>
          <button className="secondary-action" disabled={!selectedApplicationId} type="submit">
            {m.console_integration_submit_metadata()}
          </button>
        </form>

        <form className="control-block integration-mapping-form" onSubmit={createMapping}>
          <div className="control-block-title">
            <Link2 size={18} />
            <div>
              <strong>{m.console_integration_mapping_title()}</strong>
              <span>{m.console_integration_mapping_desc()}</span>
            </div>
          </div>
          <div className="control-form-row">
            <label>
              {m.console_integration_ext_tenant_ref_label()}
              <input
                required
                dir="ltr"
                value={externalTenantRef}
                onChange={(event) => setExternalTenantRef(event.target.value)}
              />
            </label>
            <label>
              {m.console_integration_ext_workspace_ref_label()}
              <input
                required
                dir="ltr"
                value={externalWorkspaceRef}
                onChange={(event) => setExternalWorkspaceRef(event.target.value)}
              />
            </label>
          </div>
          <label>
            {m.console_integration_dest_workspace_label()}
            <select
              required
              value={mappingWorkspaceId}
              onChange={(event) => setMappingWorkspaceId(event.target.value)}
            >
              {workspaces
                .filter((workspace) => workspace.status === 'active')
                .map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="control-form-row">
            <label>
              {m.console_integration_callback_origin_label()}
              <input
                type="url"
                dir="ltr"
                placeholder="https://callbacks.example.com"
                value={callbackOrigin}
                onChange={(event) => setCallbackOrigin(event.target.value)}
              />
            </label>
            <label>
              {m.console_integration_path_prefix_label()}
              <input
                dir="ltr"
                pattern="/.*"
                disabled={!callbackOrigin}
                value={callbackPathPrefix}
                onChange={(event) => setCallbackPathPrefix(event.target.value)}
              />
            </label>
          </div>
          <button
            className="secondary-action"
            disabled={!selectedApplicationId || !mappingWorkspaceId}
            type="submit"
          >
            {m.console_integration_submit_mapping()}
          </button>
        </form>
      </div>

      <div className="integration-records">
        {applications.length === 0 ? (
          <div className="control-empty">{m.console_integration_no_app_registered()}</div>
        ) : (
          applications.map((application) => (
            <article key={application.id} className="integration-record">
              <header>
                <div>
                  <strong>{application.name}</strong>
                  <span dir="ltr">{application.key}</span>
                </div>
                <b>{application.status}</b>
                <button
                  className="danger-text-action"
                  type="button"
                  disabled={application.status !== 'active'}
                  onClick={() => void disableApplication(application.id)}
                >
                  <Ban size={14} /> {m.console_integration_disable_action()}
                </button>
              </header>
              <div className="integration-record-columns">
                <div>
                  <h4>
                    <KeyRound size={14} /> {m.console_integration_keys_heading()}
                  </h4>
                  {application.keys.length === 0 ? (
                    <p>{m.console_integration_no_key_metadata()}</p>
                  ) : (
                    application.keys.map((item) => (
                      <div className="integration-record-row" key={item.id}>
                        <div>
                          <strong dir="ltr">{item.keyId}</strong>
                          <span dir="ltr">{item.secretRef}</span>
                        </div>
                        <b>{item.status}</b>
                        <button
                          className="danger-text-action"
                          type="button"
                          disabled={!['active', 'retiring'].includes(item.status)}
                          onClick={() => void revokeKey(item.id)}
                        >
                          <RotateCw size={13} /> {m.console_integration_revoke_action()}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <h4>
                    <Link2 size={14} /> {m.console_integration_mappings_heading()}
                  </h4>
                  {application.mappings.length === 0 ? (
                    <p>{m.console_integration_no_workspace_mapping()}</p>
                  ) : (
                    application.mappings.map((item) => (
                      <div className="integration-record-row" key={item.id}>
                        <div>
                          <strong>{item.workspaceName}</strong>
                          <span dir="ltr">
                            {item.externalTenantRef} / {item.externalWorkspaceRef}
                          </span>
                        </div>
                        <b>{item.status}</b>
                        <button
                          className="danger-text-action"
                          type="button"
                          disabled={item.status !== 'active'}
                          onClick={() => void disableMapping(item.id)}
                        >
                          {m.console_integration_disable_action()}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
