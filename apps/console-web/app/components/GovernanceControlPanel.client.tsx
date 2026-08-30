import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  CircleAlert,
  Coins,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { requestControlPlaneJson } from './control-plane-api.client.js';

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

type ActionTarget = {
  id: string;
  key: string;
  action: string;
  executorRef: string;
  status: string;
  createdAt: string;
};

type ActionPolicy = {
  id: string;
  flowId: string;
  flowName: string;
  flowVersionId: string;
  flowVersion: number;
  targetId: string;
  targetKey: string;
  riskClass: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
};

type Approval = {
  id: string;
  processRunId: string;
  action: string;
  targetKey: string;
  riskClass: string;
  requestPayload: Record<string, unknown>;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type PricingVersion = {
  id: string;
  key: string;
  version: number;
  status: string;
  assumptions: Record<string, unknown>;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdAt: string;
};

type MeterBinding = {
  id: string;
  runtime: 'open-webui' | 'openclaw';
  operation: string;
  resourceKey: string;
  pricingVersionId: string;
  pricingKey: string;
  pricingVersion: number;
  currency: string;
  payer: string;
  directUnitCost: string;
  inputTokenUnitCost: string;
  outputTokenUnitCost: string;
  allocatedSharedCost: string;
  billableMultiplier: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
};

type EconomicsRow = Record<string, string>;

type Props = {
  apiBase: string;
  csrfToken: string;
  organizationId: string;
  workspaceId: string;
  role: string;
  flows: Flow[];
};

const reviewerRoles = new Set(['owner', 'admin', 'reviewer']);
const administrativeRoles = new Set(['owner', 'admin']);

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : new Date().toISOString();
}

function formatCurrency(value: string | undefined, currency: string | undefined) {
  if (!value || !currency) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 8,
  }).format(Number(value));
}

function safeJson(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('assumptions_must_be_object');
  }
  return parsed as Record<string, unknown>;
}

