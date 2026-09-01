import { formatStatusLabel } from '@casioplus/i18n/display-labels';
import { formatDateTime } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Pause, Play, RefreshCw } from 'lucide-react';

type Flow = {
  id: string;
  key: string;
  name: string;
  status: string;
  activeVersionId: string | null;
};

type FlowVersion = {
  id: string;
  version: number;
  runtimeBinding: string;
};

type TranslationSchedule = {
  id: string;
  flowId: string;
  flowVersionId: string;
  scheduleKey: string;
  status: 'paused' | 'active' | 'expired';
  cadenceSeconds: number;
  maxItems: number;
  messageKeyPrefixes: string[];
  nextRunAt: string;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastErrorCode: string | null;
};

type Props = {
  apiBase: string;
  csrfToken: string;
  role: string;
  flow?: Flow;
  activeVersion?: FlowVersion;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: Record<string, unknown>;
};

async function requestJson<T>(
  apiBase: string,
  path: string,
  csrfToken: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(method === 'GET' ? {} : { 'x-casioplus-csrf': csrfToken }),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error ?? `request_failed_${response.status}`);
  return body;
}

function cadenceLabel(seconds: number): string {
  if (seconds === 86_400) return m.forge_translation_schedule_daily();
  if (seconds === 604_800) return m.forge_translation_schedule_weekly();
  if (seconds === 2_592_000) return m.forge_translation_schedule_monthly();
  return `${seconds}s`;
}

