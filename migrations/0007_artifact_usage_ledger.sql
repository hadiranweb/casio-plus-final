ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS namespace_id UUID;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS storage_policy_id UUID;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS source_version TEXT;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS deletion_propagated_at TIMESTAMPTZ;
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS integrity_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (integrity_status IN ('pending', 'verified', 'mismatch', 'deleted'));

UPDATE artifacts a
   SET namespace_id = mn.id,
       storage_policy_id = mn.storage_policy_id,
       retention_until = COALESCE(a.retention_until, a.created_at + (sp.retention_days::text || ' days')::interval)
  FROM memory_namespaces mn
  JOIN storage_policies sp ON sp.id = mn.storage_policy_id
 WHERE mn.organization_id = a.organization_id AND mn.key = 'organization-memory'
   AND (a.namespace_id IS NULL OR a.storage_policy_id IS NULL OR a.retention_until IS NULL);

ALTER TABLE artifacts ALTER COLUMN namespace_id SET NOT NULL;
ALTER TABLE artifacts ALTER COLUMN storage_policy_id SET NOT NULL;
ALTER TABLE artifacts ALTER COLUMN retention_until SET NOT NULL;
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_namespace_fk
  FOREIGN KEY (organization_id, namespace_id)
  REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_storage_policy_fk
  FOREIGN KEY (storage_policy_id)
  REFERENCES storage_policies(id) ON DELETE RESTRICT;
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_source_hash_check
  CHECK (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_size_bytes_check
  CHECK (size_bytes IS NULL OR size_bytes >= 0);

CREATE TABLE IF NOT EXISTS artifact_upload_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID NOT NULL UNIQUE REFERENCES artifacts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  object_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  upload_method TEXT NOT NULL DEFAULT 'presigned_put' CHECK (upload_method = 'presigned_put'),
  expected_content_type TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes BETWEEN 1 AND 1073741824),
  expected_checksum TEXT NOT NULL CHECK (length(trim(expected_checksum)) BETWEEN 16 AND 200),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pricing_assumption_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'retired')),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, key, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  external_app_id UUID REFERENCES external_apps(id) ON DELETE RESTRICT,
  external_tenant_id UUID REFERENCES external_tenants(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE RESTRICT,
  namespace_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  runtime TEXT NOT NULL CHECK (runtime IN ('native', 'n8n', 'open-webui', 'openclaw')),
  model TEXT,
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens = input_tokens + output_tokens),
  input_bytes BIGINT NOT NULL DEFAULT 0 CHECK (input_bytes >= 0),
  output_bytes BIGINT NOT NULL DEFAULT 0 CHECK (output_bytes >= 0),
  total_bytes BIGINT NOT NULL DEFAULT 0 CHECK (total_bytes = input_bytes + output_bytes),
  latency_ms BIGINT NOT NULL CHECK (latency_ms >= 0),
  unit_cost NUMERIC(20, 8) NOT NULL CHECK (unit_cost >= 0),
  allocated_shared_cost NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (allocated_shared_cost >= 0),
  billable_amount NUMERIC(20, 8) NOT NULL CHECK (billable_amount >= 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  payer TEXT NOT NULL CHECK (payer IN ('casioplus', 'customer', 'external_product', 'shared')),
  pricing_version_id UUID NOT NULL REFERENCES pricing_assumption_versions(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, namespace_id)
    REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION casioplus_private.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable ledger rows cannot be updated or deleted';
END
$$;

DROP TRIGGER IF EXISTS usage_events_immutable ON usage_events;
CREATE TRIGGER usage_events_immutable
BEFORE UPDATE OR DELETE ON usage_events
FOR EACH ROW EXECUTE FUNCTION casioplus_private.reject_immutable_change();

DROP TRIGGER IF EXISTS pricing_assumption_versions_immutable ON pricing_assumption_versions;
CREATE TRIGGER pricing_assumption_versions_immutable
BEFORE UPDATE OR DELETE ON pricing_assumption_versions
FOR EACH ROW EXECUTE FUNCTION casioplus_private.reject_immutable_change();

CREATE UNIQUE INDEX IF NOT EXISTS artifact_upload_intents_idempotency_idx
  ON artifact_upload_intents (organization_id, idempotency_key);

CREATE OR REPLACE VIEW casioplus_pnl_usage_view AS
SELECT organization_id, workspace_id, currency,
       sum(billable_amount) AS revenue,
       sum(CASE WHEN payer = 'casioplus' THEN unit_cost + allocated_shared_cost ELSE 0 END) AS casioplus_cost,
       sum(billable_amount) -
         sum(CASE WHEN payer = 'casioplus' THEN unit_cost + allocated_shared_cost ELSE 0 END) AS gross_margin
  FROM usage_events
 GROUP BY organization_id, workspace_id, currency;

CREATE OR REPLACE VIEW ecosystem_tco_usage_view AS
SELECT organization_id, workspace_id, currency,
       sum(unit_cost + allocated_shared_cost) AS ecosystem_tco,
       sum(billable_amount) AS billable_amount
  FROM usage_events
 GROUP BY organization_id, workspace_id, currency;

CREATE INDEX IF NOT EXISTS artifacts_retention_idx
  ON artifacts (retention_until, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS artifact_upload_intents_expiry_idx
  ON artifact_upload_intents (expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS usage_events_scope_recorded_idx
  ON usage_events (organization_id, workspace_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_run_idx ON usage_events (process_run_id, recorded_at);
CREATE INDEX IF NOT EXISTS usage_events_pricing_idx ON usage_events (pricing_version_id, recorded_at);

ALTER TABLE artifact_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON artifact_upload_intents
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON usage_events
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
