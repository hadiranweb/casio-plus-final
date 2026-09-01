import { formatRoleLabel } from '@casioplus/i18n/display-labels';
import { formatDate } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';

const RunControlPanel = lazy(() => import('../components/RunControlPanel.client.js'));
import {
  ArrowLeft,
  ArrowUpLeft,
  Bot,
  Braces,
  Check,
  ChevronLeft,
  CircleAlert,
  FileCheck2,
  GitBranch,
  LockKeyhole,
  Menu,
  Network,
  Play,
  Plus,
  Rocket,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';

type Flow = {
  id: string;
  key: string;
  name: string;
  status: string;
  activeVersionId: string | null;
};

type FlowVersion = {
  id: string;
  flowId: string;
  version: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  definition: Record<string, unknown>;
  runtimeBinding: string;
  createdAt: string;
};

type Session = {
  user: { id: string; email: string; displayName: string };
  context: { organizationId: string; workspaceId: string; actorId: string; role: string };
  expiresAt: string;
  csrfToken: string | null;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function getRuntimeOptions() {
  return [
    {
      value: 'native',
      label: m.forge_runtime_native_label(),
      detail: m.forge_runtime_native_detail(),
      icon: Settings2,
    },
    { value: 'n8n', label: 'n8n', detail: m.forge_runtime_n8n_detail(), icon: Network },
    {
      value: 'open-webui',
      label: 'Open WebUI',
      detail: m.forge_runtime_open_webui_detail(),
      icon: Sparkles,
    },
    {
      value: 'openclaw',
      label: 'OpenClaw',
      detail: m.forge_runtime_openclaw_detail(),
      icon: Bot,
    },
  ];
}

function getRuntimeLifecycle(): Record<
  string,
  { gateLabel: string; gateDetail: string; resultLabel: string; resultDetail: string }
> {
  return {
    native: {
      gateLabel: m.forge_lifecycle_core_gate_label(),
      gateDetail: m.forge_lifecycle_core_gate_detail(),
      resultLabel: m.forge_lifecycle_canonical_result_label(),
      resultDetail: m.forge_lifecycle_governed_output_detail(),
    },
    n8n: {
      gateLabel: m.forge_lifecycle_workflow_result_label(),
      gateDetail: m.forge_lifecycle_typed_callback_detail(),
      resultLabel: m.forge_lifecycle_canonical_result_label(),
      resultDetail: m.forge_lifecycle_adapter_response_detail(),
    },
    'open-webui': {
      gateLabel: m.forge_lifecycle_usage_meter_label(),
      gateDetail: m.forge_lifecycle_pricing_snapshot_detail(),
      resultLabel: m.forge_lifecycle_model_result_label(),
      resultDetail: m.forge_lifecycle_metered_response_detail(),
    },
    openclaw: {
      gateLabel: m.forge_lifecycle_approval_gate_label(),
      gateDetail: m.forge_lifecycle_human_decision_detail(),
      resultLabel: m.forge_lifecycle_action_result_label(),
      resultDetail: m.forge_lifecycle_delivery_audit_detail(),
    },
  };
}

const defaultInputSchema = JSON.stringify(
  { type: 'object', additionalProperties: false, properties: {} },
  null,
  2,
);
const defaultOutputSchema = JSON.stringify(
  { type: 'object', additionalProperties: false, properties: {} },
  null,
  2,
);

async function requestJson<T>(
  apiBase: string,
  path: string,
  csrfToken?: string,
  init?: RequestInit,
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken && !['GET', 'HEAD'].includes(method) ? { 'x-casioplus-csrf': csrfToken } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? `request_failed_${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function AuthBoundary({ consoleUrl }: { consoleUrl: string }) {
  return (
    <main className="forge-auth">
      <section>
        <CasioplusBrandMark />
        <span>{m.forge_auth_kicker()}</span>
        <h1>{m.forge_auth_title()}</h1>
        <p>{m.forge_auth_description()}</p>
        <a href={consoleUrl}>
          {m.forge_auth_console_action()} <ArrowLeft size={16} />
        </a>
      </section>
    </main>
  );
}

export default function Forge() {
  const rootData = useRouteLoaderData<typeof rootLoader>('root');
  const apiBase = rootData?.coreApiUrl ?? 'http://localhost:8080';
  const consoleUrl = rootData?.consoleUrl ?? 'http://localhost:5173';
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [flowName, setFlowName] = useState('');
  const [flowKey, setFlowKey] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [inputSchemaText, setInputSchemaText] = useState(defaultInputSchema);
  const [outputSchemaText, setOutputSchemaText] = useState(defaultOutputSchema);
  const [runtime, setRuntime] = useState('native');
  const [runtimeModel, setRuntimeModel] = useState('casioplus-general');
  const [runtimeMaxTokens, setRuntimeMaxTokens] = useState('512');
  const [runtimeSystemPrompt, setRuntimeSystemPrompt] = useState('');
  const [runtimeTargetKey, setRuntimeTargetKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? flows[0];
  const csrfToken = session?.csrfToken ?? '';

  const loadFlows = useCallback(async () => {
    const response = await requestJson<{ flows: Flow[] }>(apiBase, '/api/v1/flows');
    setFlows(response.flows);
    setSelectedFlowId((current) => current || response.flows[0]?.id || '');
  }, [apiBase]);

  const loadVersions = useCallback(async () => {
    if (!selectedFlow?.id) {
      setVersions([]);
      return;
    }
    const response = await requestJson<{ versions: FlowVersion[] }>(
      apiBase,
      `/api/v1/flows/${selectedFlow.id}/versions`,
    );
    setVersions(response.versions);
  }, [apiBase, selectedFlow?.id]);

  useEffect(() => {
    const start = async () => {
      try {
        const activeSession = await requestJson<Session>(apiBase, '/api/v1/auth/session');
        setSession(activeSession);
        await loadFlows();
      } catch (requestError) {
        if (!(requestError instanceof ApiError && requestError.status === 401)) {
          setError(requestError instanceof Error ? requestError.message : 'core_unavailable');
        }
      } finally {
        setBooting(false);
      }
    };
    void start();
  }, [apiBase, loadFlows]);

  useEffect(() => {
    if (!session || !selectedFlow?.id) return;
    void loadVersions().catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'versions_load_failed');
    });
  }, [loadVersions, selectedFlow?.id, session]);

  const createFlow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flowName.trim() || !flowKey.trim()) return;
    setLoading(true);
    setError('');
    try {
      const flow = await requestJson<Flow>(apiBase, '/api/v1/flows', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ name: flowName, key: flowKey }),
      });
      setFlows((current) => [flow, ...current]);
      setSelectedFlowId(flow.id);
      setFlowName('');
      setFlowKey('');
      setNotice(m.forge_flow_created_notice());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'flow_creation_failed');
    } finally {
      setLoading(false);
    }
  };

  const createVersion = async () => {
    if (!selectedFlow?.id) return;
    setLoading(true);
    setError('');
    try {
      const inputSchema = JSON.parse(inputSchemaText) as Record<string, unknown>;
      const outputSchema = JSON.parse(outputSchemaText) as Record<string, unknown>;
      if (runtime === 'open-webui' && !runtimeModel.trim()) {
        throw new Error(m.forge_model_required_error());
      }
      if (runtime === 'openclaw' && !runtimeTargetKey.trim()) {
        throw new Error(m.forge_target_required_error());
      }
      const runtimeDefinition =
        runtime === 'open-webui'
          ? {
              model: runtimeModel.trim(),
              maxTokens: Number(runtimeMaxTokens),
              ...(runtimeSystemPrompt.trim() ? { systemPrompt: runtimeSystemPrompt.trim() } : {}),
            }
          : runtime === 'openclaw'
            ? { action: 'send_message', targetKey: runtimeTargetKey.trim() }
            : runtime === 'n8n'
              ? { operation: 'workflow.execute' }
              : { mode: 'deterministic' };
      await requestJson(apiBase, `/api/v1/flows/${selectedFlow.id}/versions`, csrfToken, {
        method: 'POST',
        body: JSON.stringify({
          inputSchema,
          outputSchema,
          definition: {
            ...runtimeDefinition,
            note: versionNote || null,
            steps: ['input', 'runtime', 'review', 'artifact'],
            reviewRequired: runtime === 'openclaw',
          },
          runtimeBinding: runtime,
        }),
      });
      setVersionNote('');
      setNotice(m.forge_version_created_notice());
      await loadVersions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'version_creation_failed');
    } finally {
      setLoading(false);
    }
  };

  const publishVersion = async (version: FlowVersion) => {
    if (!selectedFlow?.id) return;
    try {
      await requestJson(
        apiBase,
        `/api/v1/flows/${selectedFlow.id}/versions/${version.id}/publish`,
        csrfToken,
        { method: 'POST', body: JSON.stringify({}) },
      );
      setNotice(m.forge_version_published_notice({ version: version.version }));
      await Promise.all([loadFlows(), loadVersions()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'publication_failed');
    }
  };

  const runtimeOptions = getRuntimeOptions();
  const runtimeLifecycle = getRuntimeLifecycle();
  const runtimeDetail = runtimeOptions.find((option) => option.value === runtime);
  const lifecycleDetail = runtimeLifecycle[runtime] ?? runtimeLifecycle.native;

  if (booting) {
    return (
      <main className="forge-boot">
        <CasioplusBrandMark />
        <span>{m.forge_boot_validating_session()}</span>
      </main>
    );
  }
  if (!session) return <AuthBoundary consoleUrl={consoleUrl} />;

  return (
    <div className="forge-shell">
      <button
        className="forge-mobile-menu"
        onClick={() => setRailOpen(true)}
        aria-label={m.forge_open_flow_rail_aria()}
      >
        <Menu size={20} />
      </button>
      {railOpen && (
        <button
          className="forge-scrim"
          onClick={() => setRailOpen(false)}
          aria-label={m.forge_close_flow_rail_aria()}
        />
      )}
      <aside className={`flow-rail ${railOpen ? 'is-open' : ''}`}>
        <div className="forge-brand">
          <CasioplusBrandMark />
          <div>
            <strong>Casioplus</strong>
            <span>Forge</span>
          </div>
          <button onClick={() => setRailOpen(false)} aria-label={m.forge_close()}>
            <X size={18} />
          </button>
        </div>
        <div className="rail-title">
          <span>{m.forge_flow_catalog()}</span>
          <b>{flows.length}</b>
        </div>
        <div className="flow-list">
          {flows.length === 0 ? (
            <div className="rail-empty">
              <Workflow size={20} />
              <span>{m.forge_no_flows()}</span>
            </div>
          ) : (
            flows.map((flow) => (
              <button
                key={flow.id}
                className={selectedFlow?.id === flow.id ? 'active' : ''}
                onClick={() => {
                  setSelectedFlowId(flow.id);
                  setRailOpen(false);
                }}
              >
                <span className={`flow-status ${flow.status}`} />
                <div>
                  <strong dir="auto">{flow.name}</strong>
                  <small dir="ltr">{flow.key}</small>
                </div>
                <ChevronLeft size={14} />
              </button>
            ))
          )}
        </div>
        <a className="new-flow-shortcut" href="#new-flow">
          <Plus size={15} />
          {m.forge_new_flow()}
        </a>
        <div className="flow-rail-foot">
          <div>
            <LockKeyhole size={14} />
            <span>
              <strong>{m.forge_private_workspace()}</strong>
              <small>{formatRoleLabel(session.context.role)}</small>
            </span>
          </div>
          <a href={consoleUrl}>
            Console <ArrowUpLeft size={13} />
          </a>
        </div>
      </aside>

      <main className="forge-main">
        <header className="forge-topbar">
          <div>
            <span>{m.forge_workspace_breadcrumb()}</span>
            <strong dir="auto">{selectedFlow?.name ?? m.forge_new_flow()}</strong>
          </div>
          <div>
            <span className="session-state">
              <i />
              {m.forge_valid_session()}
            </span>
            <div className="forge-person">{session.user.displayName.slice(0, 1)}</div>
          </div>
        </header>
        <div className="forge-content">
          <section className="forge-heading">
            <div>
              <span>{m.forge_author_overline()}</span>
              <h1>{m.forge_heading_title()}</h1>
              <p>{m.forge_heading_description()}</p>
            </div>
            <div className="heading-actions">
              <a href="#versions">
                <GitBranch size={15} />
                {m.forge_version_count({ count: versions.length })}
              </a>
            </div>
          </section>

          {error && (
            <div className="forge-alert error">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError('')}>{m.forge_close()}</button>
            </div>
          )}
          {notice && (
            <div className="forge-alert success">
              <Check size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>{m.forge_close()}</button>
            </div>
          )}

          <section className="forge-workspace">
            <div className="definition-stack">
              <form className="forge-surface identity-surface" id="new-flow" onSubmit={createFlow}>
                <div className="forge-surface-head">
                  <div>
                    <span>{m.forge_identity_step()}</span>
                    <h2>{m.forge_identity_title()}</h2>
                  </div>
                  <Workflow size={19} />
                </div>
                <div className="field-pair">
                  <label>
                    {m.forge_display_name_label()}
                    <input
                      dir="auto"
                      value={flowName}
                      onChange={(event) => setFlowName(event.target.value)}
                      placeholder={m.forge_display_name_placeholder()}
                    />
                  </label>
                  <label>
                    {m.forge_stable_key_label()}
                    <input
                      dir="ltr"
                      value={flowKey}
                      onChange={(event) => setFlowKey(event.target.value)}
                      placeholder="organization-flow"
                      pattern="[a-z][a-z0-9-]+"
                    />
                  </label>
                </div>
                <button
                  className="secondary-action"
                  type="submit"
                  disabled={loading || !flowName.trim() || !flowKey.trim()}
                >
                  <Plus size={15} />
                  {m.forge_create_flow_action()}
                </button>
              </form>

              <section className="forge-surface runtime-surface">
                <div className="forge-surface-head">
                  <div>
                    <span>{m.forge_runtime_step()}</span>
                    <h2>{m.forge_runtime_boundary_title()}</h2>
                  </div>
                  <Network size={19} />
                </div>
                <div className="runtime-grid">
                  {runtimeOptions.map(({ value, label, detail, icon: Icon }) => (
                    <button
                      key={value}
                      className={runtime === value ? 'active' : ''}
                      onClick={() => setRuntime(value)}
                    >
                      <Icon size={17} />
                      <span>
                        <strong>{label}</strong>
                        <small>{detail}</small>
                      </span>
                      {runtime === value && <Check size={14} />}
                    </button>
                  ))}
                </div>
                {runtime === 'open-webui' && (
                  <div className="runtime-config">
                    <label>
                      {m.forge_model_key_label()}
                      <input
                        dir="ltr"
                        value={runtimeModel}
                        onChange={(event) => setRuntimeModel(event.target.value)}
                        placeholder="casioplus-general"
                        required
                      />
                    </label>
                    <label>
                      {m.forge_max_tokens_label()}
                      <input
                        type="number"
                        min="1"
                        max="32768"
                        value={runtimeMaxTokens}
                        onChange={(event) => setRuntimeMaxTokens(event.target.value)}
                        required
                      />
                    </label>
                    <label className="runtime-config-wide">
                      {m.forge_system_prompt_optional_label()}
                      <textarea
                        dir="auto"
                        value={runtimeSystemPrompt}
                        onChange={(event) => setRuntimeSystemPrompt(event.target.value)}
                        rows={3}
                        maxLength={8_000}
                      />
                    </label>
                  </div>
                )}
                {runtime === 'openclaw' && (
                  <div className="runtime-config">
                    <label className="runtime-config-wide">
                      {m.forge_target_key_label()}
                      <input
                        dir="ltr"
                        value={runtimeTargetKey}
                        onChange={(event) => setRuntimeTargetKey(event.target.value)}
                        placeholder="operations-primary"
                        required
                      />
                    </label>
                    <p className="runtime-config-help">{m.forge_target_policy_help()}</p>
                  </div>
                )}
                <div className="runtime-note">
                  <ShieldCheck size={16} />
                  <span>
                    {m.forge_runtime_security_note({
                      runtime: runtimeDetail?.label ?? runtime,
                    })}
                  </span>
                </div>
              </section>

              <section className="forge-surface contract-surface">
                <div className="forge-surface-head">
                  <div>
                    <span>{m.forge_contract_step()}</span>
                    <h2>{m.forge_contract_title()}</h2>
                  </div>
                  <Braces size={19} />
                </div>
                <div className="schema-grid">
                  <label>
                    <span dir="ltr">input.schema.json</span>
                    <textarea
                      dir="ltr"
                      spellCheck={false}
                      value={inputSchemaText}
                      onChange={(event) => setInputSchemaText(event.target.value)}
                    />
                  </label>
                  <label>
                    <span dir="ltr">output.schema.json</span>
                    <textarea
                      dir="ltr"
                      spellCheck={false}
                      value={outputSchemaText}
                      onChange={(event) => setOutputSchemaText(event.target.value)}
                    />
                  </label>
                </div>
              </section>

              <section className="forge-surface version-surface">
                <div className="forge-surface-head">
                  <div>
                    <span>{m.forge_version_step()}</span>
                    <h2>{m.forge_change_note_title()}</h2>
                  </div>
                  <GitBranch size={19} />
                </div>
                <label className="version-note">
                  {m.forge_change_question()}
                  <input
                    dir="auto"
                    value={versionNote}
                    onChange={(event) => setVersionNote(event.target.value)}
                    placeholder={m.forge_change_placeholder()}
                  />
                </label>
                <button
                  className="publish-action wide"
                  onClick={createVersion}
                  disabled={!selectedFlow || loading}
                >
                  <Save size={15} />
                  {loading ? m.forge_saving() : m.forge_save_immutable_version()}
                </button>
              </section>
            </div>

            <aside className="forge-inspector">
              <section className="map-panel">
                <div className="inspector-head">
                  <span>{m.forge_flow_map()}</span>
                  <Play size={15} />
                </div>
                <div className="flow-map">
                  <div className="map-node">
                    <span>01</span>
                    <div>
                      <strong>{m.forge_input_contract()}</strong>
                      <small>{m.forge_validated_payload()}</small>
                    </div>
                  </div>
                  <i />
                  <div className="map-node active">
                    <span>02</span>
                    <div>
                      <strong>{runtimeDetail?.label}</strong>
                      <small>{runtimeDetail?.detail}</small>
                    </div>
                  </div>
                  <i />
                  <div className="map-node">
                    <span>03</span>
                    <div>
                      <strong>{lifecycleDetail.gateLabel}</strong>
                      <small>{lifecycleDetail.gateDetail}</small>
                    </div>
                  </div>
                  <i />
                  <div className="map-node">
                    <span>04</span>
                    <div>
                      <strong>{lifecycleDetail.resultLabel}</strong>
                      <small>{lifecycleDetail.resultDetail}</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="versions-panel" id="versions">
                <div className="inspector-head">
                  <span>{m.forge_version_history()}</span>
                  <b>{versions.length}</b>
                </div>
                {versions.length === 0 ? (
                  <div className="inspector-empty">
                    <FileCheck2 size={20} />
                    <span>{m.forge_no_versions()}</span>
                  </div>
                ) : (
                  <div className="version-list">
                    {versions.map((version) => (
                      <article key={version.id}>
                        <div className="version-number" dir="ltr">
                          v{version.version}
                        </div>
                        <div>
                          <strong dir="auto">
                            {String(version.definition.note ?? m.forge_no_version_note())}
                          </strong>
                          <small>
                            <bdi dir="ltr">{version.runtimeBinding}</bdi> ·{' '}
                            {formatDate(version.createdAt)}
                          </small>
                        </div>
                        <button
                          onClick={() => publishVersion(version)}
                          disabled={selectedFlow?.activeVersionId === version.id}
                        >
                          {selectedFlow?.activeVersionId === version.id ? (
                            <>
                              <Check size={13} />
                              {m.forge_version_active()}
                            </>
                          ) : (
                            <>
                              <Rocket size={13} />
                              {m.forge_publish_action()}
                            </>
                          )}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <Suspense
                fallback={<div className="inspector-empty">{m.forge_loading_run_control()}</div>}
              >
                <RunControlPanel
                  apiBase={apiBase}
                  csrfToken={csrfToken}
                  flow={selectedFlow}
                  versions={versions}
                />
              </Suspense>

              <section className="policy-panel">
                <ShieldCheck size={18} />
                <div>
                  <strong>{m.forge_publication_boundary()}</strong>
                  <p>{m.forge_publication_boundary_description()}</p>
                </div>
              </section>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}
