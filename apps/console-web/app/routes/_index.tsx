import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';
import {
  Activity,
  ArrowUpLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  FileJson2,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Workflow,
} from 'lucide-react';
type WorkItem = {
  id: string;
  title: string;
  intent: string | null;
  status: string;
  createdAt: string;
};

type Flow = {
  id: string;
  key: string;
  name: string;
  status: string;
  activeVersionId: string | null;
};

type ProcessRun = {
  id: string;
  status: string;
  flowId: string;
  workItemId: string;
  createdAt: string;
  completedAt: string | null;
};

type MemoryItem = {
  id: string;
  title: string;
  kind: string;
  content: Record<string, unknown>;
  sensitivity: string;
  createdAt: string;
  rank?: number;
};

type ApiState = {
  workItems: WorkItem[];
  flows: Flow[];
  runs: ProcessRun[];
  memories: MemoryItem[];
};

const initialApiState: ApiState = { workItems: [], flows: [], runs: [], memories: [] };

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('fa-IR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    open: 'باز',
    in_progress: 'در جریان',
    completed: 'تکمیل‌شده',
    draft: 'پیش‌نویس',
    published: 'منتشرشده',
    running: 'در حال اجرا',
    succeeded: 'موفق',
    failed: 'ناموفق',
  };
  return labels[status] ?? status;
}

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

