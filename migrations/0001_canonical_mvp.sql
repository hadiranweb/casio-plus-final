CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,63}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent', 'runtime')),
  external_subject TEXT,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer', 'consumer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id)
);

CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'published', 'archived', 'retired')),
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  active_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS flow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_binding TEXT NOT NULL CHECK (runtime_binding IN ('native', 'n8n', 'openclaw', 'open-webui')),
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (flow_id, version),
  UNIQUE (flow_id, id)
);

ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_active_version_fk;
ALTER TABLE flows
  ADD CONSTRAINT flows_active_version_fk
  FOREIGN KEY (id, active_version_id)
  REFERENCES flow_versions(flow_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  intent TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error_code TEXT,
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  process_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS work_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  work_item_id UUID NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  summary TEXT NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 5000),
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'superseded')),
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_run_id)
);

CREATE TABLE IF NOT EXISTS work_commit_inputs (
  commit_id UUID NOT NULL REFERENCES work_commits(id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  value JSONB NOT NULL,
  PRIMARY KEY (commit_id, input_key)
);

CREATE TABLE IF NOT EXISTS work_commit_outputs (
  commit_id UUID NOT NULL REFERENCES work_commits(id) ON DELETE CASCADE,
  output_key TEXT NOT NULL,
  value JSONB NOT NULL,
  PRIMARY KEY (commit_id, output_key)
);

CREATE TABLE IF NOT EXISTS evidence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('process_run', 'artifact', 'human_input', 'external_reference')),
  source_id UUID NOT NULL,
  captured_by_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  commit_id UUID REFERENCES work_commits(id) ON DELETE CASCADE,
  reviewer_actor_id UUID NOT NULL REFERENCES actors(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'correct', 'supersede')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('verified_fact', 'operational_procedure', 'governed_decision', 'validated_pattern')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_commit_id UUID REFERENCES work_commits(id) ON DELETE RESTRICT,
  source_review_id UUID REFERENCES reviews(id) ON DELETE RESTRICT,
  lifecycle TEXT NOT NULL DEFAULT 'approved' CHECK (lifecycle IN ('candidate', 'pending_review', 'approved', 'rejected', 'superseded', 'deprecated')),
  sensitivity TEXT NOT NULL DEFAULT 'organization' CHECK (sensitivity IN ('public', 'organization', 'workspace', 'restricted')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_item_id UUID NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by_actor_id UUID NOT NULL REFERENCES actors(id),
  change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memory_item_id, revision)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id, relation_type, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  process_run_id UUID REFERENCES flow_runs(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('json', 'html', 'pdf', 'text', 'binary')),
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'failed', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, object_key)
);

CREATE TABLE IF NOT EXISTS provenance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  transformation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  subject_type TEXT,
  subject_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_items_workspace_created_idx ON work_items (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS flows_workspace_status_idx ON flows (workspace_id, status);
CREATE INDEX IF NOT EXISTS flow_runs_workspace_created_idx ON flow_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runtime_events_run_occurred_idx ON runtime_events (process_run_id, occurred_at);
CREATE INDEX IF NOT EXISTS commits_workspace_created_idx ON work_commits (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_items_scope_lifecycle_idx ON memory_items (organization_id, workspace_id, lifecycle, sensitivity);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON graph_edges (organization_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS audit_events_subject_idx ON audit_events (organization_id, subject_type, subject_id, created_at DESC);