export default function TranslationSchedulePanel({
  apiBase,
  csrfToken,
  role,
  flow,
  activeVersion,
}: Props) {
  const [schedules, setSchedules] = useState<TranslationSchedule[]>([]);
  const [cadenceSeconds, setCadenceSeconds] = useState(604_800);
  const [maxItems, setMaxItems] = useState(50);
  const [prefixes, setPrefixes] = useState('shared_,console_,forge_');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canManage = ['owner', 'admin', 'editor'].includes(role);
  const canActivate = ['owner', 'admin'].includes(role);
  const flowEligible = Boolean(
    flow &&
    activeVersion &&
    flow.status === 'published' &&
    flow.activeVersionId === activeVersion.id &&
    activeVersion.runtimeBinding === 'open-webui',
  );
  const selectedFlowSchedule = useMemo(
    () => schedules.find((schedule) => schedule.flowId === flow?.id),
    [flow?.id, schedules],
  );

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await requestJson<{ schedules: TranslationSchedule[] }>(
        apiBase,
        '/api/v1/translation-proposal-schedules',
        csrfToken,
      );
      setSchedules(result.schedules);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'translation_schedules_load_failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, csrfToken]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const mutate = useCallback(
    async (operation: () => Promise<void>, success: string) => {
      setPending(true);
      setError('');
      setNotice('');
      try {
        await operation();
        setNotice(success);
        await loadSchedules();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'translation_schedule_mutation_failed');
      } finally {
        setPending(false);
      }
    },
    [loadSchedules],
  );

  const createSchedule = useCallback(() => {
    if (!flow || !activeVersion || !flowEligible) return;
    const messageKeyPrefixes = prefixes
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    void mutate(async () => {
      await requestJson(apiBase, '/api/v1/translation-proposal-schedules', csrfToken, {
        method: 'POST',
        body: {
          flowId: flow.id,
          flowVersionId: activeVersion.id,
          scheduleKey: `translation-${flow.key}`,
          cadenceSeconds,
          maxItems,
          messageKeyPrefixes: messageKeyPrefixes.length > 0 ? messageKeyPrefixes : ['shared_'],
          nextRunAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          status: 'paused',
        },
      });
    }, m.forge_translation_schedule_created());
  }, [
    activeVersion,
    apiBase,
    cadenceSeconds,
    csrfToken,
    flow,
    flowEligible,
    maxItems,
    mutate,
    prefixes,
  ]);

  const updateStatus = useCallback(
    (schedule: TranslationSchedule, status: 'active' | 'paused') => {
      void mutate(async () => {
        await requestJson(
          apiBase,
          `/api/v1/translation-proposal-schedules/${schedule.id}`,
          csrfToken,
          { method: 'PATCH', body: { status } },
        );
      }, m.forge_translation_schedule_updated());
    },
    [apiBase, csrfToken, mutate],
  );

  return (
    <section className="translation-schedule-panel" aria-labelledby="translation-schedule-title">
      <header className="translation-review-header">
        <div>
          <span className="section-index">{m.forge_translation_schedule_index()}</span>
          <h2 id="translation-schedule-title">{m.forge_translation_schedule_title()}</h2>
          <p>{m.forge_translation_schedule_description()}</p>
        </div>
        <button
          type="button"
          className="icon-control"
          onClick={() => void loadSchedules()}
          disabled={loading || pending}
          aria-label={m.forge_translation_schedule_refresh()}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="translation-review-boundary">
        <CalendarClock size={16} />
        <span>{m.forge_translation_schedule_proposal_only()}</span>
      </div>

      <div className="translation-review-status" aria-live="polite">
        {notice && <span className="runtime-ready">{notice}</span>}
        {error && <code dir="ltr">{error}</code>}
      </div>

      {canManage && !selectedFlowSchedule && (
        <div className="translation-schedule-form">
          <div className="translation-schedule-flow">
            <span>{m.forge_translation_schedule_flow()}</span>
            <strong dir="auto">{flow?.name ?? m.forge_new_flow()}</strong>
            <small>
              {activeVersion
                ? `${m.forge_translation_schedule_active_version()}: ${activeVersion.version}`
                : m.forge_translation_schedule_requires_flow()}
            </small>
          </div>
          <label>
            <span>{m.forge_translation_schedule_cadence()}</span>
            <select
              value={cadenceSeconds}
              onChange={(event) => setCadenceSeconds(Number(event.target.value))}
            >
              <option value={86_400}>{m.forge_translation_schedule_daily()}</option>
              <option value={604_800}>{m.forge_translation_schedule_weekly()}</option>
              <option value={2_592_000}>{m.forge_translation_schedule_monthly()}</option>
            </select>
          </label>
          <label>
            <span>{m.forge_translation_schedule_max_items()}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxItems}
              onChange={(event) => setMaxItems(Number(event.target.value))}
            />
          </label>
          <label className="translation-schedule-prefixes">
            <span>{m.forge_translation_schedule_prefixes()}</span>
            <input
              dir="ltr"
              value={prefixes}
              onChange={(event) => setPrefixes(event.target.value)}
            />
            <small>{m.forge_translation_schedule_prefixes_hint()}</small>
          </label>
          <button
            type="button"
            className="primary-action"
            disabled={pending || !flowEligible || maxItems < 1 || maxItems > 100}
            onClick={createSchedule}
          >
            <CalendarClock size={14} /> {m.forge_translation_schedule_create_paused()}
          </button>
          {!flowEligible && (
            <small className="translation-schedule-requirement">
              {m.forge_translation_schedule_requires_flow()}
            </small>
          )}
        </div>
      )}

      <div className="translation-schedule-list">
        <h3>{m.forge_translation_schedule_existing()}</h3>
        {loading ? (
          <div className="inspector-empty">{m.forge_translation_schedule_loading()}</div>
        ) : schedules.length === 0 ? (
          <div className="inspector-empty">{m.forge_translation_schedule_empty()}</div>
        ) : (
          schedules.map((schedule) => (
            <article
              key={schedule.id}
              className={schedule.flowId === flow?.id ? 'active' : undefined}
            >
              <header>
                <code dir="ltr">{schedule.scheduleKey}</code>
                <span>{formatStatusLabel(schedule.status)}</span>
              </header>
              <dl>
                <div>
                  <dt>{m.forge_translation_schedule_cadence()}</dt>
                  <dd>{cadenceLabel(schedule.cadenceSeconds)}</dd>
                </div>
                <div>
                  <dt>{m.forge_translation_schedule_next_run()}</dt>
                  <dd>{formatDateTime(schedule.nextRunAt)}</dd>
                </div>
                <div>
                  <dt>{m.forge_translation_schedule_last_run()}</dt>
                  <dd>
                    {schedule.lastFinishedAt
                      ? formatDateTime(schedule.lastFinishedAt)
                      : m.forge_translation_schedule_never()}
                  </dd>
                </div>
              </dl>
              <small dir="ltr">{schedule.messageKeyPrefixes.join(', ')}</small>
              {schedule.lastErrorCode && (
                <p className="translation-schedule-error">
                  {m.forge_translation_schedule_last_error()}:{' '}
                  <code dir="ltr">{schedule.lastErrorCode}</code>
                </p>
              )}
              {canManage && schedule.status !== 'expired' && (
                <div className="translation-review-actions">
                  {schedule.status === 'active' ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => updateStatus(schedule, 'paused')}
                    >
                      <Pause size={13} /> {m.forge_translation_schedule_pause()}
                    </button>
                  ) : canActivate ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => updateStatus(schedule, 'active')}
                    >
                      <Play size={13} /> {m.forge_translation_schedule_activate()}
                    </button>
                  ) : (
                    <small>{m.forge_translation_schedule_owner_activation()}</small>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
