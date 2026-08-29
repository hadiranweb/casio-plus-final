CREATE TABLE IF NOT EXISTS integration_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_app_id UUID NOT NULL REFERENCES external_apps(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL CHECK (key_id ~ '^[A-Za-z0-9._-]{3,100}$'),
  secret_ref TEXT NOT NULL CHECK (secret_ref ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retiring', 'revoked')),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_app_id, key_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE IF NOT EXISTS external_workspace_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_tenant_id UUID NOT NULL REFERENCES external_tenants(id) ON DELETE CASCADE,
  external_workspace_ref TEXT NOT NULL CHECK (length(trim(external_workspace_ref)) BETWEEN 1 AND 300),
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_tenant_id, external_workspace_ref),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_callback_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_tenant_id UUID NOT NULL REFERENCES external_tenants(id) ON DELETE CASCADE,
  callback_origin TEXT NOT NULL CHECK (callback_origin ~ '^https://'),
  path_prefix TEXT NOT NULL DEFAULT '/' CHECK (path_prefix LIKE '/%'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_tenant_id, callback_origin, path_prefix)
);

CREATE TABLE IF NOT EXISTS integration_nonces (
  external_app_id UUID NOT NULL REFERENCES external_apps(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL CHECK (length(nonce) BETWEEN 16 AND 200),
  request_timestamp TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (external_app_id, key_id, nonce),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS integration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_app_id UUID NOT NULL REFERENCES external_apps(id) ON DELETE RESTRICT,
  external_tenant_id UUID NOT NULL REFERENCES external_tenants(id) ON DELETE RESTRICT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  key_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'dispatched', 'completed', 'failed', 'rejected')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (external_app_id, external_tenant_id, idempotency_key),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS integration_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_request_id UUID NOT NULL REFERENCES integration_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('n8n', 'open-webui', 'openclaw', 'callback')),
  operation TEXT NOT NULL CHECK (operation ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'retry', 'dispatched', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (destination, idempotency_key),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS integration_nonces_expiry_idx ON integration_nonces (expires_at);
CREATE INDEX IF NOT EXISTS integration_requests_scope_received_idx
  ON integration_requests (organization_id, workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS integration_outbox_dispatch_idx
  ON integration_outbox (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');

ALTER TABLE external_workspace_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON external_workspace_mappings
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON integration_requests
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON integration_outbox
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
