import { formatDateTime, formatMoney } from '@casioplus/i18n/formatters';
import { m } from '@casioplus/i18n/messages';
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
  if (!value || !currency) return m.console_governance_empty_dash();
  return formatMoney(Number(value), currency, { maximumFractionDigits: 8 });
}

function safeJson(value: string) {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(m.console_governance_assumptions_must_be_object());
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
      setError(
        requestError instanceof Error ? requestError.message : m.console_governance_load_failed(),
      );
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
          requestError instanceof Error
            ? requestError.message
            : m.console_governance_flow_versions_load_failed(),
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
        requestError instanceof Error
          ? requestError.message
          : m.console_governance_operation_failed(),
      );
    } finally {
      setPending(false);
    }
  };

  const decide = (approval: Approval, decision: 'approved' | 'rejected') => {
    const reason = decisionReasons[approval.id]?.trim();
    if (!reason) {
      setError(m.console_governance_provide_reason_for_decision());
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
        ? m.console_governance_action_approved()
        : m.console_governance_action_rejected(),
    );
  };

  if (!canReview) {
    return (
      <section className="governance-control" id="governance">
        <header>
          <div>
            <span>{m.console_governance_control_title()}</span>
            <h2>{m.console_governance_no_access_heading()}</h2>
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
          <span>{m.console_governance_control_title()}</span>
          <h2 id="governance-heading">{m.console_governance_heading()}</h2>
          <p>{m.console_governance_description()}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label={m.console_governance_refresh_aria()}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {error && (
        <div className="governance-message error">
          <CircleAlert size={15} />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            aria-label={m.console_governance_close_error_aria()}
          >
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
              <span>{m.console_governance_human_gate()}</span>
              <h3 id="approval-inbox-heading">{m.console_governance_approval_inbox()}</h3>
            </div>
            <b>{approvals.length}</b>
          </div>
          {loading ? (
            <div className="governance-empty">{m.console_governance_loading_pending()}</div>
          ) : approvals.length === 0 ? (
            <div className="governance-empty">{m.console_governance_no_pending()}</div>
          ) : (
            <div className="approval-list">
              {approvals.map((approval) => (
                <article key={approval.id}>
                  <div className="approval-meta">
                    <strong>{approval.targetKey}</strong>
                    <span>{approval.riskClass}</span>
                    <time>{formatDateTime(approval.expiresAt)}</time>
                  </div>
                  <pre>{JSON.stringify(approval.requestPayload, null, 2)}</pre>
                  <label>
                    {m.console_governance_decision_reason_label()}
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
                      <Check size={14} /> {m.console_governance_approve_button()}
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(approval, 'rejected')}
                      disabled={pending}
                    >
                      <Ban size={14} /> {m.console_governance_reject_button()}
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
                <span>{m.console_governance_default_deny()}</span>
                <h3 id="action-policy-heading">{m.console_governance_action_policy_heading()}</h3>
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
                }, m.console_governance_target_registered());
              }}
            >
              <label>
                {m.console_governance_target_key_label()}
                <input
                  value={targetKey}
                  onChange={(event) => setTargetKey(event.target.value)}
                  required
                />
              </label>
              <label>
                {m.console_governance_executor_ref_label()}
                <input
                  value={executorRef}
                  onChange={(event) => setExecutorRef(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={pending || !targetKey || !executorRef}>
                {m.console_governance_register_target_button()}
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
                        }, m.console_governance_target_disabled())
                      }
                    >
                      {m.console_governance_disable_button()}
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
                }, m.console_governance_policy_registered());
              }}
            >
              <label>
                {m.console_governance_flow_label()}
                <select
                  value={policyFlowId}
                  onChange={(event) => setPolicyFlowId(event.target.value)}
                  required
                >
                  <option value="">{m.console_governance_select_flow()}</option>
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.console_governance_openclaw_version_label()}
                <select
                  value={policyVersionId}
                  onChange={(event) => setPolicyVersionId(event.target.value)}
                  required
                >
                  <option value="">{m.console_governance_select_version()}</option>
                  {openClawVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.console_governance_target_label()}
                <select
                  value={policyTargetId}
                  onChange={(event) => setPolicyTargetId(event.target.value)}
                  required
                >
                  <option value="">{m.console_governance_select_target()}</option>
                  {activeTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.key}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.console_governance_risk_label()}
                <select value={riskClass} onChange={(event) => setRiskClass(event.target.value)}>
                  <option value="low">{m.shared_risk_low()}</option>
                  <option value="medium">{m.shared_risk_medium()}</option>
                  <option value="high">{m.shared_risk_high()}</option>
                </select>
              </label>
              <button type="submit" disabled={pending || !policyVersionId || !policyTargetId}>
                {m.console_governance_register_policy_button()}
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
                        }, m.console_governance_policy_retired())
                      }
                    >
                      {m.console_governance_retire_button()}
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
                <span>{m.console_governance_versioned_assumptions()}</span>
                <h3 id="economics-control-heading">{m.console_governance_economics_heading()}</h3>
              </div>
              <Coins size={18} />
            </div>
            <div className="economics-summary">
              <div>
                <span>{m.console_governance_pnl_title()}</span>
                <strong>{formatCurrency(pnl[0]?.gross_margin, pnl[0]?.currency)}</strong>
                <small>{m.console_governance_gross_margin()}</small>
              </div>
              <div>
                <span>{m.console_governance_ecosystem()}</span>
                <strong>{formatCurrency(tco[0]?.ecosystem_tco, tco[0]?.currency)}</strong>
                <small>{m.console_governance_total_cost()}</small>
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
                }, m.console_governance_assumption_registered());
              }}
            >
              <label>
                {m.console_governance_key_label()}
                <input
                  value={pricingKey}
                  onChange={(event) => setPricingKey(event.target.value)}
                  required
                />
              </label>
              <label>
                {m.console_governance_version_label()}
                <input
                  type="number"
                  min="1"
                  value={pricingVersion}
                  onChange={(event) => setPricingVersion(event.target.value)}
                  required
                />
              </label>
              <label>
                {m.console_governance_status_label()}
                <select
                  value={pricingStatus}
                  onChange={(event) => setPricingStatus(event.target.value)}
                >
                  <option value="planning">{m.shared_status_planning()}</option>
                  <option value="active">{m.shared_status_active()}</option>
                </select>
              </label>
              <label>
                {m.console_governance_effective_from_label()}
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
                {m.console_governance_register_assumption_button()}
              </button>
            </form>
            <div className="compact-records pricing-records">
              {pricingVersions.map((version) => (
                <div key={version.id}>
                  <span>
                    <strong>
                      {version.key} / v{version.version}
                    </strong>
                    <small>{formatDateTime(version.effectiveFrom)}</small>
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
                }, m.console_governance_binding_activated());
              }}
            >
              <label>
                {m.console_governance_runtime_label()}
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
                {m.console_governance_resource_key_label()}
                <input
                  value={meterResourceKey}
                  onChange={(event) => setMeterResourceKey(event.target.value)}
                  required
                />
              </label>
              <label>
                {m.console_governance_pricing_version_label()}
                <select
                  value={meterPricingId}
                  onChange={(event) => setMeterPricingId(event.target.value)}
                  required
                >
                  <option value="">{m.console_governance_select_active_version()}</option>
                  {activePricing.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.key} / v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {m.console_governance_currency_label()}
                <input
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                  required
                />
              </label>
              <label>
                {m.console_governance_payer_label()}
                <select value={payer} onChange={(event) => setPayer(event.target.value)}>
                  <option value="casioplus">{m.shared_payer_casioplus()}</option>
                  <option value="customer">{m.shared_payer_customer()}</option>
                  <option value="external_product">{m.shared_payer_external_product()}</option>
                  <option value="shared">{m.shared_payer_shared()}</option>
                </select>
              </label>
              <label>
                {m.console_governance_direct_unit_label()}
                <input
                  value={directUnitCost}
                  onChange={(event) => setDirectUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                {m.console_governance_input_token_label()}
                <input
                  value={inputTokenUnitCost}
                  onChange={(event) => setInputTokenUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                {m.console_governance_output_token_label()}
                <input
                  value={outputTokenUnitCost}
                  onChange={(event) => setOutputTokenUnitCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                {m.console_governance_shared_cost_label()}
                <input
                  value={allocatedSharedCost}
                  onChange={(event) => setAllocatedSharedCost(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label>
                {m.console_governance_billable_multiplier_label()}
                <input
                  value={billableMultiplier}
                  onChange={(event) => setBillableMultiplier(event.target.value)}
                  inputMode="decimal"
                />
              </label>
              <button type="submit" disabled={pending || !meterResourceKey || !meterPricingId}>
                {m.console_governance_activate_binding_button()}
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
        <span>{m.console_governance_footer_text()}</span>
      </footer>
    </section>
  );
}