function SessionPanel({
  token,
  onSave,
  onClear,
}: {
  token: string;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(token);
  return (
    <section className="session-panel" data-testid="session-panel">
      <div className="eyebrow">اتصال امن به Core</div>
      <h2>{token ? 'Session متصل است' : 'برای شروع Session را وصل کنید'}</h2>
      <p>
        Console فقط با Bearer session امضاشده به Core متصل می‌شود. هیچ tenant header خامی در این سطح
        ارسال نمی‌شود.
      </p>
      <div className="session-input-row">
        <input
          aria-label="توکن session"
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Casioplus session token"
        />
        <button className="button button-primary" onClick={() => onSave(draft)}>
          اتصال
        </button>
        {token && (
          <button className="icon-button" aria-label="قطع session" onClick={onClear}>
            <LogOut size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

function Console() {
  const rootData = useRouteLoaderData<typeof rootLoader>('root');
  const apiBase = rootData?.coreApiUrl ?? 'http://localhost:8080';
  const [token, setToken] = useState(() =>
    typeof window === 'undefined' ? '' : (window.localStorage.getItem('casioplus_session') ?? ''),
  );
  const [data, setData] = useState(initialApiState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workTitle, setWorkTitle] = useState('');
  const [workIntent, setWorkIntent] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [searched, setSearched] = useState(false);

  const connected = Boolean(token);
  const activeFlow = useMemo(
    () => data.flows.find((flow) => flow.status === 'published') ?? data.flows[0],
    [data.flows],
  );

  const loadData = useCallback(async () => {
    if (!token) {
      setData(initialApiState);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [workResponse, flowResponse, runResponse] = await Promise.all([
        requestJson<{ items: WorkItem[] }>(apiBase, '/api/v1/work-items', token),
        requestJson<{ flows: Flow[] }>(apiBase, '/api/v1/flows', token),
        requestJson<{ runs: ProcessRun[] }>(apiBase, '/api/v1/process-runs', token),
      ]);
      setData((current) => ({
        ...current,
        workItems: workResponse.items,
        flows: flowResponse.flows,
        runs: runResponse.runs,
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'خطا در دریافت داده');
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveToken = (value: string) => {
    const trimmed = value.trim();
    localStorage.setItem('casioplus_session', trimmed);
    setToken(trimmed);
    setNotice(trimmed ? 'Session ذخیره شد.' : 'Session پاک شد.');
  };

  const clearToken = () => {
    localStorage.removeItem('casioplus_session');
    setToken('');
    setNotice('Session قطع شد.');
  };

  const createWorkItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workTitle.trim()) return;
    try {
      await requestJson(apiBase, '/api/v1/work-items', token, {
        method: 'POST',
        body: JSON.stringify({ title: workTitle, intent: workIntent || null }),
      });
      setWorkTitle('');
      setWorkIntent('');
      setNotice('Work جدید ساخته شد و برای اجرای Flow آماده است.');
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ساخت Work ناموفق بود');
    }
  };

  const searchMemory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryQuery.trim()) return;
    try {
      const response = await requestJson<{ results: MemoryItem[] }>(
        apiBase,
        `/api/v1/memory/search?query=${encodeURIComponent(memoryQuery)}`,
        token,
      );
      setData((current) => ({ ...current, memories: response.results }));
      setSearched(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'جست‌وجو ناموفق بود');
    }
  };

  const metrics = [
    { label: 'Work فعال', value: data.workItems.length, accent: 'mint' },
    { label: 'Flowهای در دسترس', value: data.flows.length, accent: 'blue' },
    { label: 'Runهای اخیر', value: data.runs.length, accent: 'amber' },
    { label: 'حافظهٔ governed', value: data.memories.length, accent: 'violet' },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <CasioplusBrandMark className="brand-mark" />
          <div>
            <strong>Casioplus</strong>
            <span>control plane</span>
          </div>
        </div>
        <div className="workspace-switcher">
          <span className="status-dot" />
          <div>
            <small>Workspace</small>
            <strong>تشخیص کسب‌وکار</strong>
          </div>
          <ChevronLeft size={15} />
        </div>
        <nav className="side-nav" aria-label="ناوبری اصلی">
          <div className="nav-section-label">مرکز عملیات</div>
          <a className="nav-item active" href="#overview">
            <LayoutDashboard size={17} /> نمای کلی
          </a>
          <a className="nav-item" href="#work">
            <Activity size={17} /> Work و Timeline
          </a>
          <a className="nav-item" href="#flows">
            <Workflow size={17} /> Flow Catalog
          </a>
          <a className="nav-item" href="#memory">
            <BrainCircuit size={17} /> حافظهٔ سازمانی
          </a>
          <div className="nav-section-label">حساب و دسترسی</div>
          <a className="nav-item" href="#settings">
            <Settings2 size={17} /> تنظیمات Workspace
          </a>
        </nav>
        <div className="sidebar-footer">
          <div className="runtime-chip">
            <span className="status-dot green" />
            <span>Core API</span>
            <small>{connected ? 'connected' : 'offline'}</small>
          </div>
          <a
            className="forge-link"
            href={rootData?.forgeUrl ?? 'http://localhost:5174'}
            target="_blank"
            rel="noreferrer"
          >
            رفتن به Forge <ArrowUpLeft size={14} />
          </a>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Casioplus / Console / نمای کلی</span>
            <h1>
              صبح بخیر، هادی <span className="wave">—</span>
            </h1>
          </div>
          <div className="topbar-actions">
            <span className={`connection-pill ${connected ? 'is-connected' : ''}`}>
              <span className="status-dot" /> {connected ? 'Session فعال' : 'نیازمند اتصال'}
            </span>
            <div className="avatar">هـ</div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="hero-card">
            <div className="hero-copy">
              <div className="eyebrow light">Golden Flow / Business Diagnosis</div>
              <h2>از مسئلهٔ کسب‌وکار تا تصمیم قابل‌اتکا.</h2>
              <p>
                ورودی فرم، اجرای Flow، خروجی ساختاریافته و حافظهٔ governed را در یک مسیر شفاف دنبال
                کنید.
              </p>
              <div className="hero-actions">
                <a className="button button-lime" href="#new-work">
                  <Plus size={17} /> شروع Work جدید
                </a>
                <a className="text-link light-link" href="#flows">
                  مشاهدهٔ Flowها <ArrowUpLeft size={15} />
                </a>
              </div>
            </div>
            <div className="hero-orbit" aria-hidden="true">
              <div className="orbit-ring ring-one" />
              <div className="orbit-ring ring-two" />
              <div className="orbit-core">
                <Sparkles size={22} />
              </div>
              <span className="orbit-label label-one">Work</span>
              <span className="orbit-label label-two">Run</span>
              <span className="orbit-label label-three">Memory</span>
            </div>
          </section>

          <SessionPanel token={token} onSave={saveToken} onClear={clearToken} />

          {error && (
            <div className="alert alert-error">
              <CircleAlert size={17} /> <span>{error}</span>
              <button onClick={() => setError('')}>بستن</button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success">
              <CheckCircle2 size={17} /> <span>{notice}</span>
              <button onClick={() => setNotice('')}>بستن</button>
            </div>
          )}

          <section className="metric-grid" aria-label="شاخص‌های workspace">
            {metrics.map((metric) => (
              <article className="metric-card" key={metric.label}>
                <div className={`metric-icon ${metric.accent}`}>
                  <Activity size={16} />
                </div>
                <div>
                  <span>{metric.label}</span>
                  <strong>{loading ? '—' : metric.value}</strong>
                </div>
                <span className="metric-trend">اکنون</span>
              </article>
            ))}
          </section>

          <div className="section-heading" id="work">
            <div>
              <div className="eyebrow">Work queue</div>
              <h2>مسئله‌های در حال رسیدگی</h2>
            </div>
            <a className="text-link" href="#new-work">
              مشاهدهٔ همه <ArrowUpLeft size={15} />
            </a>
          </div>

          <section className="work-layout">
            <div className="panel work-panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">RECENT WORK</span>
                  <h3>آخرین Workها</h3>
                </div>
                <span className="count-badge">{data.workItems.length} مورد</span>
              </div>
              {data.workItems.length === 0 ? (
                <div className="empty-state">
                  <FileJson2 size={25} />
                  <p>هنوز Workای ساخته نشده است.</p>
                </div>
              ) : (
                <div className="work-list">
                  {data.workItems.slice(0, 5).map((work) => (
                    <div className="work-row" key={work.id}>
                      <div className="work-status">
                        <span
                          className={`status-dot ${work.status === 'in_progress' ? 'amber' : 'green'}`}
                        />
                      </div>
                      <div className="work-row-copy">
                        <strong>{work.title}</strong>
                        <span>{work.intent || 'بدون توضیح'}</span>
                      </div>
                      <div className="work-row-meta">
                        <span className="status-label">{statusLabel(work.status)}</span>
                        <small>{dateLabel(work.createdAt)}</small>
                      </div>
                      <ChevronLeft size={16} className="row-arrow" />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel run-panel" id="flows">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">RUN TIMELINE</span>
                  <h3>اجرای اخیر</h3>
                </div>
                <span className="live-indicator">
                  <span className="pulse" /> live
                </span>
              </div>
              {data.runs.length === 0 ? (
                <div className="empty-state">
                  <Activity size={25} />
                  <p>با اجرای اولین Work، Timeline اینجا ظاهر می‌شود.</p>
                </div>
              ) : (
                <div className="run-list">
                  {data.runs.slice(0, 4).map((run) => (
                    <div className="run-row" key={run.id}>
                      <div className={`run-bullet ${run.status}`}>
                        <CheckCircle2 size={13} />
                      </div>
                      <div>
                        <strong>{statusLabel(run.status)}</strong>
                        <span>Run / {run.id.slice(0, 8)}</span>
                      </div>
                      <small>{dateLabel(run.createdAt)}</small>
                    </div>
                  ))}
                </div>
              )}
              {activeFlow && (
                <div className="active-flow-line">
                  <Workflow size={15} />
                  <span>
                    Flow منتخب: <b>{activeFlow.name}</b>
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="lower-grid">
            <form className="panel create-panel" id="new-work" onSubmit={createWorkItem}>
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">NEW WORK</span>
                  <h3>شروع یک تشخیص</h3>
                </div>
                <div className="form-step">۰۱ / ۰۳</div>
              </div>
              <label>
                عنوان مسئله
                <input
                  value={workTitle}
                  onChange={(event) => setWorkTitle(event.target.value)}
                  placeholder="مثلاً: طراحی پروفایل مدیر عملیات"
                  disabled={!connected}
                />
              </label>
              <label>
                هدف یا context<span className="optional">اختیاری</span>
                <textarea
                  value={workIntent}
                  onChange={(event) => setWorkIntent(event.target.value)}
                  placeholder="چه تصمیمی باید با شواهد بهتر گرفته شود؟"
                  disabled={!connected}
                />
              </label>
              <button
                className="button button-primary full-width"
                type="submit"
                disabled={!connected || !workTitle.trim()}
              >
                <Plus size={17} /> ساخت Work و ادامه
              </button>
              {!connected && (
                <small className="form-hint">ابتدا Session را در بالا متصل کنید.</small>
              )}
            </form>
            <section className="panel memory-panel" id="memory">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">GOVERNED MEMORY</span>
                  <h3>حافظهٔ قابل اتکا</h3>
                </div>
                <BrainCircuit size={21} className="panel-icon" />
              </div>
              <form className="memory-search" onSubmit={searchMemory}>
                <Search size={17} />
                <input
                  value={memoryQuery}
                  onChange={(event) => setMemoryQuery(event.target.value)}
                  placeholder="در حافظه جست‌وجو کنید…"
                  disabled={!connected}
                />
                <button type="submit" aria-label="جست‌وجو" disabled={!connected}>
                  <ArrowUpLeft size={16} />
                </button>
              </form>
              {searched && data.memories.length === 0 ? (
                <div className="memory-empty">نتیجه‌ای در scope فعلی پیدا نشد.</div>
              ) : (
                <div className="memory-list">
                  {data.memories.slice(0, 3).map((memory) => (
                    <article className="memory-item" key={memory.id}>
                      <div className="memory-tag">{memory.kind}</div>
                      <strong>{memory.title}</strong>
                      <p>
                        {String(
                          memory.content.finding ??
                            memory.content.summary ??
                            'رکورد تأییدشده برای workspace',
                        )}
                      </p>
                      <small>
                        {dateLabel(memory.createdAt)} · {memory.sensitivity}
                      </small>
                    </article>
                  ))}
                </div>
              )}
              {!searched && (
                <div className="memory-empty">
                  پس از Review و Promotion، دانش تأییدشده در اینجا قابل جست‌وجو است.
                </div>
              )}
            </section>
          </section>

          <footer className="page-footer">
            <span>Casioplus / Console surface</span>
            <span>
              Core API · PostgreSQL canonical · {connected ? 'authenticated' : 'not authenticated'}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default Console;
