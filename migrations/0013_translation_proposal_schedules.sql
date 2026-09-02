CREATE TABLE translation_proposal_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  schedule_key TEXT NOT NULL CHECK (schedule_key ~ '^[a-z0-9][a-z0-9._-]{2,79}$'),
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('paused', 'active', 'expired')),
  repository_full_name TEXT NOT NULL DEFAULT 'hadiranweb/casio-plus-final'
    CHECK (repository_full_name = 'hadiranweb/casio-plus-final'),
  base_ref TEXT NOT NULL DEFAULT 'main' CHECK (base_ref = 'main'),
  source_locale TEXT NOT NULL DEFAULT 'en' CHECK (source_locale = 'en'),
  target_locale TEXT NOT NULL DEFAULT 'fa' CHECK (target_locale = 'fa'),
  cadence_seconds INTEGER NOT NULL CHECK (cadence_seconds BETWEEN 21600 AND 2678400),
  max_items INTEGER NOT NULL DEFAULT 50 CHECK (max_items BETWEEN 1 AND 100),
  message_key_prefixes JSONB NOT NULL DEFAULT '[""]'::jsonb
    CHECK (
      jsonb_typeof(message_key_prefixes) = 'array'
      AND jsonb_array_length(message_key_prefixes) BETWEEN 1 AND 20
    ),
  next_run_at TIMESTAMPTZ NOT NULL,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, schedule_key),
  CHECK (last_finished_at IS NULL OR last_started_at IS NOT NULL),
  CHECK (last_finished_at IS NULL OR last_finished_at >= last_started_at)
);

CREATE INDEX translation_proposal_schedules_due_idx
  ON translation_proposal_schedules (status, next_run_at)
  WHERE status = 'active';
CREATE INDEX translation_proposal_schedules_scope_idx
  ON translation_proposal_schedules (organization_id, workspace_id, created_at DESC);

CREATE TABLE translation_proposal_schedule_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES translation_proposal_schedules(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  process_run_id UUID REFERENCES flow_runs(id) ON DELETE RESTRICT,
  change_set_id UUID REFERENCES translation_change_sets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  base_commit_sha TEXT NOT NULL CHECK (base_commit_sha ~ '^[a-f0-9]{40}$'),
  catalog_hash TEXT NOT NULL CHECK (catalog_hash ~ '^[a-f0-9]{64}$'),
  snapshot_items JSONB NOT NULL CHECK (jsonb_typeof(snapshot_items) = 'array'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (process_run_id),
  UNIQUE (change_set_id),
  CHECK (
    (status = 'running' AND process_run_id IS NOT NULL AND completed_at IS NULL AND error_code IS NULL) OR
    (status = 'succeeded' AND process_run_id IS NOT NULL AND change_set_id IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL) OR
    (status = 'failed' AND process_run_id IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL) OR
    (status = 'skipped' AND process_run_id IS NULL AND change_set_id IS NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
);

CREATE INDEX translation_proposal_schedule_runs_scope_idx
  ON translation_proposal_schedule_runs (organization_id, workspace_id, created_at DESC);
CREATE INDEX translation_proposal_schedule_runs_schedule_idx
  ON translation_proposal_schedule_runs (schedule_id, created_at DESC);

ALTER TABLE translation_proposal_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_proposal_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON translation_proposal_schedules
  USING (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  )
  WITH CHECK (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  );

CREATE POLICY tenant_isolation_policy ON translation_proposal_schedule_runs
  USING (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  )
  WITH CHECK (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  );

COMMENT ON TABLE translation_proposal_schedules IS
  'Core-owned cadence configuration for proposal-only English-to-Persian translation Flow runs. Scheduling never reviews, approves, publishes, merges, or mutates a repository.';
COMMENT ON TABLE translation_proposal_schedule_runs IS
  'Immutable-correlation records connecting each due schedule tick to a metered ProcessRun and, only after valid model output, a draft Translation Change Set.';
