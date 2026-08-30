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
      onNotice('ExternalApp ثبت شد. secret فقط خارج از PostgreSQL نگه‌داری می‌شود.');
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
      onNotice('Key metadata ثبت شد؛ مقدار secret وارد Casioplus نشد.');
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
      onNotice('ExternalTenant و Workspace mapping در Core resolve و ثبت شد.');
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
      onNotice('Key metadata revoke شد. secret manager باید طبق runbook rotate شود.');
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
      onNotice('External Workspace mapping غیرفعال شد.');
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
      onNotice('ExternalApp و تمام درخواست‌های جدید آن غیرفعال شد.');
      await loadApplications();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'external_app_disable_failed');
    }
  };

  return (
    <section className="integration-control" aria-labelledby="integration-control-title">
      <header className="organization-control-heading">
        <div>
          <span>CONTROL PLANE / INTEGRATION GATEWAY</span>
          <h3 id="integration-control-title">ExternalApp، کلیدها و mappingها</h3>
          <p>شناسه‌های خارجی assertion هستند؛ مقصد و privilege فقط در Core resolve می‌شوند.</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void loadApplications()}>
          <RefreshCw size={15} /> {loading ? 'در حال همگام‌سازی…' : 'تازه‌سازی'}
        </button>
      </header>

      <div className="integration-control-grid">
        <form className="control-block" onSubmit={createApplication}>
          <div className="control-block-title">
            <PlugZap size={18} />
            <div>
              <strong>ExternalApp جدید</strong>
              <span>مالک مدیریتی، Organization فعال است.</span>
            </div>
          </div>
          <label>
            نام
            <input
              required
              value={applicationName}
              onChange={(event) => setApplicationName(event.target.value)}
            />
          </label>
          <label>
            کلید
            <input
              required
              dir="ltr"
              pattern="[a-z][a-z0-9-]{1,63}"
              value={applicationKey}
              onChange={(event) => setApplicationKey(event.target.value)}
            />
          </label>
          <button className="secondary-action" type="submit">
            ثبت ExternalApp
          </button>
        </form>

        <article className="control-block integration-selection">
          <div className="control-block-title">
            <PlugZap size={18} />
            <div>
              <strong>ExternalApp فعال</strong>
              <span>تمام کنترل‌های پایین به همین application محدودند.</span>
            </div>
          </div>
          <label>
            Application
            <select
              value={selectedApplicationId}
              onChange={(event) => setSelectedApplicationId(event.target.value)}
            >
              <option value="">انتخاب کنید</option>
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
                <dt>Key</dt>
                <dd dir="ltr">{selectedApplication.key}</dd>
              </div>
              <div>
                <dt>Keys</dt>
                <dd>{selectedApplication.keys.length}</dd>
              </div>
              <div>
                <dt>Mappings</dt>
                <dd>{selectedApplication.mappings.length}</dd>
              </div>
            </dl>
          ) : (
            <div className="control-empty">ExternalApp فعالی انتخاب نشده است.</div>
          )}
        </article>

        <form className="control-block" onSubmit={createKey}>
          <div className="control-block-title">
            <KeyRound size={18} />
            <div>
              <strong>Key metadata و rotation</strong>
              <span>فقط نام environment secret ثبت می‌شود؛ نه مقدار آن.</span>
            </div>
          </div>
          <label>
            Key ID
            <input
              required
              dir="ltr"
              pattern="[A-Za-z0-9._-]{3,100}"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
            />
          </label>
          <label>
            Secret reference
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
              کلید retiring
              <select
                value={retiringKeyId}
                onChange={(event) => setRetiringKeyId(event.target.value)}
              >
                <option value="">بدون rotation</option>
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
              اعتبار کلید قبلی تا
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
            ثبت metadata
          </button>
        </form>

        <form className="control-block integration-mapping-form" onSubmit={createMapping}>
          <div className="control-block-title">
            <Link2 size={18} />
            <div>
              <strong>ExternalTenant mapping</strong>
              <span>Workspace مقصد فقط از scopeهای Organization انتخاب می‌شود.</span>
            </div>
          </div>
          <div className="control-form-row">
            <label>
              External tenant ref
              <input
                required
                dir="ltr"
                value={externalTenantRef}
                onChange={(event) => setExternalTenantRef(event.target.value)}
              />
            </label>
            <label>
              External workspace ref
              <input
                required
                dir="ltr"
                value={externalWorkspaceRef}
                onChange={(event) => setExternalWorkspaceRef(event.target.value)}
              />
            </label>
          </div>
          <label>
            Workspace مقصد
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
              Callback origin اختیاری
              <input
                type="url"
                dir="ltr"
                placeholder="https://callbacks.example.com"
                value={callbackOrigin}
                onChange={(event) => setCallbackOrigin(event.target.value)}
              />
            </label>
            <label>
              Path prefix
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
            ثبت mapping
          </button>
        </form>
      </div>

      <div className="integration-records">
        {applications.length === 0 ? (
          <div className="control-empty">ExternalApp ثبت نشده است.</div>
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
                  <Ban size={14} /> غیرفعال‌سازی
                </button>
              </header>
              <div className="integration-record-columns">
                <div>
                  <h4>
                    <KeyRound size={14} /> کلیدها
                  </h4>
                  {application.keys.length === 0 ? (
                    <p>metadata کلیدی ثبت نشده است.</p>
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
                          <RotateCw size={13} /> revoke
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div>
                  <h4>
                    <Link2 size={14} /> mappingها
                  </h4>
                  {application.mappings.length === 0 ? (
                    <p>Workspace mapping ثبت نشده است.</p>
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
                          غیرفعال‌سازی
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
