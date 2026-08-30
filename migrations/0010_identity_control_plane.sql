UPDATE organization_invitations
   SET status = 'expired'
 WHERE status = 'pending' AND expires_at <= now();

CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_unique
  ON organization_invitations (organization_id, workspace_id, normalized_email)
  WHERE status = 'pending';

ALTER TABLE external_apps
  ADD COLUMN IF NOT EXISTS managing_organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS external_apps_managing_organization_idx
  ON external_apps (managing_organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS integration_keys_external_app_status_idx
  ON integration_keys (external_app_id, status, valid_from DESC);

CREATE INDEX IF NOT EXISTS external_workspace_mappings_scope_status_idx
  ON external_workspace_mappings (organization_id, workspace_id, status, created_at DESC);
