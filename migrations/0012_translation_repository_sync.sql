ALTER TABLE action_targets DROP CONSTRAINT IF EXISTS action_targets_action_check;
ALTER TABLE action_targets
  ADD CONSTRAINT action_targets_action_check
  CHECK (action IN ('send_message', 'repository.open_translation_pr'));

ALTER TABLE action_policies DROP CONSTRAINT IF EXISTS action_policies_action_check;
ALTER TABLE action_policies
  ADD CONSTRAINT action_policies_action_check
  CHECK (action IN ('send_message', 'repository.open_translation_pr'));

ALTER TABLE action_approval_requests DROP CONSTRAINT IF EXISTS action_approval_requests_action_check;
ALTER TABLE action_approval_requests
  ADD CONSTRAINT action_approval_requests_action_check
  CHECK (action IN ('send_message', 'repository.open_translation_pr'));

ALTER TABLE action_executions DROP CONSTRAINT IF EXISTS action_executions_action_check;
ALTER TABLE action_executions
  ADD CONSTRAINT action_executions_action_check
  CHECK (action IN ('send_message', 'repository.open_translation_pr'));

ALTER TABLE action_approval_requests
  DROP CONSTRAINT IF EXISTS action_approval_requests_process_run_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS action_approval_requests_run_action_payload_idx
  ON action_approval_requests (process_run_id, action, request_payload_hash);

ALTER TABLE action_executions
  DROP CONSTRAINT IF EXISTS action_executions_process_run_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS action_executions_approval_idx
  ON action_executions (approval_id);

ALTER TABLE translation_change_sets
  ADD COLUMN approval_id UUID REFERENCES action_approval_requests(id) ON DELETE RESTRICT,
  ADD COLUMN outbox_id UUID REFERENCES integration_outbox(id) ON DELETE RESTRICT,
  ADD COLUMN repository_branch_ref TEXT
    CHECK (repository_branch_ref IS NULL OR repository_branch_ref ~ '^casioplus/translation/[a-f0-9-]{36}$'),
  ADD COLUMN pull_request_number INTEGER CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  ADD COLUMN pull_request_url TEXT
    CHECK (pull_request_url IS NULL OR pull_request_url ~ '^https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+$'),
  ADD COLUMN pull_request_head_sha TEXT
    CHECK (pull_request_head_sha IS NULL OR pull_request_head_sha ~ '^[a-f0-9]{40}$'),
  ADD COLUMN sync_requested_at TIMESTAMPTZ,
  ADD COLUMN pull_request_opened_at TIMESTAMPTZ,
  ADD COLUMN merged_at TIMESTAMPTZ,
  ADD COLUMN failure_code TEXT
    CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  ADD COLUMN last_webhook_delivery_id TEXT
    CHECK (last_webhook_delivery_id IS NULL OR length(last_webhook_delivery_id) BETWEEN 16 AND 200);

CREATE UNIQUE INDEX IF NOT EXISTS translation_change_sets_approval_idx
  ON translation_change_sets (approval_id) WHERE approval_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS translation_change_sets_outbox_idx
  ON translation_change_sets (outbox_id) WHERE outbox_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS translation_change_sets_pull_request_idx
  ON translation_change_sets (repository_full_name, pull_request_number)
  WHERE pull_request_number IS NOT NULL;

ALTER TABLE translation_change_sets
  ADD CONSTRAINT translation_change_sets_repository_sync_state_check
  CHECK (
    (status IN ('draft', 'ready_for_review', 'ready_for_approval', 'rejected', 'expired')
      AND outbox_id IS NULL
      AND pull_request_number IS NULL
      AND pull_request_url IS NULL
      AND pull_request_head_sha IS NULL
      AND pull_request_opened_at IS NULL
      AND merged_at IS NULL)
    OR
    (status = 'pending_approval'
      AND approval_id IS NOT NULL
      AND outbox_id IS NULL
      AND pull_request_number IS NULL)
    OR
    (status = 'approved'
      AND approval_id IS NOT NULL
      AND outbox_id IS NULL
      AND pull_request_number IS NULL)
    OR
    (status = 'sync_queued'
      AND approval_id IS NOT NULL
      AND outbox_id IS NOT NULL
      AND sync_requested_at IS NOT NULL
      AND pull_request_number IS NULL)
    OR
    (status = 'failed'
      AND approval_id IS NOT NULL
      AND outbox_id IS NOT NULL
      AND sync_requested_at IS NOT NULL
      AND merged_at IS NULL
      AND (
        (pull_request_number IS NULL
          AND pull_request_url IS NULL
          AND pull_request_head_sha IS NULL
          AND pull_request_opened_at IS NULL)
        OR
        (repository_branch_ref IS NOT NULL
          AND pull_request_number IS NOT NULL
          AND pull_request_url IS NOT NULL
          AND pull_request_head_sha IS NOT NULL
          AND pull_request_opened_at IS NOT NULL)
      ))
    OR
    (status = 'pr_opened'
      AND approval_id IS NOT NULL
      AND outbox_id IS NOT NULL
      AND repository_branch_ref IS NOT NULL
      AND pull_request_number IS NOT NULL
      AND pull_request_url IS NOT NULL
      AND pull_request_head_sha IS NOT NULL
      AND pull_request_opened_at IS NOT NULL
      AND merged_at IS NULL)
    OR
    (status = 'merged'
      AND approval_id IS NOT NULL
      AND outbox_id IS NOT NULL
      AND repository_branch_ref IS NOT NULL
      AND pull_request_number IS NOT NULL
      AND pull_request_url IS NOT NULL
      AND pull_request_head_sha IS NOT NULL
      AND pull_request_opened_at IS NOT NULL
      AND merged_at IS NOT NULL)
  );
