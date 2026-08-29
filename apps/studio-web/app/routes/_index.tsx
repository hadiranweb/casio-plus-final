import { useCallback, useEffect, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';
import {
  ArrowLeft,
  ArrowUpLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Eye,
  FileCheck2,
  GitBranch,
  Layers3,
  LockKeyhole,
  Play,
  Plus,
  Rocket,
  Save,
  Settings2,
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

const axisLabels = [
  { key: 'capabilityFit', label: 'تناسب قابلیت', helper: 'توانایی فنی و حرفه‌ای' },
  { key: 'experienceFit', label: 'تناسب تجربه', helper: 'سابقهٔ مرتبط و قابل‌اثبات' },
  { key: 'contextFit', label: 'تناسب context', helper: 'هم‌خوانی با صنعت و مرحله' },
  { key: 'motivationFit', label: 'تناسب انگیزه', helper: 'محرک‌ها و success criteria' },
  { key: 'riskAndReadiness', label: 'ریسک و آمادگی', helper: 'کاستی شواهد و آمادگی اجرا' },
];

async function requestJson<T>(
  apiBase: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `request_failed_${response.status}`);
  }
  return (await response.json()) as T;
}

function SessionBar({ token, onSave }: { token: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(token);
  return (
    <div className="studio-session">
      <LockKeyhole size={15} />
      <span>
        {token ? 'Session متصل و governance فعال است' : 'برای ویرایش و انتشار Session را وصل کنید'}
      </span>
      <input
        aria-label="توکن session استودیو"
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="signed session token"
      />
      <button onClick={() => onSave(draft)}>{token ? 'به‌روزرسانی' : 'اتصال'}</button>
    </div>
  );
}

function Studio() {
  const rootData = useRouteLoaderData<typeof rootLoader>('root');
  const apiBase = rootData?.coreApiUrl ?? 'http://localhost:8080';
  const [token, setToken] = useState(() =>
    typeof window === 'undefined' ? '' : (window.localStorage.getItem('casioplus_session') ?? ''),
  );
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState('');
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [flowName, setFlowName] = useState('Business diagnosis');
  const [flowKey, setFlowKey] = useState('business-diagnosis');
  const [versionNote, setVersionNote] = useState('Five-axis profile and candidate evaluation');
  const [runtime, setRuntime] = useState('native');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? flows[0];

  const loadFlows = useCallback(async () => {
    if (!token) return;
    try {
      const response = await requestJson<{ flows: Flow[] }>(apiBase, '/api/v1/flows', token);
      setFlows(response.flows);
      setSelectedFlowId((current) => current || response.flows[0]?.id || '');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Flowها بارگذاری نشدند');
    }
  }, [apiBase, token]);

  const loadVersions = useCallback(async () => {
    if (!token || !selectedFlow?.id) {
      setVersions([]);
      return;
    }
    try {
      const response = await requestJson<{ versions: FlowVersion[] }>(
        apiBase,
        `/api/v1/flows/${selectedFlow.id}/versions`,
        token,
      );
      setVersions(response.versions);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'نسخه‌ها بارگذاری نشدند');
    }
  }, [selectedFlow?.id, token]);

  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);
  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const saveToken = (value: string) => {
    const next = value.trim();
    localStorage.setItem('casioplus_session', next);
    setToken(next);
    setNotice(next ? 'Session ذخیره شد.' : 'Session پاک شد.');
  };

  const createFlow = async () => {
    if (!token || !flowName.trim() || !flowKey.trim()) return;
    setLoading(true);
    try {
      const flow = await requestJson<Flow>(apiBase, '/api/v1/flows', token, {
        method: 'POST',
        body: JSON.stringify({ name: flowName, key: flowKey }),
      });
      setFlows((current) => [flow, ...current]);
      setSelectedFlowId(flow.id);
      setNotice('Flow ساخته شد؛ اکنون version اول را تعریف کنید.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ساخت Flow ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  const createVersion = async () => {
    if (!token || !selectedFlow?.id) return;
    setLoading(true);
    try {
      await requestJson(apiBase, `/api/v1/flows/${selectedFlow.id}/versions`, token, {
        method: 'POST',
        body: JSON.stringify({
          inputSchema: {
            type: 'object',
            required: ['business', 'position', 'candidates'],
            properties: {
              business: { type: 'object' },
              position: { type: 'object' },
              candidates: { type: 'array' },
            },
          },
          outputSchema: {
            type: 'object',
            required: ['jobProfile', 'candidateEvaluations', 'limitations'],
          },
          definition: {
            note: versionNote,
            axes: axisLabels.map((axis) => axis.key),
            reviewRequired: true,
            artifactFormats: ['json', 'html'],
          },
          runtimeBinding: runtime,
        }),
      });
      setNotice('نسخهٔ جدید ذخیره شد و آمادهٔ تست است.');
      await loadVersions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ساخت version ناموفق بود');
    } finally {
      setLoading(false);
    }
  };

  const publishVersion = async (version: FlowVersion) => {
    if (!token || !selectedFlow?.id) return;
    try {
      await requestJson(
        apiBase,
        `/api/v1/flows/${selectedFlow.id}/versions/${version.id}/publish`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      );
      setNotice(`نسخهٔ ${version.version} منتشر شد؛ App می‌تواند از آن استفاده کند.`);
      await loadFlows();
      await loadVersions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'انتشار version ناموفق بود');
    }
  };

  return (
    <div className="studio-shell">
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <CasioplusBrandMark className="studio-brand-mark" />
          <div>
            <strong>Casioplus</strong>
            <span>studio / authoring</span>
          </div>
        </div>
        <div className="studio-side-label">ساخت و حکمرانی</div>
        <a className="studio-nav active" href="#builder">
          <Workflow size={16} /> Flow builder <span>⌘1</span>
        </a>
        <a className="studio-nav" href="#versions">
          <GitBranch size={16} /> Version history <span>⌘2</span>
        </a>
        <a className="studio-nav" href="#test">
          <Play size={16} /> Test bench <span>⌘3</span>
        </a>
        <a className="studio-nav" href="#policy">
          <Settings2 size={16} /> Policy & access
        </a>
        <div className="studio-side-label secondary">اجزای Flow</div>
        <div className="node-list">
          <div className="node-item">
            <span className="node-dot input" /> ورودی فرم
          </div>
          <div className="node-item">
            <span className="node-dot transform" /> تحلیل پنج‌محوره
          </div>
          <div className="node-item">
            <span className="node-dot output" /> خروجی و Artifact
          </div>
          <div className="node-item">
            <span className="node-dot review" /> Review gate
          </div>
        </div>
        <div className="studio-sidebar-footer">
          <div className="private-badge">
            <LockKeyhole size={13} /> private workspace
          </div>
          <a href={rootData?.appUrl ?? 'http://localhost:5173'} target="_blank" rel="noreferrer">
            بازگشت به App <ArrowUpLeft size={14} />
          </a>
        </div>
      </aside>

      <main className="studio-main">
        <header className="studio-topbar">
          <div className="studio-breadcrumb">
            <span>Workspace / تشخیص کسب‌وکار</span>
            <ChevronDown size={14} />
          </div>
          <div className="studio-top-actions">
            <button className="ghost-button">
              <CircleHelp size={15} /> راهنما
            </button>
            <button className="ghost-button">
              <Eye size={15} /> Preview
            </button>
            <div className="studio-avatar">هـ</div>
          </div>
        </header>
        <SessionBar token={token} onSave={saveToken} />
        {error && (
          <div className="studio-alert error">
            <X size={15} />
            <span>{error}</span>
            <button onClick={() => setError('')}>بستن</button>
          </div>
        )}
        {notice && (
          <div className="studio-alert success">
            <Check size={15} />
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>بستن</button>
          </div>
        )}

        <div className="studio-content" id="builder">
          <section className="studio-heading">
            <div>
              <div className="studio-eyebrow">AUTHORING SURFACE / ۰۱</div>
              <h1>Flow builder</h1>
              <p>جریان تحلیل را با قرارداد ورودی، rubric پنج‌محوره و policy انتشار تعریف کنید.</p>
            </div>
            <div className="heading-state">
              <span className="tiny-dot" />{' '}
              {selectedFlow?.status === 'published' ? 'published' : 'draft'}
              <span className="divider" />{' '}
              <span className="mono">{selectedFlow ? selectedFlow.key : 'new-flow'}</span>
            </div>
          </section>

          <section className="flow-tabs">
            <button className="flow-tab active">
              <Workflow size={15} /> تعریف Flow
            </button>
            <button className="flow-tab">
              <Code2 size={15} /> قرارداد JSON
            </button>
            <button className="flow-tab">
              <LockKeyhole size={15} /> Policy
            </button>
            <div className="flow-tab-spacer" />
            <span className="autosave">
              <Save size={13} /> autosave off
            </span>
          </section>

          <section className="builder-layout">
            <div className="builder-main">
              <article className="builder-card flow-identity">
                <div className="card-title">
                  <div className="step-number">۱</div>
                  <div>
                    <h2>هویت جریان</h2>
                    <p>نام و کلید پایدار برای publication را مشخص کنید.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    نام نمایشی
                    <input
                      value={flowName}
                      onChange={(event) => setFlowName(event.target.value)}
                      placeholder="Business diagnosis"
                      disabled={!token}
                    />
                  </label>
                  <label>
                    کلید یکتا
                    <input
                      value={flowKey}
                      onChange={(event) => setFlowKey(event.target.value)}
                      placeholder="business-diagnosis"
                      disabled={!token}
                    />
                  </label>
                </div>
                <div className="identity-actions">
                  <button
                    className="studio-button secondary"
                    onClick={createFlow}
                    disabled={!token || loading}
                  >
                    <Plus size={15} /> {selectedFlow ? 'ساخت Flow جدید' : 'ساخت Flow'}
                  </button>
                  {selectedFlow && (
                    <span className="selected-note">
                      <Check size={13} /> Flow فعال: {selectedFlow.name}
                    </span>
                  )}
                </div>
              </article>

              <article className="builder-card rubric-card" id="test">
                <div className="card-title">
                  <div className="step-number lime">۲</div>
                  <div>
                    <h2>Rubric تطبیق پنج‌محوره</h2>
                    <p>این محورهای typed ورودی worker را به خروجی قابل‌بررسی تبدیل می‌کنند.</p>
                  </div>
                  <span className="locked-label">
                    <LockKeyhole size={12} /> governance required
                  </span>
                </div>
                <div className="axis-grid">
                  {axisLabels.map((axis, index) => (
                    <div className="axis-row" key={axis.key}>
                      <span className="axis-index">۰{index + 1}</span>
                      <div>
                        <strong>{axis.label}</strong>
                        <small>{axis.helper}</small>
                      </div>
                      <div className="axis-toggle">
                        <span className="toggle-on" />
                        <span>فعال</span>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="builder-card contract-card">
                <div className="card-title">
                  <div className="step-number blue">۳</div>
                  <div>
                    <h2>قرارداد ورودی و خروجی</h2>
                    <p>حداقل shape لازم برای اجرای Golden Flow.</p>
                  </div>
                  <FileCheck2 size={21} className="card-icon" />
                </div>
                <div className="contract-panels">
                  <div>
                    <div className="code-label">
                      <span className="json-dot" /> input.schema.json
                    </div>
                    <pre>{`{
  "business": object,
  "position": object,
  "candidates": array
}`}</pre>
                  </div>
                  <div>
                    <div className="code-label">
                      <span className="json-dot output" /> output.schema.json
                    </div>
                    <pre>{`{
  "jobProfile": object,
  "candidateEvaluations": array,
  "limitations": array
}`}</pre>
                  </div>
                </div>
              </article>

              <article className="builder-card publish-card" id="versions">
                <div className="card-title">
                  <div className="step-number violet">۴</div>
                  <div>
                    <h2>نسخه و runtime</h2>
                    <p>نسخهٔ قابل‌تست را بسازید؛ publication نیازمند Review است.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    یادداشت نسخه
                    <input
                      value={versionNote}
                      onChange={(event) => setVersionNote(event.target.value)}
                      placeholder="What changed?"
                      disabled={!token}
                    />
                  </label>
                  <label>
                    runtime binding
                    <select
                      value={runtime}
                      onChange={(event) => setRuntime(event.target.value)}
                      disabled={!token}
                    >
                      <option value="native">Native Worker / deterministic</option>
                      <option value="n8n">n8n / orchestrator</option>
                      <option value="open-webui">Open WebUI / model plane</option>
                      <option value="openclaw">OpenClaw / approval action</option>
                    </select>
                  </label>
                </div>
                <button
                  className="studio-button primary"
                  onClick={createVersion}
                  disabled={!token || !selectedFlow || loading}
                >
                  <Layers3 size={15} /> ذخیرهٔ version جدید
                </button>
              </article>
            </div>

            <aside className="builder-rail">
              <div className="rail-heading">
                <span>FLOW MAP</span>
                <button aria-label="بیشتر">
                  <Settings2 size={15} />
                </button>
              </div>
              <div className="mini-map">
                <div className="map-node start">
                  <span className="map-icon">
                    <Plus size={14} />
                  </span>
                  <div>
                    <b>Form input</b>
                    <small>structured answers</small>
                  </div>
                </div>
                <div className="map-line" />
                <div className="map-node active">
                  <span className="map-icon">
                    <Sparkles size={14} />
                  </span>
                  <div>
                    <b>Five-axis diagnosis</b>
                    <small>Native Worker</small>
                  </div>
                  <span className="map-live">live</span>
                </div>
                <div className="map-line" />
                <div className="map-node">
                  <span className="map-icon">
                    <FileCheck2 size={14} />
                  </span>
                  <div>
                    <b>Review gate</b>
                    <small>human decision</small>
                  </div>
                </div>
                <div className="map-line" />
                <div className="map-node">
                  <span className="map-icon">
                    <Rocket size={14} />
                  </span>
                  <div>
                    <b>Publication</b>
                    <small>App / embed / webhook</small>
                  </div>
                </div>
              </div>
              <div className="rail-divider" />
              <div className="rail-heading">
                <span>VERSIONS</span>
                <span className="version-count">{versions.length}</span>
              </div>
              <div className="version-list">
                {versions.length === 0 ? (
                  <div className="rail-empty">هنوز versionای ساخته نشده.</div>
                ) : (
                  versions.slice(0, 5).map((version) => (
                    <div className="version-row" key={version.id}>
                      <div className="version-mark">v{version.version}</div>
                      <div>
                        <b>
                          {version.definition.note
                            ? String(version.definition.note)
                            : 'Version definition'}
                        </b>
                        <small>
                          {version.runtimeBinding} ·{' '}
                          {new Date(version.createdAt).toLocaleDateString('fa-IR')}
                        </small>
                      </div>
                      <button
                        className="publish-small"
                        onClick={() => publishVersion(version)}
                        disabled={!token}
                      >
                        {selectedFlow?.activeVersionId === version.id ? 'فعال' : 'انتشار'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </section>

          <section className="studio-footer-note">
            <div className="footer-note-icon">
              <LockKeyhole size={15} />
            </div>
            <div>
              <strong>Governance boundary</strong>
              <p>
                Studio policy و version را تعریف می‌کند؛ credentialهای runtime اینجا نمایش داده
                نمی‌شوند و فقط Core/API canonical writer است.
              </p>
            </div>
            <a href="#policy">
              مشاهدهٔ policy <ArrowLeft size={14} />
            </a>
          </section>
        </div>
      </main>
    </div>
  );
}

export default Studio;
