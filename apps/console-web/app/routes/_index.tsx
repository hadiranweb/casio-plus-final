import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';
import type { MemoryGraphData } from '../components/MemoryGraph3D.client.js';

const MemoryGraph3D = lazy(() => import('../components/MemoryGraph3D.client.js'));
import {
  Activity,
  ArrowLeft,
  ArrowUpLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Command,
  FileJson2,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  WalletCards,
  Workflow,
  X,
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

type Session = {
  user: { id: string; email: string; displayName: string };
  context: {
    organizationId: string;
    workspaceId: string;
    actorId: string;
    role: string;
  };
  expiresAt: string;
  csrfToken: string | null;
};

type OrganizationScope = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  actorId: string;
  role: string;
};

type MemoryGraphResponse = MemoryGraphData & {
  governance: {
    permissionFiltered: true;
    purpose: string;
    allowedNamespaceIds: string[];
    appliedGrantIds: string[];
    promotedOnly: true;
    expiredExcluded: true;
  };
};

type ApiState = {
  workItems: WorkItem[];
  flows: Flow[];
  runs: ProcessRun[];
  memories: MemoryItem[];
  pnl: Record<string, string>[];
  tco: Record<string, string>[];
};

const initialApiState: ApiState = {
  workItems: [],
  flows: [],
  runs: [],
  memories: [],
  pnl: [],
  tco: [],
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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

function AuthGateway({
  apiBase,
  onAuthenticated,
}: {
  apiBase: string;
  onAuthenticated: (session: Session) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const body =
        mode === 'login'
          ? { email, password }
          : {
              email,
              password,
              displayName,
              organizationName,
              organizationSlug,
              workspaceName,
              workspaceSlug,
            };
      await requestJson(apiBase, `/api/v1/auth/${mode}`, undefined, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const session = await requestJson<Session>(apiBase, '/api/v1/auth/session');
      onAuthenticated(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'authentication_failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="auth-stage">
      <section className="auth-story" aria-labelledby="auth-title">
        <CasioplusBrandMark className="auth-mark" />
        <div className="auth-kicker">Casioplus / governed operations</div>
        <h1 id="auth-title">تصمیم، اجرا و حافظه در یک مسیر قابل ممیزی.</h1>
        <p>
          Console نمای کنترل سازمان است. session در cookie امن نگه‌داری می‌شود و هیچ شناسهٔ tenant
          از browser authority نمی‌گیرد.
        </p>
        <div className="auth-principles">
          <span>
            <ShieldCheck size={16} /> default-deny memory
          </span>
          <span>
            <Network size={16} /> Core-only writer
          </span>
          <span>
            <Gauge size={16} /> usage attribution
          </span>
        </div>
      </section>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-tabs" role="group" aria-label="نوع ورود">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            aria-pressed={mode === 'login'}
            onClick={() => setMode('login')}
          >
            ورود
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            aria-pressed={mode === 'register'}
            onClick={() => setMode('register')}
          >
            ایجاد سازمان
          </button>
        </div>
        <div className="auth-heading">
          <span>{mode === 'login' ? 'بازگشت به Console' : 'شروع کنترل‌پلین مشترک'}</span>
          <strong>{mode === 'login' ? 'Session سازمانی' : 'Organization و Workspace اولیه'}</strong>
        </div>
        {mode === 'register' && (
          <div className="form-pair">
            <label>
              نام شما
              <input
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              نام سازمان
              <input
                required
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </label>
            <label>
              کلید سازمان
              <input
                required
                dir="ltr"
                value={organizationSlug}
                onChange={(event) => setOrganizationSlug(event.target.value)}
                placeholder="sample-org"
              />
            </label>
            <label>
              Workspace
              <input
                required
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
            <label>
              کلید Workspace
              <input
                required
                dir="ltr"
                value={workspaceSlug}
                onChange={(event) => setWorkspaceSlug(event.target.value)}
                placeholder="main-workspace"
              />
            </label>
          </div>
        )}
        <label>
          ایمیل
          <input
            required
            type="email"
            dir="ltr"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
        </label>
        <label>
          رمز عبور
          <input
            required
            type="password"
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && (
          <div className="form-error">
            <CircleAlert size={16} />
            {error}
          </div>
        )}
        <button className="primary-action" disabled={pending} type="submit">
          {pending ? 'در حال بررسی…' : mode === 'login' ? 'ورود به Console' : 'ساخت سازمان'}
          <ArrowLeft size={16} />
        </button>
        <small>رمز عبور حداقل ۱۲ نویسه است. session token در localStorage ذخیره نمی‌شود.</small>
      </form>
    </main>
  );
}

export default function Console() {
  const rootData = useRouteLoaderData<typeof rootLoader>('root');
  const apiBase = rootData?.coreApiUrl ?? 'http://localhost:8080';
  const [session, setSession] = useState<Session | null>(null);
  const [scope, setScope] = useState<OrganizationScope | null>(null);
  const [data, setData] = useState<ApiState>(initialApiState);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workTitle, setWorkTitle] = useState('');
  const [workIntent, setWorkIntent] = useState('');
  const [memoryQuery, setMemoryQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [memoryGraph, setMemoryGraph] = useState<MemoryGraphResponse | null>(null);

  const csrfToken = session?.csrfToken ?? '';
  const activeFlow = useMemo(
    () => data.flows.find((flow) => flow.status === 'published') ?? data.flows[0],
    [data.flows],
  );

  const loadOperationalData = useCallback(
    async (activeSession: Session) => {
      setLoading(true);
      setError('');
      try {
        const [scopeResponse, workResponse, flowResponse, runResponse, pnlResponse, tcoResponse] =
          await Promise.all([
            requestJson<{ items: OrganizationScope[] }>(apiBase, '/api/v1/organizations'),
            requestJson<{ items: WorkItem[] }>(apiBase, '/api/v1/work-items'),
            requestJson<{ flows: Flow[] }>(apiBase, '/api/v1/flows'),
            requestJson<{ runs: ProcessRun[] }>(apiBase, '/api/v1/process-runs'),
            requestJson<{ summary: Record<string, string>[] }>(
              apiBase,
              '/api/v1/usage/summary?view=casioplus_pnl',
            ),
            requestJson<{ summary: Record<string, string>[] }>(
              apiBase,
              '/api/v1/usage/summary?view=ecosystem_tco',
            ),
          ]);
        setSession(activeSession);
        setScope(scopeResponse.items[0] ?? null);
        setData((current) => ({
          ...current,
          workItems: workResponse.items,
          flows: flowResponse.flows,
          runs: runResponse.runs,
          pnl: pnlResponse.summary,
          tco: tcoResponse.summary,
        }));
      } catch (requestError) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setSession(null);
          setMemoryGraph(null);
          setData(initialApiState);
        } else {
          setError(requestError instanceof Error ? requestError.message : 'data_load_failed');
        }
      } finally {
        setLoading(false);
      }
    },
    [apiBase],
  );

  const bootstrap = useCallback(async () => {
    setBooting(true);
    try {
      const activeSession = await requestJson<Session>(apiBase, '/api/v1/auth/session');
      await loadOperationalData(activeSession);
    } catch (requestError) {
      if (!(requestError instanceof ApiError && requestError.status === 401)) {
        setError(requestError instanceof Error ? requestError.message : 'core_unavailable');
      }
      setSession(null);
      setMemoryGraph(null);
    } finally {
      setBooting(false);
    }
  }, [apiBase, loadOperationalData]);

  useEffect(() => {
    setHydrated(true);
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const createWorkItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!workTitle.trim()) return;
    setError('');
    try {
      await requestJson(apiBase, '/api/v1/work-items', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ title: workTitle, intent: workIntent || null }),
      });
      setWorkTitle('');
      setWorkIntent('');
      setNotice('Work ثبت شد و برای اجرای Flow آماده است.');
      if (session) await loadOperationalData(session);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'work_creation_failed');
    }
  };

  const searchMemory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryQuery.trim()) return;
    try {
      const response = await requestJson<{ results: MemoryItem[] }>(
        apiBase,
        `/api/v1/memory/search?query=${encodeURIComponent(memoryQuery)}&purpose=console.search`,
      );
      setData((current) => ({ ...current, memories: response.results }));
      setSearched(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'memory_search_failed');
    }
  };

  const loadMemoryGraph = async () => {
    setGraphLoading(true);
    setError('');
    try {
      const response = await requestJson<MemoryGraphResponse>(
        apiBase,
        '/api/v1/memory/graph?purpose=console.memory_graph&limit=60',
      );
      setMemoryGraph(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'memory_graph_load_failed');
    } finally {
      setGraphLoading(false);
    }
  };

  const logout = async () => {
    try {
      await requestJson(apiBase, '/api/v1/auth/logout', csrfToken, { method: 'POST' });
    } finally {
      setSession(null);
      setScope(null);
      setMemoryGraph(null);
      setData(initialApiState);
    }
  };

  if (booting) {
    return (
      <main className="boot-screen">
        <CasioplusBrandMark />
        <span>در حال برقراری مرز امن…</span>
      </main>
    );
  }
  if (!session) {
    return (
      <AuthGateway apiBase={apiBase} onAuthenticated={(next) => void loadOperationalData(next)} />
    );
  }

  const metrics = [
    {
      label: 'Work باز',
      value: data.workItems.filter((item) => item.status !== 'completed').length,
      icon: Activity,
    },
    {
      label: 'Flow منتشرشده',
      value: data.flows.filter((flow) => flow.status === 'published').length,
      icon: Workflow,
    },
    {
      label: 'Run ناموفق',
      value: data.runs.filter((run) => run.status === 'failed').length,
      icon: CircleAlert,
    },
    { label: 'یافتهٔ حافظه', value: data.memories.length, icon: BrainCircuit },
  ];
  const pnl = data.pnl[0];
  const tco = data.tco[0];

  return (
    <div className="console-shell">
      <button className="mobile-menu" onClick={() => setRailOpen(true)} aria-label="بازکردن ناوبری">
        <Menu size={20} />
      </button>
      {railOpen && (
        <button
          className="rail-scrim"
          aria-label="بستن ناوبری"
          onClick={() => setRailOpen(false)}
        />
      )}
      <aside className={`console-rail ${railOpen ? 'is-open' : ''}`}>
        <div className="rail-brand">
          <CasioplusBrandMark />
          <div>
            <strong>Casioplus</strong>
            <span>Console</span>
          </div>
          <button onClick={() => setRailOpen(false)} aria-label="بستن">
            <X size={18} />
          </button>
        </div>
        <div className="scope-card">
          <span className="live-dot" />
          <div>
            <small>Workspace</small>
            <strong>{scope?.workspaceName ?? '—'}</strong>
            <span>{scope?.organizationName ?? '—'}</span>
          </div>
          <ChevronLeft size={15} />
        </div>
        <nav aria-label="ناوبری Console">
          <span className="nav-label">عملیات</span>
          <a className="rail-link active" href="#overview">
            <LayoutDashboard size={17} />
            نمای کلی
          </a>
          <a className="rail-link" href="#decisions">
            <Activity size={17} />
            صف تصمیم
          </a>
          <a className="rail-link" href="#memory">
            <BrainCircuit size={17} />
            حافظه
          </a>
          <a className="rail-link" href="#memory-graph">
            <Network size={17} />
            نقشهٔ حافظه
          </a>
          <a className="rail-link" href="#economics">
            <WalletCards size={17} />
            اقتصاد مصرف
          </a>
          <span className="nav-label">کنترل</span>
          <a className="rail-link" href="#governance">
            <ShieldCheck size={17} />
            Governance
          </a>
          <a className="rail-link" href="#settings">
            <Settings2 size={17} />
            تنظیمات
          </a>
        </nav>
        <div className="rail-foot">
          <div className="core-state">
            <span className="live-dot" />
            <div>
              <strong>Core API</strong>
              <small>session معتبر</small>
            </div>
          </div>
          <a href={rootData?.forgeUrl ?? 'http://localhost:5174'}>
            رفتن به Forge <ArrowUpLeft size={14} />
          </a>
        </div>
      </aside>

      <main className="console-main" id="overview">
        <header className="console-topbar">
          <div>
            <span>Console / {scope?.organizationName}</span>
            <strong>{scope?.workspaceName}</strong>
          </div>
          <div className="topbar-actions">
            <button className="command-trigger" onClick={() => setCommandOpen(true)}>
              <Search size={15} />
              جست‌وجو و اقدام <kbd>⌘ K</kbd>
            </button>
            <div className="identity-chip">
              <div>{session.user.displayName.slice(0, 1)}</div>
              <span>
                <strong>{session.user.displayName}</strong>
                <small>{session.context.role}</small>
              </span>
            </div>
            <button className="icon-control" onClick={logout} aria-label="خروج">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <div className="console-content">
          <section className="signal-header">
            <div>
              <span className="section-code">CONTROL / NOW</span>
              <h1>تصمیم‌های امروز، با تبار کامل.</h1>
              <p>صف کار، اجرای Flow، حافظهٔ promoted و اقتصاد مصرف را در scope فعلی دنبال کنید.</p>
            </div>
            <a className="primary-action" href="#new-work">
              <Plus size={16} />
              Work جدید
            </a>
          </section>

          {error && (
            <div className="inline-alert error">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError('')}>بستن</button>
            </div>
          )}
          {notice && (
            <div className="inline-alert success">
              <CheckCircle2 size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>بستن</button>
            </div>
          )}

          <section className="signal-strip" aria-label="شاخص‌های واقعی Workspace">
            {metrics.map(({ label, value, icon: Icon }) => (
              <article key={label}>
                <Icon size={16} />
                <span>{label}</span>
                <strong>{loading ? '—' : value}</strong>
              </article>
            ))}
          </section>

          <section className="operations-grid" id="decisions">
            <article className="surface queue-surface">
              <div className="surface-head">
                <div>
                  <span>DECISION QUEUE</span>
                  <h2>Workهای نیازمند حرکت</h2>
                </div>
                <b>{data.workItems.length}</b>
              </div>
              {data.workItems.length === 0 ? (
                <div className="empty-state">
                  <FileJson2 size={24} />
                  <strong>صف خالی است</strong>
                  <span>اولین Work را از فرم کنار صفحه ثبت کنید.</span>
                </div>
              ) : (
                <div className="data-list">
                  {data.workItems.slice(0, 6).map((work) => (
                    <div className="data-row" key={work.id}>
                      <span className={`status-mark ${work.status}`} />
                      <div>
                        <strong>{work.title}</strong>
                        <span>{work.intent || 'بدون context تکمیلی'}</span>
                      </div>
                      <div>
                        <b>{statusLabel(work.status)}</b>
                        <small>{dateLabel(work.createdAt)}</small>
                      </div>
                      <ChevronLeft size={16} />
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="surface timeline-surface">
              <div className="surface-head">
                <div>
                  <span>RUN TIMELINE</span>
                  <h2>آخرین اجراها</h2>
                </div>
                <span className="live-label">آخرین داده</span>
              </div>
              {data.runs.length === 0 ? (
                <div className="empty-state">
                  <Activity size={24} />
                  <strong>اجرایی ثبت نشده</strong>
                  <span>پس از اجرای Flow، رخدادهای واقعی اینجا ظاهر می‌شوند.</span>
                </div>
              ) : (
                <div className="timeline-list">
                  {data.runs.slice(0, 5).map((run) => (
                    <div key={run.id}>
                      <span className={`timeline-node ${run.status}`} />
                      <div>
                        <strong>{statusLabel(run.status)}</strong>
                        <span>{run.id.slice(0, 8)}</span>
                      </div>
                      <small>{dateLabel(run.createdAt)}</small>
                    </div>
                  ))}
                </div>
              )}
              {activeFlow && (
                <div className="selected-flow">
                  <Workflow size={15} />
                  <span>Flow فعال</span>
                  <strong>{activeFlow.name}</strong>
                </div>
              )}
            </article>
          </section>

          <section className="lower-grid">
            <form className="surface work-form" id="new-work" onSubmit={createWorkItem}>
              <div className="surface-head">
                <div>
                  <span>NEW WORK</span>
                  <h2>تعریف مسئله</h2>
                </div>
                <span>۰۱ / ۰۲</span>
              </div>
              <label>
                عنوان مسئله
                <input
                  value={workTitle}
                  onChange={(event) => setWorkTitle(event.target.value)}
                  placeholder="یک مسئلهٔ تصمیم‌پذیر"
                />
              </label>
              <label>
                نتیجهٔ مورد انتظار
                <textarea
                  value={workIntent}
                  onChange={(event) => setWorkIntent(event.target.value)}
                  placeholder="چه تصمیمی باید با شواهد بهتر گرفته شود؟"
                />
              </label>
              <button className="primary-action" type="submit" disabled={!workTitle.trim()}>
                <Plus size={16} />
                ثبت Work
              </button>
            </form>

            <section className="surface memory-surface" id="memory">
              <div className="surface-head">
                <div>
                  <span>GOVERNED MEMORY</span>
                  <h2>جست‌وجوی promoted knowledge</h2>
                </div>
                <BrainCircuit size={20} />
              </div>
              <form className="search-field" onSubmit={searchMemory}>
                <Search size={16} />
                <input
                  value={memoryQuery}
                  onChange={(event) => setMemoryQuery(event.target.value)}
                  placeholder="یافته، تصمیم یا الگو…"
                />
                <button aria-label="جست‌وجو">
                  <ArrowLeft size={16} />
                </button>
              </form>
              {!searched ? (
                <div className="memory-guide">
                  <ShieldCheck size={20} />
                  <span>
                    فقط رکوردهای معتبر پس از grant، purpose، sensitivity و promotion بازیابی
                    می‌شوند.
                  </span>
                </div>
              ) : data.memories.length === 0 ? (
                <div className="empty-state compact">
                  <strong>نتیجه‌ای در scope فعلی نیست</strong>
                </div>
              ) : (
                <div className="memory-results">
                  {data.memories.slice(0, 4).map((memory) => (
                    <article key={memory.id}>
                      <span>{memory.kind}</span>
                      <strong>{memory.title}</strong>
                      <p>
                        {String(
                          memory.content.finding ?? memory.content.summary ?? 'رکورد governed',
                        )}
                      </p>
                      <small>
                        {memory.sensitivity} · {dateLabel(memory.createdAt)}
                      </small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="surface memory-graph-surface" id="memory-graph">
            <div className="surface-head memory-graph-heading">
              <div>
                <span>MEMORY / LINEAGE</span>
                <h2>گراف سه‌بعدی حافظهٔ سازمانی</h2>
                <p>
                  فقط حافظهٔ promoted و معتبر در namespaceهای مجاز، همراه با Claim، Semantic Record،
                  Run و Flow نمایش داده می‌شود.
                </p>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={() => void loadMemoryGraph()}
                disabled={graphLoading}
              >
                <Network size={16} />
                {graphLoading
                  ? 'در حال بارگذاری…'
                  : memoryGraph
                    ? 'تازه‌سازی گراف'
                    : 'بارگذاری گراف'}
              </button>
            </div>
            {!memoryGraph ? (
              <div className="memory-graph-placeholder">
                <Network size={26} />
                <strong>گراف فقط با درخواست شما بارگذاری می‌شود</strong>
                <span>Three.js و دادهٔ graph در بار اولیهٔ Console دانلود نمی‌شوند.</span>
              </div>
            ) : memoryGraph.nodes.length === 0 ? (
              <div className="empty-state">
                <BrainCircuit size={24} />
                <strong>حافظهٔ promoted در scope فعلی وجود ندارد</strong>
                <span>پس از review و promotion، تبار واقعی رکوردها اینجا نمایش داده می‌شود.</span>
              </div>
            ) : hydrated ? (
              <Suspense
                fallback={<div className="memory-graph-placeholder">در حال آماده‌سازی WebGL…</div>}
              >
                <MemoryGraph3D data={memoryGraph} />
              </Suspense>
            ) : (
              <div className="memory-graph-placeholder">گراف پس از hydration فعال می‌شود.</div>
            )}
            {memoryGraph && (
              <footer className="memory-graph-governance">
                <span>{memoryGraph.governance.allowedNamespaceIds.length} namespace مجاز</span>
                <span>{memoryGraph.governance.appliedGrantIds.length} grant اعمال‌شده</span>
                <span>promoted only</span>
                <span>expired excluded</span>
              </footer>
            )}
          </section>

          <section className="economics-band" id="economics">
            <div>
              <span>ECONOMICS / ATTRIBUTED</span>
              <h2>P&amp;L کاسیو از TCO اکوسیستم جداست.</h2>
              <p>این اعداد فقط از ledger immutable و pricingVersion معتبر می‌آیند.</p>
            </div>
            <article>
              <span>Revenue</span>
              <strong>{pnl?.revenue ?? '—'}</strong>
              <small>{pnl?.currency ?? 'بدون داده'}</small>
            </article>
            <article>
              <span>Casioplus cost</span>
              <strong>{pnl?.casioplus_cost ?? '—'}</strong>
              <small>{pnl?.currency ?? 'بدون داده'}</small>
            </article>
            <article>
              <span>Ecosystem TCO</span>
              <strong>{tco?.ecosystem_tco ?? '—'}</strong>
              <small>{tco?.currency ?? 'بدون داده'}</small>
            </article>
          </section>
        </div>
      </main>

      {commandOpen && (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={() => setCommandOpen(false)}
        >
          <section
            className="command-panel"
            role="dialog"
            aria-modal="true"
            aria-label="فرمان‌های Console"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <Command size={17} />
              <input autoFocus placeholder="فرمان یا بخش را جست‌وجو کنید…" />
              <kbd>Esc</kbd>
            </div>
            <nav>
              <a href="#new-work" onClick={() => setCommandOpen(false)}>
                <Plus size={16} />
                <span>
                  <strong>Work جدید</strong>
                  <small>تعریف مسئله در Workspace فعلی</small>
                </span>
              </a>
              <a href="#memory" onClick={() => setCommandOpen(false)}>
                <BrainCircuit size={16} />
                <span>
                  <strong>جست‌وجوی حافظه</strong>
                  <small>purpose محدود به Console</small>
                </span>
              </a>
              <a href={rootData?.forgeUrl ?? 'http://localhost:5174'}>
                <Workflow size={16} />
                <span>
                  <strong>بازکردن Forge</strong>
                  <small>ساخت و انتشار Flow</small>
                </span>
              </a>
            </nav>
          </section>
        </div>
      )}
    </div>
  );
}
