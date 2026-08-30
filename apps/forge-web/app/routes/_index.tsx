import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';
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

const runtimeOptions = [
  { value: 'native', label: 'Native', detail: 'deterministic worker', icon: Settings2 },
  { value: 'n8n', label: 'n8n', detail: 'orchestration plane', icon: Network },
  { value: 'open-webui', label: 'Open WebUI', detail: 'model interaction', icon: Sparkles },
  { value: 'openclaw', label: 'OpenClaw', detail: 'approval action', icon: Bot },
];

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
        <span>CASIOPLUS / FORGE</span>
        <h1>Flowها فقط در یک session سازمانی معتبر ساخته می‌شوند.</h1>
        <p>
          ورود و انتخاب Organization و Workspace در Console انجام می‌شود. Forge همان cookie session
          و مرز authorization در Core/API را استفاده می‌کند.
        </p>
        <a href={consoleUrl}>
          ورود از Console <ArrowLeft size={16} />
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
      setNotice('Flow ثبت شد؛ اکنون قرارداد و version آن را تعریف کنید.');
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
      await requestJson(apiBase, `/api/v1/flows/${selectedFlow.id}/versions`, csrfToken, {
        method: 'POST',
        body: JSON.stringify({
          inputSchema,
          outputSchema,
          definition: {
            note: versionNote || null,
            steps: ['input', 'runtime', 'review', 'artifact'],
            reviewRequired: true,
          },
          runtimeBinding: runtime,
        }),
      });
      setVersionNote('');
      setNotice('Version immutable ساخته شد و برای review آماده است.');
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
      setNotice(`Version ${version.version} منتشر شد.`);
      await Promise.all([loadFlows(), loadVersions()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'publication_failed');
    }
  };

  const runtimeDetail = useMemo(
    () => runtimeOptions.find((option) => option.value === runtime),
    [runtime],
  );

  if (booting) {
    return (
      <main className="forge-boot">
        <CasioplusBrandMark />
        <span>در حال اعتبارسنجی session…</span>
      </main>
    );
  }
  if (!session) return <AuthBoundary consoleUrl={consoleUrl} />;

  return (
    <div className="forge-shell">
      <button
        className="forge-mobile-menu"
        onClick={() => setRailOpen(true)}
        aria-label="بازکردن Flow rail"
      >
        <Menu size={20} />
      </button>
      {railOpen && (
        <button
          className="forge-scrim"
          onClick={() => setRailOpen(false)}
          aria-label="بستن Flow rail"
        />
      )}
      <aside className={`flow-rail ${railOpen ? 'is-open' : ''}`}>
        <div className="forge-brand">
          <CasioplusBrandMark />
          <div>
            <strong>Casioplus</strong>
            <span>Forge</span>
          </div>
          <button onClick={() => setRailOpen(false)} aria-label="بستن">
            <X size={18} />
          </button>
        </div>
        <div className="rail-title">
          <span>FLOW CATALOG</span>
          <b>{flows.length}</b>
        </div>
        <div className="flow-list">
          {flows.length === 0 ? (
            <div className="rail-empty">
              <Workflow size={20} />
              <span>هنوز Flowای وجود ندارد.</span>
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
                  <strong>{flow.name}</strong>
                  <small>{flow.key}</small>
                </div>
                <ChevronLeft size={14} />
              </button>
            ))
          )}
        </div>
        <a className="new-flow-shortcut" href="#new-flow">
          <Plus size={15} />
          Flow جدید
        </a>
        <div className="flow-rail-foot">
          <div>
            <LockKeyhole size={14} />
            <span>
              <strong>private workspace</strong>
              <small>{session.context.role}</small>
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
            <span>Forge / Workspace</span>
            <strong>{selectedFlow?.name ?? 'Flow جدید'}</strong>
          </div>
          <div>
            <span className="session-state">
              <i />
              governed session
            </span>
            <div className="forge-person">{session.user.displayName.slice(0, 1)}</div>
          </div>
        </header>
        <div className="forge-content">
          <section className="forge-heading">
            <div>
              <span>AUTHOR / VERSION / PUBLISH</span>
              <h1>Flow را مانند یک قرارداد عملیاتی بسازید.</h1>
              <p>
                هر version immutable است؛ runtime فقط از adapter مجاز اجرا می‌شود و انتشار مرز
                review را حفظ می‌کند.
              </p>
            </div>
            <div className="heading-actions">
              <a href="#versions">
                <GitBranch size={15} />
                {versions.length} version
              </a>
              <button
                className="publish-action"
                onClick={createVersion}
                disabled={!selectedFlow || loading}
              >
                <Save size={15} />
                ذخیرهٔ version
              </button>
            </div>
          </section>

          {error && (
            <div className="forge-alert error">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError('')}>بستن</button>
            </div>
          )}
          {notice && (
            <div className="forge-alert success">
              <Check size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>بستن</button>
            </div>
          )}

          <section className="forge-workspace">
            <div className="definition-stack">
              <form className="forge-surface identity-surface" id="new-flow" onSubmit={createFlow}>
                <div className="forge-surface-head">
                  <div>
                    <span>۰۱ / IDENTITY</span>
                    <h2>هویت Flow</h2>
                  </div>
                  <Workflow size={19} />
                </div>
                <div className="field-pair">
                  <label>
                    نام نمایشی
                    <input
                      value={flowName}
                      onChange={(event) => setFlowName(event.target.value)}
                      placeholder="نام دقیق Flow"
                    />
                  </label>
                  <label>
                    کلید پایدار
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
                  ثبت Flow
                </button>
              </form>

              <section className="forge-surface runtime-surface">
                <div className="forge-surface-head">
                  <div>
                    <span>۰۲ / RUNTIME BINDING</span>
                    <h2>مرز اجرای version</h2>
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
                <div className="runtime-note">
                  <ShieldCheck size={16} />
                  <span>
                    <strong>{runtimeDetail?.label}</strong> فقط از Core و adapter allowlisted
                    فراخوانی می‌شود؛ credential در Forge قابل مشاهده نیست.
                  </span>
                </div>
              </section>

              <section className="forge-surface contract-surface">
                <div className="forge-surface-head">
                  <div>
                    <span>۰۳ / TYPED CONTRACT</span>
                    <h2>Schema ورودی و خروجی</h2>
                  </div>
                  <Braces size={19} />
                </div>
                <div className="schema-grid">
                  <label>
                    <span>input.schema.json</span>
                    <textarea
                      dir="ltr"
                      spellCheck={false}
                      value={inputSchemaText}
                      onChange={(event) => setInputSchemaText(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>output.schema.json</span>
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
                    <span>۰۴ / VERSION</span>
                    <h2>یادداشت و ثبت version</h2>
                  </div>
                  <GitBranch size={19} />
                </div>
                <label className="version-note">
                  چه چیزی تغییر کرده؟
                  <input
                    value={versionNote}
                    onChange={(event) => setVersionNote(event.target.value)}
                    placeholder="تغییر contract، policy یا runtime"
                  />
                </label>
                <button
                  className="publish-action wide"
                  onClick={createVersion}
                  disabled={!selectedFlow || loading}
                >
                  <Save size={15} />
                  {loading ? 'در حال ثبت…' : 'ساخت version immutable'}
                </button>
              </section>
            </div>

            <aside className="forge-inspector">
              <section className="map-panel">
                <div className="inspector-head">
                  <span>FLOW MAP</span>
                  <Play size={15} />
                </div>
                <div className="flow-map">
                  <div className="map-node">
                    <span>01</span>
                    <div>
                      <strong>Input contract</strong>
                      <small>validated payload</small>
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
                      <strong>Review gate</strong>
                      <small>human decision</small>
                    </div>
                  </div>
                  <i />
                  <div className="map-node">
                    <span>04</span>
                    <div>
                      <strong>Artifact + memory</strong>
                      <small>governed output</small>
                    </div>
                  </div>
                </div>
              </section>

              <section className="versions-panel" id="versions">
                <div className="inspector-head">
                  <span>VERSION HISTORY</span>
                  <b>{versions.length}</b>
                </div>
                {versions.length === 0 ? (
                  <div className="inspector-empty">
                    <FileCheck2 size={20} />
                    <span>برای Flow انتخاب‌شده versionای ثبت نشده است.</span>
                  </div>
                ) : (
                  <div className="version-list">
                    {versions.map((version) => (
                      <article key={version.id}>
                        <div className="version-number">v{version.version}</div>
                        <div>
                          <strong>{String(version.definition.note ?? 'بدون یادداشت')}</strong>
                          <small>
                            {version.runtimeBinding} ·{' '}
                            {new Date(version.createdAt).toLocaleDateString('fa-IR')}
                          </small>
                        </div>
                        <button
                          onClick={() => publishVersion(version)}
                          disabled={selectedFlow?.activeVersionId === version.id}
                        >
                          {selectedFlow?.activeVersionId === version.id ? (
                            <>
                              <Check size={13} />
                              فعال
                            </>
                          ) : (
                            <>
                              <Rocket size={13} />
                              انتشار
                            </>
                          )}
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="policy-panel">
                <ShieldCheck size={18} />
                <div>
                  <strong>Publication boundary</strong>
                  <p>
                    Forge definition می‌سازد؛ Core authorization، review، audit، mapping و
                    attribution را enforce می‌کند.
                  </p>
                </div>
              </section>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}
