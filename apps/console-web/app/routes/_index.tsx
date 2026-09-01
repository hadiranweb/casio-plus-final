import { formatDateTime } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouteLoaderData } from '@remix-run/react';
import { CasioplusBrandMark } from '@casioplus/ui';
import type { loader as rootLoader } from '../root.js';
import type { MemoryGraphData } from '../components/MemoryGraph3D.client.js';

const MemoryGraph3D = lazy(() => import('../components/MemoryGraph3D.client.js'));
const OrganizationControlPanel = lazy(
  () => import('../components/OrganizationControlPanel.client.js'),
);
const GovernanceControlPanel = lazy(() => import('../components/GovernanceControlPanel.client.js'));
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
};

const initialApiState: ApiState = {
  workItems: [],
  flows: [],
  runs: [],
  memories: [],
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
  return formatDateTime(value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    open: m.console_home_status_open(),
    in_progress: m.console_home_status_in_progress(),
    completed: m.console_home_status_completed(),
    draft: m.console_home_status_draft(),
    published: m.console_home_status_published(),
    running: m.console_home_status_running(),
    succeeded: m.console_home_status_succeeded(),
    failed: m.console_home_status_failed(),
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
        <div className="auth-kicker">{m.console_home_auth_kicker()}</div>
        <h1 id="auth-title">{m.console_home_auth_title()}</h1>
        <p>{m.console_home_auth_desc()}</p>
        <div className="auth-principles">
          <span>
            <ShieldCheck size={16} /> {m.console_home_principle_default_deny_memory()}
          </span>
          <span>
            <Network size={16} /> {m.console_home_principle_core_only_writer()}
          </span>
          <span>
            <Gauge size={16} /> {m.console_home_principle_usage_attribution()}
          </span>
        </div>
      </section>
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-tabs" role="group" aria-label={m.console_home_auth_type()}>
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            aria-pressed={mode === 'login'}
            onClick={() => setMode('login')}
          >
            {m.console_home_auth_login()}
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            aria-pressed={mode === 'register'}
            onClick={() => setMode('register')}
          >
            {m.console_home_auth_register()}
          </button>
        </div>
        <div className="auth-heading">
          <span>
            {mode === 'login' ? m.console_home_auth_return() : m.console_home_auth_start()}
          </span>
          <strong>
            {mode === 'login'
              ? m.console_home_auth_org_session()
              : m.console_home_auth_initial_org()}
          </strong>
        </div>
        {mode === 'register' && (
          <div className="form-pair">
            <label>
              {m.console_home_auth_your_name()}
              <input
                required
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              {m.console_home_auth_org_name()}
              <input
                required
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </label>
            <label>
              {m.console_home_auth_org_key()}
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
              {m.console_home_auth_workspace_key()}
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
          {m.console_home_auth_email()}
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
          {m.console_home_auth_password()}
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
          {pending
            ? m.console_home_auth_checking()
            : mode === 'login'
              ? m.console_home_auth_login_btn()
              : m.console_home_auth_create_org()}
          <ArrowLeft size={16} />
        </button>
        <small>{m.console_home_auth_pwd_hint()}</small>
      </form>
    </main>
  );
}

export default function Console() {
  const rootData = useRouteLoaderData<typeof rootLoader>('root');
  const apiBase = rootData?.coreApiUrl ?? 'http://localhost:8080';
  const [session, setSession] = useState<Session | null>(null);
  const [scope, setScope] = useState<OrganizationScope | null>(null);
  const [availableScopes, setAvailableScopes] = useState<OrganizationScope[]>([]);
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
        const [scopeResponse, workResponse, flowResponse, runResponse] = await Promise.all([
          requestJson<{ items: OrganizationScope[] }>(apiBase, '/api/v1/organizations'),
          requestJson<{ items: WorkItem[] }>(apiBase, '/api/v1/work-items'),
          requestJson<{ flows: Flow[] }>(apiBase, '/api/v1/flows'),
          requestJson<{ runs: ProcessRun[] }>(apiBase, '/api/v1/process-runs'),
        ]);
        const activeScope =
          scopeResponse.items.find(
            (item) =>
              item.organizationId === activeSession.context.organizationId &&
              item.workspaceId === activeSession.context.workspaceId,
          ) ?? null;
        setSession(activeSession);
        setScope(activeScope);
        setAvailableScopes(scopeResponse.items);
        setData((current) => ({
          ...current,
          workItems: workResponse.items,
          flows: flowResponse.flows,
          runs: runResponse.runs,
        }));
      } catch (requestError) {
        if (requestError instanceof ApiError && requestError.status === 401) {
          setSession(null);
          setScope(null);
          setAvailableScopes([]);
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
      setNotice(m.console_home_work_created());
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
      setAvailableScopes([]);
      setMemoryGraph(null);
      setData(initialApiState);
    }
  };

  if (booting) {
    return (
      <main className="boot-screen">
        <CasioplusBrandMark />
        <span>{m.console_home_boot_secure()}</span>
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
      label: m.console_home_metric_open_work(),
      value: data.workItems.filter((item) => item.status !== 'completed').length,
      icon: Activity,
    },
    {
      label: m.console_home_metric_published_flow(),
      value: data.flows.filter((flow) => flow.status === 'published').length,
      icon: Workflow,
    },
    {
      label: m.console_home_metric_failed_run(),
      value: data.runs.filter((run) => run.status === 'failed').length,
      icon: CircleAlert,
    },
    {
      label: m.console_home_metric_memory_finding(),
      value: data.memories.length,
      icon: BrainCircuit,
    },
  ];

  return (
    <div className="console-shell">
      <button
        className="mobile-menu"
        onClick={() => setRailOpen(true)}
        aria-label={m.console_home_nav_open()}
      >
        <Menu size={20} />
      </button>
      {railOpen && (
        <button
          className="rail-scrim"
          aria-label={m.console_home_nav_close()}
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
          <button onClick={() => setRailOpen(false)} aria-label={m.console_home_close()}>
            <X size={18} />
          </button>
        </div>
        <a className="scope-card" href="#settings" onClick={() => setRailOpen(false)}>
          <span className="live-dot" />
          <div>
            <small>{m.shared_workspace()}</small>
            <strong>{scope?.workspaceName ?? '—'}</strong>
            <span>{scope?.organizationName ?? '—'}</span>
          </div>
          <ChevronLeft size={15} />
        </a>
        <nav aria-label={m.console_home_nav_label()}>
          <span className="nav-label">{m.console_home_nav_ops()}</span>
          <a className="rail-link active" href="#overview">
            <LayoutDashboard size={17} />
            {m.console_home_nav_overview()}
          </a>
          <a className="rail-link" href="#decisions">
            <Activity size={17} />
            {m.console_home_nav_decision_queue()}
          </a>
          <a className="rail-link" href="#memory">
            <BrainCircuit size={17} />
            {m.console_home_nav_memory()}
          </a>
          <a className="rail-link" href="#memory-graph">
            <Network size={17} />
            {m.console_home_nav_memory_graph()}
          </a>
          <a className="rail-link" href="#economics">
            <WalletCards size={17} />
            {m.console_home_nav_economics()}
          </a>
          <span className="nav-label">{m.console_home_nav_control()}</span>
          <a className="rail-link" href="#governance">
            <ShieldCheck size={17} />
            {m.console_home_nav_governance()}
          </a>
          <a className="rail-link" href="#settings">
            <Settings2 size={17} />
            {m.console_home_nav_settings()}
          </a>
        </nav>
        <div className="rail-foot">
          <div className="core-state">
            <span className="live-dot" />
            <div>
              <strong>{m.console_home_core_api()}</strong>
              <small>{m.console_home_valid_session()}</small>
            </div>
          </div>
          <a href={rootData?.forgeUrl ?? 'http://localhost:5174'}>
            {m.console_home_go_forge()} <ArrowUpLeft size={14} />
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
              {m.console_home_search_action()} <kbd>⌘ K</kbd>
            </button>
            <div className="identity-chip">
              <div>{session.user.displayName.slice(0, 1)}</div>
              <span>
                <strong>{session.user.displayName}</strong>
                <small>{session.context.role}</small>
              </span>
            </div>
            <button className="icon-control" onClick={logout} aria-label={m.console_home_logout()}>
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <div className="console-content">
          <section className="signal-header">
            <div>
              <span className="section-code">{m.console_home_control_now()}</span>
              <h1>{m.console_home_today_decisions()}</h1>
              <p>{m.console_home_today_desc()}</p>
            </div>
            <a className="primary-action" href="#new-work">
              <Plus size={16} />
              {m.console_home_new_work()}
            </a>
          </section>

          {error && (
            <div className="inline-alert error">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError('')}>{m.console_home_close()}</button>
            </div>
          )}
          {notice && (
            <div className="inline-alert success">
              <CheckCircle2 size={16} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>{m.console_home_close()}</button>
            </div>
          )}

          <section className="signal-strip" aria-label={m.console_home_workspace_metrics()}>
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
                  <span>{m.console_home_decision_queue_overline()}</span>
                  <h2>{m.console_home_work_needs_action()}</h2>
                </div>
                <b>{data.workItems.length}</b>
              </div>
              {data.workItems.length === 0 ? (
                <div className="empty-state">
                  <FileJson2 size={24} />
                  <strong>{m.console_home_queue_empty()}</strong>
                  <span>{m.console_home_queue_empty_desc()}</span>
                </div>
              ) : (
                <div className="data-list">
                  {data.workItems.slice(0, 6).map((work) => (
                    <div className="data-row" key={work.id}>
                      <span className={`status-mark ${work.status}`} />
                      <div>
                        <strong>{work.title}</strong>
                        <span>{work.intent || m.console_home_no_extra_context()}</span>
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
                  <span>{m.console_home_run_timeline_overline()}</span>
                  <h2>{m.console_home_last_runs()}</h2>
                </div>
                <span className="live-label">{m.console_home_last_data()}</span>
              </div>
              {data.runs.length === 0 ? (
                <div className="empty-state">
                  <Activity size={24} />
                  <strong>{m.console_home_no_runs()}</strong>
                  <span>{m.console_home_no_runs_desc()}</span>
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
                  <span>{m.console_home_active_flow()}</span>
                  <strong>{activeFlow.name}</strong>
                </div>
              )}
            </article>
          </section>

          <section className="lower-grid">
            <form className="surface work-form" id="new-work" onSubmit={createWorkItem}>
              <div className="surface-head">
                <div>
                  <span>{m.console_home_new_work_overline()}</span>
                  <h2>{m.console_home_define_problem()}</h2>
                </div>
                <span>{m.console_home_setup_progress()}</span>
              </div>
              <label>
                {m.console_home_problem_title()}
                <input
                  value={workTitle}
                  onChange={(event) => setWorkTitle(event.target.value)}
                  placeholder={m.console_home_problem_placeholder()}
                />
              </label>
              <label>
                {m.console_home_expected_result()}
                <textarea
                  value={workIntent}
                  onChange={(event) => setWorkIntent(event.target.value)}
                  placeholder={m.console_home_expected_placeholder()}
                />
              </label>
              <button className="primary-action" type="submit" disabled={!workTitle.trim()}>
                <Plus size={16} />
                {m.console_home_submit_work()}
              </button>
            </form>

            <section className="surface memory-surface" id="memory">
              <div className="surface-head">
                <div>
                  <span>{m.console_home_governed_memory_overline()}</span>
                  <h2>{m.console_home_search_knowledge()}</h2>
                </div>
                <BrainCircuit size={20} />
              </div>
              <form className="search-field" onSubmit={searchMemory}>
                <Search size={16} />
                <input
                  value={memoryQuery}
                  onChange={(event) => setMemoryQuery(event.target.value)}
                  placeholder={m.console_home_search_placeholder()}
                />
                <button aria-label={m.console_home_search()}>
                  <ArrowLeft size={16} />
                </button>
              </form>
              {!searched ? (
                <div className="memory-guide">
                  <ShieldCheck size={20} />
                  <span>{m.console_home_memory_guide()}</span>
                </div>
              ) : data.memories.length === 0 ? (
                <div className="empty-state compact">
                  <strong>{m.console_home_no_results()}</strong>
                </div>
              ) : (
                <div className="memory-results">
                  {data.memories.slice(0, 4).map((memory) => (
                    <article key={memory.id}>
                      <span>{memory.kind}</span>
                      <strong>{memory.title}</strong>
                      <p>
                        {String(
                          memory.content.finding ??
                            memory.content.summary ??
                            m.console_home_governed_record(),
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
                <span>{m.console_home_memory_lineage_overline()}</span>
                <h2>{m.console_home_3d_graph()}</h2>
                <p>{m.console_home_3d_graph_desc()}</p>
              </div>
              <button
                className="secondary-action"
                type="button"
                data-testid="load-memory-graph"
                onClick={() => void loadMemoryGraph()}
                disabled={graphLoading}
              >
                <Network size={16} />
                {graphLoading
                  ? m.console_home_loading()
                  : memoryGraph
                    ? m.console_home_refresh_graph()
                    : m.console_home_load_graph()}
              </button>
            </div>
            {!memoryGraph ? (
              <div className="memory-graph-placeholder">
                <Network size={26} />
                <strong>{m.console_home_graph_on_demand()}</strong>
                <span>{m.console_home_graph_no_download()}</span>
              </div>
            ) : memoryGraph.nodes.length === 0 ? (
              <div className="empty-state">
                <BrainCircuit size={24} />
                <strong>{m.console_home_no_promoted_memory()}</strong>
                <span>{m.console_home_promoted_memory_desc()}</span>
              </div>
            ) : hydrated ? (
              <Suspense
                fallback={
                  <div className="memory-graph-placeholder">{m.console_home_preparing_webgl()}</div>
                }
              >
                <MemoryGraph3D data={memoryGraph} />
              </Suspense>
            ) : (
              <div className="memory-graph-placeholder">
                {m.console_home_graph_after_hydration()}
              </div>
            )}
            {memoryGraph && (
              <footer className="memory-graph-governance">
                <span>
                  {memoryGraph.governance.allowedNamespaceIds.length}{' '}
                  {m.console_home_allowed_namespace()}
                </span>
                <span>
                  {memoryGraph.governance.appliedGrantIds.length} {m.console_home_applied_grant()}
                </span>
                <span>{m.console_home_promoted_only()}</span>
                <span>{m.console_home_expired_excluded()}</span>
              </footer>
            )}
          </section>

          {hydrated && (
            <Suspense
              fallback={
                <section className="organization-control" id="settings">
                  <div className="memory-graph-placeholder">
                    {m.console_home_preparing_org_control()}
                  </div>
                </section>
              }
            >
              <OrganizationControlPanel
                apiBase={apiBase}
                csrfToken={csrfToken}
                currentActorId={session.context.actorId}
                currentRole={session.context.role}
                currentScope={scope}
                availableScopes={availableScopes}
                onContextChanged={bootstrap}
                onNotice={setNotice}
                onError={setError}
              />
            </Suspense>
          )}

          {hydrated && (
            <Suspense
              fallback={
                <section className="governance-control" id="governance">
                  <div className="memory-graph-placeholder">
                    {m.console_home_preparing_gov_control()}
                  </div>
                </section>
              }
            >
              <GovernanceControlPanel
                apiBase={apiBase}
                csrfToken={csrfToken}
                organizationId={session.context.organizationId}
                workspaceId={session.context.workspaceId}
                role={session.context.role}
                flows={data.flows}
              />
            </Suspense>
          )}
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
            aria-label={m.console_home_console_commands()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <Command size={17} />
              <input autoFocus placeholder={m.console_home_search_command()} />
              <kbd>Esc</kbd>
            </div>
            <nav>
              <a href="#new-work" onClick={() => setCommandOpen(false)}>
                <Plus size={16} />
                <span>
                  <strong>{m.console_home_new_work()}</strong>
                  <small>{m.console_home_define_problem_ws()}</small>
                </span>
              </a>
              <a href="#memory" onClick={() => setCommandOpen(false)}>
                <BrainCircuit size={16} />
                <span>
                  <strong>{m.console_home_search_memory()}</strong>
                  <small>{m.console_home_purpose_limited()}</small>
                </span>
              </a>
              <a href={rootData?.forgeUrl ?? 'http://localhost:5174'}>
                <Workflow size={16} />
                <span>
                  <strong>{m.console_home_open_forge()}</strong>
                  <small>{m.console_home_build_flow()}</small>
                </span>
              </a>
            </nav>
          </section>
        </div>
      )}
    </div>
  );
}
