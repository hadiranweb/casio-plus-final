import { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, Clock3, Play, RefreshCw, ShieldCheck } from 'lucide-react';

type Flow = {
  id: string;
  name: string;
  activeVersionId: string | null;
};

type FlowVersion = {
  id: string;
  version: number;
  runtimeBinding: string;
};

type ProcessRun = {
  id: string;
  flowId: string;
  flowVersionId: string;
  workItemId: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

type Props = {
  apiBase: string;
  csrfToken: string;
  flow: Flow | undefined;
  versions: FlowVersion[];
};

const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);

async function requestJson<T>(
  apiBase: string,
  path: string,
  csrfToken: string,
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
    const error = new Error(body.error ?? `request_failed_${response.status}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function defaultInput(runtime: string) {
  if (runtime === 'open-webui') return '{\n  "prompt": ""\n}';
  if (runtime === 'openclaw') return '{\n  "message": ""\n}';
  return '{\n  "payload": {}\n}';
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

export default function RunControlPanel({ apiBase, csrfToken, flow, versions }: Props) {
  const activeVersion = useMemo(
    () => versions.find((version) => version.id === flow?.activeVersionId),
    [flow?.activeVersionId, versions],
  );
  const [runs, setRuns] = useState<ProcessRun[]>([]);
  const [workTitle, setWorkTitle] = useState('');
  const [workIntent, setWorkIntent] = useState('');
  const [inputText, setInputText] = useState(
    defaultInput(activeVersion?.runtimeBinding ?? 'native'),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadRuns = useCallback(async () => {
    const response = await requestJson<{ runs: ProcessRun[] }>(
      apiBase,
      '/api/v1/process-runs',
      csrfToken,
    );
    setRuns(response.runs.filter((run) => !flow || run.flowId === flow.id));
  }, [apiBase, csrfToken, flow]);

  useEffect(() => {
    void loadRuns().catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : 'process_runs_load_failed');
    });
  }, [loadRuns]);

  useEffect(() => {
    setInputText(defaultInput(activeVersion?.runtimeBinding ?? 'native'));
  }, [activeVersion?.id, activeVersion?.runtimeBinding]);

  useEffect(() => {
    if (!runs.some((run) => !terminalStatuses.has(run.status))) return;
    const timer = window.setInterval(() => {
      void loadRuns();
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [loadRuns, runs]);

  const dispatchRun = async (processRunId: string) => {
    try {
      await requestJson(apiBase, `/api/v1/process-runs/${processRunId}/execute`, csrfToken, {
        method: 'POST',
        body: '{}',
      });
      setNotice('اجرا از Core queue شد. status و result فقط از ledger canonical خوانده می‌شود.');
    } catch (requestError) {
      const apiError = requestError as Error & { status?: number };
      if (apiError.status === 409 && apiError.message === 'openclaw_approval_required') {
        await requestJson(apiBase, '/api/v1/action-approvals', csrfToken, {
          method: 'POST',
          body: JSON.stringify({ processRunId, expiresInSeconds: 900 }),
        });
        setNotice('درخواست اقدام ثبت شد و تا تصمیم انسانی در Approval Inbox اجرا نمی‌شود.');
        return;
      }
      throw requestError;
    }
  };

  const execute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flow || !activeVersion || !workTitle.trim()) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const input = JSON.parse(inputText) as Record<string, unknown>;
      const workItem = await requestJson<{ id: string }>(apiBase, '/api/v1/work-items', csrfToken, {
        method: 'POST',
        body: JSON.stringify({ title: workTitle, intent: workIntent || null }),
      });
      const created = await requestJson<{ run: ProcessRun }>(
        apiBase,
        '/api/v1/process-runs',
        csrfToken,
        {
          method: 'POST',
          body: JSON.stringify({
            workItemId: workItem.id,
            flowId: flow.id,
            flowVersionId: activeVersion.id,
            idempotencyKey: `forge-${crypto.randomUUID()}`,
            input,
          }),
        },
      );
      await dispatchRun(created.run.id);
      setWorkTitle('');
      setWorkIntent('');
      await loadRuns();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'process_run_creation_failed',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="run-control-panel" aria-labelledby="run-control-heading">
      <div className="inspector-head">
        <span id="run-control-heading">RUN CONTROL</span>
        <button type="button" onClick={() => void loadRuns()} aria-label="تازه‌سازی اجراها">
          <RefreshCw size={14} />
        </button>
      </div>

      {!flow || !activeVersion ? (
        <div className="run-control-empty">
          <ShieldCheck size={18} />
          <span>برای اجرا ابتدا یک version را منتشر کنید.</span>
        </div>
      ) : (
        <>
          <div className="active-version-line">
            <span>version فعال</span>
            <strong>v{activeVersion.version}</strong>
            <small>{activeVersion.runtimeBinding}</small>
          </div>
          <form onSubmit={execute} className="run-form">
            <label>
              عنوان Work
              <input
                value={workTitle}
                onChange={(event) => setWorkTitle(event.target.value)}
                maxLength={200}
                placeholder="هدف مشخص این اجرا"
                required
              />
            </label>
            <label>
              intent
              <input
                value={workIntent}
                onChange={(event) => setWorkIntent(event.target.value)}
                maxLength={2_000}
                placeholder="نتیجهٔ مورد انتظار"
              />
            </label>
            <label>
              input.json
              <textarea
                dir="ltr"
                spellCheck={false}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                rows={7}
              />
            </label>
            <button className="run-action" type="submit" disabled={loading || !workTitle.trim()}>
              <Play size={14} />
              {loading ? 'در حال ثبت…' : 'ثبت و اجرا'}
            </button>
          </form>
        </>
      )}

      {error && (
        <div className="run-message error">
          <CircleAlert size={14} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="run-message notice">
          <ShieldCheck size={14} />
          <span>{notice}</span>
        </div>
      )}

      <div className="run-list" aria-live="polite">
        {runs.length === 0 ? (
          <div className="run-control-empty">
            <Clock3 size={18} />
            <span>اجرایی برای Flow انتخاب‌شده ثبت نشده است.</span>
          </div>
        ) : (
          runs.slice(0, 8).map((run) => (
            <article key={run.id}>
              <div>
                <strong>{run.status}</strong>
                <span>{new Date(run.createdAt).toLocaleString('fa-IR')}</span>
              </div>
              {run.errorCode && <code>{run.errorCode}</code>}
              {run.status === 'queued' && (
                <button
                  className="resume-run-action"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setLoading(true);
                    setError('');
                    void dispatchRun(run.id)
                      .then(loadRuns)
                      .catch((requestError: unknown) => {
                        setError(
                          requestError instanceof Error
                            ? requestError.message
                            : 'process_run_execution_failed',
                        );
                      })
                      .finally(() => setLoading(false));
                  }}
                >
                  ادامهٔ اجرا
                </button>
              )}
              {run.output && <pre>{formatValue(run.output)}</pre>}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