export default function GovernanceControlPanel({
  apiBase,
  csrfToken,
  organizationId,
  workspaceId,
  role,
  flows,
}: Props) {
  const canReview = reviewerRoles.has(role);
  const canAdmin = administrativeRoles.has(role);
  const [targets, setTargets] = useState<ActionTarget[]>([]);
  const [policies, setPolicies] = useState<ActionPolicy[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pricingVersions, setPricingVersions] = useState<PricingVersion[]>([]);
  const [bindings, setBindings] = useState<MeterBinding[]>([]);
  const [pnl, setPnl] = useState<EconomicsRow[]>([]);
  const [tco, setTco] = useState<EconomicsRow[]>([]);
  const [versions, setVersions] = useState<FlowVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});

  const [targetKey, setTargetKey] = useState('');
  const [executorRef, setExecutorRef] = useState('');
  const [policyFlowId, setPolicyFlowId] = useState('');
  const [policyVersionId, setPolicyVersionId] = useState('');
  const [policyTargetId, setPolicyTargetId] = useState('');
  const [riskClass, setRiskClass] = useState('medium');

  const [pricingKey, setPricingKey] = useState('');
  const [pricingVersion, setPricingVersion] = useState('1');
  const [pricingStatus, setPricingStatus] = useState('planning');
  const [assumptionsText, setAssumptionsText] = useState('{\n  "source": "planning"\n}');
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  );

  const [meterRuntime, setMeterRuntime] = useState<'open-webui' | 'openclaw'>('open-webui');
  const [meterResourceKey, setMeterResourceKey] = useState('');
  const [meterPricingId, setMeterPricingId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [payer, setPayer] = useState('casioplus');
  const [directUnitCost, setDirectUnitCost] = useState('0');
  const [inputTokenUnitCost, setInputTokenUnitCost] = useState('0');
  const [outputTokenUnitCost, setOutputTokenUnitCost] = useState('0');
  const [allocatedSharedCost, setAllocatedSharedCost] = useState('0');
  const [billableMultiplier, setBillableMultiplier] = useState('1');

  const activeTargets = useMemo(
    () => targets.filter((target) => target.status === 'active'),
    [targets],
  );
  const activePricing = useMemo(
    () => pricingVersions.filter((version) => version.status === 'active'),
    [pricingVersions],
  );
  const openClawVersions = useMemo(
    () => versions.filter((version) => version.runtimeBinding === 'openclaw'),
    [versions],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!canReview) return;
      const approvalResponse = await requestControlPlaneJson<{ approvals: Approval[] }>(
        apiBase,
        '/api/v1/action-approvals?status=pending',
        csrfToken,
      );
      setApprovals(approvalResponse.approvals);
      if (!canAdmin) return;
      const [
        targetResponse,
        policyResponse,
        pricingResponse,
        bindingResponse,
        pnlResponse,
        tcoResponse,
      ] = await Promise.all([
        requestControlPlaneJson<{ targets: ActionTarget[] }>(
          apiBase,
          '/api/v1/action-targets',
          csrfToken,
        ),
        requestControlPlaneJson<{ policies: ActionPolicy[] }>(
          apiBase,
          '/api/v1/action-policies',
          csrfToken,
        ),
        requestControlPlaneJson<{ pricingVersions: PricingVersion[] }>(
          apiBase,
          '/api/v1/pricing-assumptions',
          csrfToken,
        ),
        requestControlPlaneJson<{ bindings: MeterBinding[] }>(
          apiBase,
          '/api/v1/runtime-meter-bindings',
          csrfToken,
        ),
        requestControlPlaneJson<{ summary: EconomicsRow[] }>(
          apiBase,
          '/api/v1/usage/summary?view=casioplus_pnl',
          csrfToken,
        ),
        requestControlPlaneJson<{ summary: EconomicsRow[] }>(
          apiBase,
          '/api/v1/usage/summary?view=ecosystem_tco',
          csrfToken,
        ),
      ]);
      setTargets(targetResponse.targets);
      setPolicies(policyResponse.policies);
      setPricingVersions(pricingResponse.pricingVersions);
      setBindings(bindingResponse.bindings);
      setPnl(pnlResponse.summary);
      setTco(tcoResponse.summary);
      setPolicyTargetId(
        (current) =>
          current || targetResponse.targets.find((item) => item.status === 'active')?.id || '',
      );
      setMeterPricingId(
        (current) =>
          current ||
          pricingResponse.pricingVersions.find((item) => item.status === 'active')?.id ||
          '',
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'governance_load_failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, canAdmin, canReview, csrfToken]);

  useEffect(() => {
    setTargets([]);
    setPolicies([]);
    setApprovals([]);
    setPricingVersions([]);
    setBindings([]);
    setPnl([]);
    setTco([]);
    void load();
  }, [load, organizationId, workspaceId]);

  useEffect(() => {
    if (!policyFlowId) {
      setVersions([]);
      setPolicyVersionId('');
      return;
    }
    void requestControlPlaneJson<{ versions: FlowVersion[] }>(
      apiBase,
      `/api/v1/flows/${policyFlowId}/versions`,
      csrfToken,
    )
      .then((response) => {
        setVersions(response.versions);
        setPolicyVersionId(
          response.versions.find((version) => version.runtimeBinding === 'openclaw')?.id ?? '',
        );
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error ? requestError.message : 'flow_versions_load_failed',
        );
      });
  }, [apiBase, csrfToken, policyFlowId]);

  const perform = async (operation: () => Promise<void>, successMessage: string) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(successMessage);
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'governance_operation_failed',
      );
    } finally {
      setPending(false);
    }
  };

  const decide = (approval: Approval, decision: 'approved' | 'rejected') => {
    const reason = decisionReasons[approval.id]?.trim();
    if (!reason) {
      setError('برای تصمیم approval دلیل ثبت کنید.');
      return;
    }
    void perform(
      async () => {
        await requestControlPlaneJson(
          apiBase,
          `/api/v1/action-approvals/${approval.id}/decisions`,
          csrfToken,
          { method: 'POST', body: JSON.stringify({ decision, reason }) },
        );
      },
      decision === 'approved'
        ? 'اقدام تأیید شد؛ execution همچنان فقط از Core انجام می‌شود.'
        : 'اقدام رد شد.',
    );
  };

  if (!canReview) {
    return (
      <section className="governance-control" id="governance">
        <header>
          <div>
            <span>GOVERNANCE CONTROL</span>
            <h2>این role به Approval Inbox دسترسی ندارد.</h2>
          </div>
          <ShieldCheck size={20} />
        </header>
      </section>
    );
  }

  return (
    <section className="governance-control" id="governance" aria-labelledby="governance-heading">
      <header>
        <div>
          <span>GOVERNANCE CONTROL</span>
          <h2 id="governance-heading">Approval، runtime policy و economics</h2>
          <p>
            همهٔ تصمیم‌ها و bindingها از Core ثبت می‌شوند؛ Console secret یا privilege حمل نمی‌کند.
          </p>
        </div>
        <button type="button" onClick={() => void load()} aria-label="تازه‌سازی governance">
          <RefreshCw size={16} />
        </button>
      </header>

      {error && (
        <div className="governance-message error">
          <CircleAlert size={15} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="بستن خطا">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <div className="governance-message notice">
          <Check size={15} />
          <span>{notice}</span>
        </div>
      )}

      <div className="governance-grid">
        <section
          className="governance-lane approvals-lane"
          aria-labelledby="approval-inbox-heading"
        >
          <div className="lane-heading">
            <div>
              <span>HUMAN GATE</span>
              <h3 id="approval-inbox-heading">Approval Inbox</h3>
            </div>
            <b>{approvals.length}</b>
          </div>
          {loading ? (
            <div className="governance-empty">در حال بارگذاری تصمیم‌های pending…</div>
          ) : approvals.length === 0 ? (
            <div className="governance-empty">درخواست pending وجود ندارد.</div>
          ) : (
            <div className="approval-list">
              {approvals.map((approval) => (
                <article key={approval.id}>
                  <div className="approval-meta">
                    <strong>{approval.targetKey}</strong>
                    <span>{approval.riskClass}</span>
                    <time>{new Date(approval.expiresAt).toLocaleString('fa-IR')}</time>
                  </div>
                  <pre>{JSON.stringify(approval.requestPayload, null, 2)}</pre>
                  <label>
                    دلیل تصمیم
                    <input
                      value={decisionReasons[approval.id] ?? ''}
                      onChange={(event) =>
                        setDecisionReasons((current) => ({
                          ...current,
                          [approval.id]: event.target.value,
                        }))
                      }
                      maxLength={2_000}
                    />
                  </label>
                  <div className="approval-actions">
                    <button
                      type="button"
                      onClick={() => decide(approval, 'approved')}
                      disabled={pending}
                    >
                      <Check size={14} /> تأیید
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(approval, 'rejected')}
                      disabled={pending}
                    >
                      <Ban size={14} /> رد
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {canAdmin && (
          <section className="governance-lane action-lane" aria-labelledby="action-policy-heading">
            <div className="lane-heading">
              <div>
                <span>DEFAULT DENY</span>
                <h3 id="action-policy-heading">Action targets و policy</h3>
              </div>
              <ShieldCheck size={18} />
            </div>
            <form
              className="governance-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await requestControlPlaneJson(apiBase, '/api/v1/action-targets', csrfToken, {
                    method: 'POST',
                    body: JSON.stringify({ key: targetKey, action: 'send_message', executorRef }),
                  });
                  setTargetKey('');
                  setExecutorRef('');
                }, 'target server-side ثبت شد.');
              }}
            >
              <label>
                target key
                <input
                  value={targetKey}
                  onChange={(event) => setTargetKey(event.target.value)}
                  required
                />
              </label>
              <label>
                executor reference
                <input
                  value={executorRef}
                  onChange={(event) => setExecutorRef(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={pending || !targetKey || !executorRef}>
                ثبت target
              </button>
            </form>
            <div className="compact-records">
              {targets.map((target) => (
                <div key={target.id}>
                  <span>
                    <strong>{target.key}</strong>
                    <small>{target.executorRef}</small>
                  </span>
                  <b>{target.status}</b>
                  {target.status === 'active' && (
                    <button
                      type="button"
                      onClick={() =>
                        void perform(async () => {
                          await requestControlPlaneJson(
                            apiBase,
                            `/api/v1/action-targets/${target.id}/disable`,
                            csrfToken,
                            { method: 'POST', body: '{}' },
                          );
                        }, 'target و policyهای فعال آن غیرفعال شدند.')
                      }
                    >
                      غیرفعال‌سازی
                    </button>
                  )}
                </div>
              ))}
            </div>

            <form
              className="governance-form policy-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await requestControlPlaneJson(apiBase, '/api/v1/action-policies', csrfToken, {
                    method: 'POST',
                    body: JSON.stringify({
                      flowId: policyFlowId,
                      flowVersionId: policyVersionId,
                      targetId: policyTargetId,
                      action: 'send_message',
                      riskClass,
                    }),
                  });
                }, 'policy نسخه‌دار و approval-required ثبت شد.');
              }}
            >
              <label>
                Flow
                <select
                  value={policyFlowId}
                  onChange={(event) => setPolicyFlowId(event.target.value)}
                  required
                >
                  <option value="">انتخاب Flow</option>
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                OpenClaw version
                <select
                  value={policyVersionId}
                  onChange={(event) => setPolicyVersionId(event.target.value)}
                  required
                >
                  <option value="">انتخاب version</option>
                  {openClawVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                target
                <select
                  value={policyTargetId}
                  onChange={(event) => setPolicyTargetId(event.target.value)}
                  required
                >
                  <option value="">انتخاب target</option>
                  {activeTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.key}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                risk
                <select value={riskClass} onChange={(event) => setRiskClass(event.target.value)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>
              <button type="submit" disabled={pending || !policyVersionId || !policyTargetId}>
                ثبت policy
              </button>
            </form>
            <div className="compact-records policy-records">
              {policies.map((policy) => (
                <div key={policy.id}>
                  <span>
                    <strong>
                      {policy.flowName} / v{policy.flowVersion}
                    </strong>
                    <small>
                      {policy.targetKey} · {policy.riskClass}
                    </small>
                  </span>
                  <b>{policy.status}</b>
                  {policy.status === 'active' && (
                    <button
                      type="button"
                      onClick={() =>
                        void perform(async () => {
                          await requestControlPlaneJson(
                            apiBase,
                            `/api/v1/action-policies/${policy.id}/retire`,
                            csrfToken,
                            { method: 'POST', body: '{}' },
                          );
                        }, 'policy بازنشسته شد.')
                      }
                    >
                      بازنشستگی
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {canAdmin && (
          <section
            className="governance-lane economics-lane"
            id="economics"
            aria-labelledby="economics-control-heading"
          >
            <div className="lane-heading">
              <div>
                <span>VERSIONED ASSUMPTIONS</span>
                <h3 id="economics-control-heading">Runtime metering و economics</h3>
              </div>
              <Coins size={18} />
            </div>
            <div className="economics-summary">
              <div>
                <span>P&amp;L کاسیو پلاس</span>
                <strong>{formatCurrency(pnl[0]?.gross_margin, pnl[0]?.currency)}</strong>
                <small>gross margin</small>
              </div>
              <div>
                <span>اکوسیستم</span>
                <strong>{formatCurrency(tco[0]?.ecosystem_tco, tco[0]?.currency)}</strong>
                <small>total cost</small>
              </div>
            </div>
            <form
              className="governance-form pricing-form"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await requestControlPlaneJson(apiBase, '/api/v1/pricing-assumptions', csrfToken, {
                    method: 'POST',
                    body: JSON.stringify({
                      key: pricingKey,
                      version: Number(pricingVersion),
                      status: pricingStatus,
                      assumptions: safeJson(assumptionsText),
                      effectiveFrom: isoFromLocal(effectiveFrom),
                    }),
                  });
                }, 'planning assumption نسخه‌دار ثبت شد.');
              }}
            >
              <label>
                key
                <input
                  value={pricingKey}
                  onChange={(event) => setPricingKey(event.target.value)}
                  required
                />
              </label>
              <label>
                version
                <input
                  type="number"
                  min="1"
                  value={pricingVersion}
                  onChange={(event) => setPricingVersion(event.target.value)}
                  required
                />
              </label>
              <label>
                status
                <select
                  value={pricingStatus}
                  onChange={(event) => setPricingStatus(event.target.value)}
                >
                  <option value="planning">planning</option>
                  <option value="active">active</option>
                </select>
              </label>
              <label>
                effective from
                <input
                  type="datetime-local"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  required
                />
              </label>
              <label className="wide-field">
                assumptions.json
                <textarea
                  dir="ltr"
                  value={assumptionsText}
                  onChange={(event) => setAssumptionsText(event.target.value)}
                  rows={4}
                />
              </label>
              <button type="submit" disabled={pending || !pricingKey}>
                ثبت نسخهٔ assumption
              </button>
            </form>
            <div className="compact-records pricing-records">
              {pricingVersions.map((version) => (
                <div key={version.id}>
                  <span>
                    <strong>
                      {version.key} / v{version.version}
                    </strong>
                    <small>{new Date(version.effectiveFrom).toLocaleString('fa-IR')}</small>
                  </span>
                  <b>{version.status}</b>
                </div>
              ))}
            </div>

            <form
              className="governance-form meter-form"
              onSubmit={(event) => {
                event.preventDefault();
                const operation =
                  meterRuntime === 'open-webui' ? 'model.chat.complete' : 'action.send_message';
                void perform(async () => {
                  await requestControlPlaneJson(
                    apiBase,
                    '/api/v1/runtime-meter-bindings',
                    csrfToken,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        runtime: meterRuntime,
                        operation,
                        resourceKey: meterResourceKey,
                        pricingVersionId: meterPricingId,
                        currency,
                        payer,
                        directUnitCost,
                        inputTokenUnitCost,
                        outputTokenUnitCost,
                        allocatedSharedCost,
                        billableMultiplier,
                      }),
                    },
                  );
                }, 'runtime meter binding فعال شد و binding قبلی همان resource بازنشسته شد.');
              }}
            >
              <label>
                runtime
                <select
                  value={meterRuntime}
                  onChange={(event) =>
                    setMeterRuntime(event.target.value as 'open-webui' | 'openclaw')
                  }
                >
                  <option value="open-webui">Open WebUI</option>
                  <option value="openclaw">OpenClaw</option>
                </select>
              </label>
              <label>
                resource key
                <input
                  value={meterResourceKey}
                  onChange={(event) => setMeterResourceKey(event.target.value)}
                  required
                />
              </label>
              <label>
                pricing version
                <select
                  value={meterPricingId}
                  onChange={(event) => setMeterPricingId(event.target.value)}
                  required
                >
                  <option value="">انتخاب نسخهٔ active</option>
                  {activePricing.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.key} / v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                currency
                <input
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                  required
                />
              </label>
              <label>
                payer
                <select value={payer} onChange={(event) => setPayer(event.target.value)}>
                  <option value="casioplus">casioplus</option>
                  <option value="customer">customer</option>
                  <option value="external_product">external product</option>
                  <option value="shared">shared</option>
                </select>
              </label>
              <label>
                direct unit
                <input
                  value={directUnitCost}
                  onChange={(event) => setDirectUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                input token
                <input
                  value={inputTokenUnitCost}
                  onChange={(event) => setInputTokenUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                output token
                <input
                  value={outputTokenUnitCost}
                  onChange={(event) => setOutputTokenUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                shared cost
                <input
                  value={allocatedSharedCost}
                  onChange={(event) => setAllocatedSharedCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                billable multiplier
                <input
                  value={billableMultiplier}
                  onChange={(event) => setBillableMultiplier(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <button type="submit" disabled={pending || !meterResourceKey || !meterPricingId}>
                فعال‌سازی binding
              </button>
            </form>
            <div className="compact-records meter-records">
              {bindings.map((binding) => (
                <div key={binding.id}>
                  <span>
                    <strong>
                      {binding.runtime} / {binding.resourceKey}
                    </strong>
                    <small>
                      {binding.pricingKey} v{binding.pricingVersion} · {binding.payer}
                    </small>
                  </span>
                  <b>{binding.status}</b>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer className="governance-foot">
        <SlidersHorizontal size={15} />
        <span>
          این صفحه planning assumptions را مدیریت می‌کند؛ قیمت‌ها در source hard-code نشده‌اند.
        </span>
      </footer>
    </section>
  );
}
