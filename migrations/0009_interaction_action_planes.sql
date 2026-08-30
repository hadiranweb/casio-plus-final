CREATE TABLE IF NOT EXISTS action_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  action TEXT NOT NULL CHECK (action IN ('send_message')),
  executor_ref TEXT NOT NULL CHECK (executor_ref ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, key),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES action_targets(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('send_message')),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high')),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE CHECK (approval_required),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, flow_version_id, target_id, action),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, workspace_id, target_id)
    REFERENCES action_targets(organization_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS action_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  policy_id UUID NOT NULL REFERENCES action_policies(id) ON DELETE RESTRICT,
  target_id UUID NOT NULL REFERENCES action_targets(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('send_message')),
  risk_class TEXT NOT NULL CHECK (risk_class IN ('low', 'medium', 'high')),
  request_payload JSONB NOT NULL,
  request_payload_hash TEXT NOT NULL CHECK (request_payload_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')),
  requested_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  decided_by_actor_id UUID REFERENCES actors(id) ON DELETE RESTRICT,
  decision_reason TEXT CHECK (decision_reason IS NULL OR length(decision_reason) <= 2000),
  expires_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_run_id),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, workspace_id, target_id)
    REFERENCES action_targets(organization_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND decided_by_actor_id IS NULL AND decided_at IS NULL) OR
    (status <> 'pending' AND decided_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS action_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  approval_id UUID NOT NULL REFERENCES action_approval_requests(id) ON DELETE RESTRICT,
  outbox_id UUID NOT NULL REFERENCES integration_outbox(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('send_message')),
  executor_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'succeeded', 'failed', 'cancelled')),
  external_result_ref TEXT,
  response JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (process_run_id),
  UNIQUE (outbox_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS action_approvals_pending_idx
  ON action_approval_requests (organization_id, workspace_id, expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS action_executions_scope_idx
  ON action_executions (organization_id, workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS runtime_meter_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  runtime TEXT NOT NULL CHECK (runtime IN ('open-webui', 'openclaw')),
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  resource_key TEXT NOT NULL CHECK (length(resource_key) BETWEEN 1 AND 200),
  pricing_version_id UUID NOT NULL REFERENCES pricing_assumption_versions(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payer TEXT NOT NULL CHECK (payer IN ('casioplus', 'customer', 'external_product', 'shared')),
  direct_unit_cost NUMERIC(20, 12) NOT NULL DEFAULT 0 CHECK (direct_unit_cost >= 0),
  input_token_unit_cost NUMERIC(20, 12) NOT NULL DEFAULT 0 CHECK (input_token_unit_cost >= 0),
  output_token_unit_cost NUMERIC(20, 12) NOT NULL DEFAULT 0 CHECK (output_token_unit_cost >= 0),
  allocated_shared_cost NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (allocated_shared_cost >= 0),
  billable_multiplier NUMERIC(10, 6) NOT NULL DEFAULT 1 CHECK (billable_multiplier >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, runtime, operation, resource_key, valid_from),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

ALTER TABLE integration_outbox
  ADD COLUMN IF NOT EXISTS metering_snapshot JSONB;

CREATE INDEX IF NOT EXISTS runtime_meter_bindings_lookup_idx
  ON runtime_meter_bindings (organization_id, runtime, operation, resource_key, valid_from DESC)
  WHERE status = 'active';

ALTER TABLE action_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_meter_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON action_targets
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON action_policies
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON action_approval_requests
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON action_executions
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON runtime_meter_bindings
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
