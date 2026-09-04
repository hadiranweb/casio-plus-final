import { formatDateTime, formatNumber } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
import { Activity, CircleAlert, UserRoundCheck } from 'lucide-react';

type RunSummary = {
  id: string;
  status: string;
  createdAt: string;
};

type RuntimeEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
};

type Trace = {
  run: {
    id: string;
    status: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    createdAt: string;
    completedAt: string | null;
  };
  events: RuntimeEvent[];
};

type CandidateAxis = {
  score?: number;
  evidence?: string[];
};

type CandidateEvaluation = {
  candidateId?: string;
  confidence?: number;
  overallAssessment?: string;
  recommendation?: string;
  missingEvidence?: string[];
  axes?: Record<string, CandidateAxis>;
};

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    input_captured: m.console_home_analysis_stage_input_captured(),
    'analysis.started': m.console_home_analysis_stage_analysis_started(),
    'diagnosis.completed': m.console_home_analysis_stage_diagnosis_completed(),
  };
  return labels[type] ?? type;
}

function asCandidateEvaluations(value: unknown): CandidateEvaluation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is CandidateEvaluation => Boolean(item) && typeof item === 'object',
  );
}

function axisLabel(axis: string) {
  return axis.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export type { Trace as FlowRunTrace, RunSummary as FlowRunSummary };

export default function FlowRunAnalysisPanel({
  runs,
  selectedRunId,
  onSelectRun,
  trace,
  loading,
  error,
}: {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  trace: Trace | null;
  loading: boolean;
  error: string;
}) {
  const candidates = asCandidateEvaluations(trace?.run.output?.candidateEvaluations);

  return (
    <section className="surface analysis-surface" id="run-analysis" aria-busy={loading}>
      <div className="surface-head analysis-heading">
        <div>
          <span>{m.console_home_analysis_overline()}</span>
          <h2>{m.console_home_analysis_heading()}</h2>
          <p>{m.console_home_analysis_desc()}</p>
        </div>
        <label className="analysis-run-select">
          <span>{m.console_home_analysis_select_run()}</span>
          <select
            value={selectedRunId ?? ''}
            onChange={(event) => onSelectRun(event.target.value)}
            aria-label={m.console_home_analysis_select_run()}
          >
            {runs.slice(0, 10).map((run) => (
              <option key={run.id} value={run.id}>
                {m.console_home_analysis_run()} {run.id.slice(0, 8)} · {run.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="analysis-pending">{m.console_home_analysis_trace_loading()}</div>
      ) : error ? (
        <div className="analysis-error" role="alert">
          <CircleAlert size={16} /> {m.console_home_analysis_trace_load_failed()}
        </div>
      ) : !trace ? null : (
        <div className="analysis-body">
          <div className="analysis-summary">
            <span>{m.console_home_analysis_run()}</span>
            <bdi dir="ltr">{trace.run.id}</bdi>
            <small>
              {formatDateTime(trace.run.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
            </small>
          </div>

          <div className="analysis-grid">
            <section className="analysis-candidates" aria-labelledby="candidate-analysis-heading">
              <div className="analysis-section-heading">
                <UserRoundCheck size={17} />
                <h3 id="candidate-analysis-heading">
                  {m.console_home_analysis_candidate_assessments()}
                </h3>
              </div>
              {candidates.length === 0 ? (
                <p className="analysis-empty">{m.console_home_analysis_no_records()}</p>
              ) : (
                <div className="candidate-list">
                  {candidates.map((candidate, index) => (
                    <article
                      className="candidate-evaluation"
                      key={`${candidate.candidateId ?? 'candidate'}-${index}`}
                    >
                      <header>
                        <strong dir="ltr">
                          {candidate.candidateId ?? `candidate-${index + 1}`}
                        </strong>
                        {typeof candidate.confidence === 'number' && (
                          <span>
                            {formatNumber(candidate.confidence, {
                              style: 'percent',
                              maximumFractionDigits: 0,
                            })}
                          </span>
                        )}
                      </header>
                      {candidate.overallAssessment && (
                        <p>
                          <b>{m.console_home_analysis_overall_assessment()}</b>
                          {candidate.overallAssessment}
                        </p>
                      )}
                      {candidate.recommendation && (
                        <p>
                          <b>{m.console_home_analysis_recommendation()}</b>
                          {candidate.recommendation}
                        </p>
                      )}
                      {candidate.axes && (
                        <dl className="axis-list">
                          <div className="axis-title">{m.console_home_analysis_axes()}</div>
                          {Object.entries(candidate.axes).map(([axis, detail]) => (
                            <div className="axis-row" key={axis}>
                              <dt dir="ltr">{axisLabel(axis)}</dt>
                              <dd>
                                {typeof detail.score === 'number'
                                  ? formatNumber(detail.score, {
                                      style: 'percent',
                                      maximumFractionDigits: 0,
                                    })
                                  : '—'}
                              </dd>
                              {detail.evidence?.[0] && <span dir="auto">{detail.evidence[0]}</span>}
                            </div>
                          ))}
                        </dl>
                      )}
                      {candidate.missingEvidence && candidate.missingEvidence.length > 0 && (
                        <p className="missing-evidence">
                          <b>{m.console_home_analysis_missing_evidence()}</b>
                          <span dir="ltr">{candidate.missingEvidence.join(', ')}</span>
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section
              className="analysis-trace-column"
              aria-label={m.console_home_analysis_event_timeline()}
            >
              <div className="analysis-section-heading">
                <Activity size={17} />
                <h3>{m.console_home_analysis_event_timeline()}</h3>
              </div>
              {trace.events.length === 0 ? (
                <p className="analysis-empty">{m.console_home_analysis_no_events()}</p>
              ) : (
                <ol className="execution-stages">
                  {trace.events.map((event) => (
                    <li key={event.id}>
                      <span className="stage-dot" />
                      <div>
                        <strong>{eventLabel(event.type)}</strong>
                        <small>
                          {formatDateTime(event.occurredAt, {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
