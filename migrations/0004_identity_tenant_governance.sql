CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(trim(email)))
);

CREATE TABLE IF NOT EXISTS identity_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  token_digest TEXT NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS actor_identities (
  actor_id UUID PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, actor_id)
);

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived'));

ALTER TABLE organizations
  ADD CONSTRAINT organizations_id_tenant_unique UNIQUE (id, id);

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE actors
  ADD CONSTRAINT actors_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE identity_sessions
  ADD CONSTRAINT identity_sessions_organization_workspace_fk
    FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE;
ALTER TABLE identity_sessions
  ADD CONSTRAINT identity_sessions_organization_actor_fk
    FOREIGN KEY (organization_id, actor_id)
    REFERENCES actors(organization_id, id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer', 'consumer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, actor_id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, actor_id)
    REFERENCES actors(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  normalized_email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reviewer', 'viewer', 'consumer')),
  token_digest TEXT NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_actor_id UUID NOT NULL,
  accepted_by_actor_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (normalized_email = lower(trim(normalized_email))),
  CHECK (expires_at > created_at),
  FOREIGN KEY (organization_id, invited_by_actor_id)
    REFERENCES actors(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, accepted_by_actor_id)
    REFERENCES actors(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_app_id UUID NOT NULL REFERENCES external_apps(id) ON DELETE CASCADE,
  external_tenant_ref TEXT NOT NULL CHECK (length(trim(external_tenant_ref)) BETWEEN 1 AND 300),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_app_id, external_tenant_ref),
  UNIQUE (external_app_id, id)
);

CREATE INDEX IF NOT EXISTS identity_sessions_user_active_idx
  ON identity_sessions (user_id, organization_id, workspace_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS actor_identities_user_idx ON actor_identities (user_id);
CREATE INDEX IF NOT EXISTS workspace_memberships_actor_idx
  ON workspace_memberships (actor_id, status, workspace_id);
CREATE INDEX IF NOT EXISTS organization_invitations_scope_status_idx
  ON organization_invitations (organization_id, workspace_id, status, expires_at);
CREATE INDEX IF NOT EXISTS external_tenants_organization_idx
  ON external_tenants (organization_id, status);

CREATE SCHEMA IF NOT EXISTS casioplus_private;

CREATE OR REPLACE FUNCTION casioplus_private.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('casioplus.organization_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION casioplus_private.current_workspace_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('casioplus.workspace_id', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizational_memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organizations_tenant_policy ON organizations;
CREATE POLICY organizations_tenant_policy ON organizations
  USING (id = casioplus_private.current_organization_id())
  WITH CHECK (id = casioplus_private.current_organization_id());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspaces',
    'actors',
    'members',
    'workspace_memberships',
    'organization_invitations',
    'flows',
    'work_items',
    'flow_runs',
    'runtime_events',
    'semantic_records',
    'knowledge_claims',
    'knowledge_reviews',
    'knowledge_promotions',
    'organizational_memory_items',
    'artifacts',
    'audit_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I USING (organization_id = casioplus_private.current_organization_id()) WITH CHECK (organization_id = casioplus_private.current_organization_id())',
      table_name
    );
  END LOOP;
END
$$;
