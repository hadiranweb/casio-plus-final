CREATE TABLE IF NOT EXISTS translation_change_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE RESTRICT,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE RESTRICT,
  flow_version_id UUID NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  repository_full_name TEXT NOT NULL
    CHECK (repository_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  base_ref TEXT NOT NULL CHECK (base_ref ~ '^[A-Za-z0-9._/-]{1,200}$'),
  base_commit_sha TEXT NOT NULL CHECK (base_commit_sha ~ '^[a-f0-9]{40}$'),
  catalog_hash TEXT NOT NULL CHECK (catalog_hash ~ '^[a-f0-9]{64}$'),
  source_locale TEXT NOT NULL CHECK (source_locale IN ('en', 'fa')),
  target_locale TEXT NOT NULL CHECK (target_locale IN ('en', 'fa')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'ready_for_review', 'ready_for_approval', 'pending_approval',
      'approved', 'rejected', 'sync_queued', 'pr_opened', 'merged', 'failed', 'expired'
    )),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by_actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ,
  review_completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, id),
  UNIQUE (organization_id, workspace_id, idempotency_key),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  CHECK (source_locale <> target_locale),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'draft' AND submitted_at IS NULL) OR
    (status <> 'draft' AND submitted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS translation_change_set_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  change_set_id UUID NOT NULL,
  message_key TEXT NOT NULL CHECK (message_key ~ '^[a-z][a-z0-9_]{2,199}$'),
  source_locale TEXT NOT NULL CHECK (source_locale IN ('en', 'fa')),
  target_locale TEXT NOT NULL CHECK (target_locale IN ('en', 'fa')),
  source_text TEXT NOT NULL CHECK (length(source_text) BETWEEN 1 AND 20000),
  current_target_text TEXT CHECK (current_target_text IS NULL OR length(current_target_text) <= 20000),
  proposed_text TEXT NOT NULL CHECK (length(proposed_text) BETWEEN 1 AND 20000),
  reviewed_text TEXT CHECK (reviewed_text IS NULL OR length(reviewed_text) BETWEEN 1 AND 20000),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  current_target_hash TEXT CHECK (current_target_hash IS NULL OR current_target_hash ~ '^[a-f0-9]{64}$'),
  proposal_hash TEXT NOT NULL CHECK (proposal_hash ~ '^[a-f0-9]{64}$'),
  placeholder_signature JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'edited', 'rejected')),
  reviewed_by_actor_id UUID REFERENCES actors(id) ON DELETE RESTRICT,
  review_reason TEXT CHECK (review_reason IS NULL OR length(review_reason) <= 2000),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (change_set_id, message_key, target_locale),
  UNIQUE (organization_id, workspace_id, id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, workspace_id, change_set_id)
    REFERENCES translation_change_sets(organization_id, workspace_id, id) ON DELETE CASCADE,
  CHECK (source_locale <> target_locale),
  CHECK (
    (status = 'proposed' AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL AND reviewed_text IS NULL) OR
    (status IN ('accepted', 'rejected') AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_text IS NULL) OR
    (status = 'edited' AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_text IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS translation_change_sets_review_idx
  ON translation_change_sets (organization_id, workspace_id, status, created_at DESC)
  WHERE status IN ('ready_for_review', 'ready_for_approval', 'pending_approval');
CREATE INDEX IF NOT EXISTS translation_change_set_items_scope_idx
  ON translation_change_set_items (organization_id, workspace_id, change_set_id, status);

ALTER TABLE translation_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_change_set_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON translation_change_sets
  USING (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  )
  WITH CHECK (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  );
CREATE POLICY tenant_isolation_policy ON translation_change_set_items
  USING (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  )
  WITH CHECK (
    organization_id = casioplus_private.current_organization_id()
    AND workspace_id = casioplus_private.current_workspace_id()
  );
