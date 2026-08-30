CREATE TABLE IF NOT EXISTS storage_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'casio_managed'
    CHECK (mode IN ('casio_managed', 'product_managed', 'hybrid', 'customer_managed')),
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
  deletion_propagation BOOLEAN NOT NULL DEFAULT true,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_namespaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  storage_policy_id UUID NOT NULL REFERENCES storage_policies(id) ON DELETE RESTRICT,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  namespace_kind TEXT NOT NULL DEFAULT 'governed'
    CHECK (namespace_kind IN ('raw', 'governed', 'knowledge_pack')),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility = 'private'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

INSERT INTO storage_policies (organization_id, mode, retention_days, deletion_propagation)
SELECT id, 'casio_managed', 365, true
  FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO memory_namespaces
    (organization_id, workspace_id, storage_policy_id, key, name, namespace_kind)
SELECT o.id, NULL, sp.id, 'organization-memory', 'Organization Memory', 'governed'
  FROM organizations o
  JOIN storage_policies sp ON sp.organization_id = o.id
ON CONFLICT (organization_id, key) DO NOTHING;

ALTER TABLE semantic_records ADD COLUMN IF NOT EXISTS namespace_id UUID;
ALTER TABLE knowledge_claims ADD COLUMN IF NOT EXISTS namespace_id UUID;
ALTER TABLE knowledge_promotions ADD COLUMN IF NOT EXISTS namespace_id UUID;
ALTER TABLE organizational_memory_items ADD COLUMN IF NOT EXISTS namespace_id UUID;

UPDATE semantic_records sr
   SET namespace_id = mn.id
  FROM memory_namespaces mn
 WHERE mn.organization_id = sr.organization_id AND mn.key = 'organization-memory'
   AND sr.namespace_id IS NULL;
UPDATE knowledge_claims kc
   SET namespace_id = mn.id
  FROM memory_namespaces mn
 WHERE mn.organization_id = kc.organization_id AND mn.key = 'organization-memory'
   AND kc.namespace_id IS NULL;
UPDATE knowledge_promotions kp
   SET namespace_id = mn.id
  FROM memory_namespaces mn
 WHERE mn.organization_id = kp.organization_id AND mn.key = 'organization-memory'
   AND kp.namespace_id IS NULL;
UPDATE organizational_memory_items omi
   SET namespace_id = mn.id
  FROM memory_namespaces mn
 WHERE mn.organization_id = omi.organization_id AND mn.key = 'organization-memory'
   AND omi.namespace_id IS NULL;

ALTER TABLE semantic_records ALTER COLUMN namespace_id SET NOT NULL;
ALTER TABLE knowledge_claims ALTER COLUMN namespace_id SET NOT NULL;
ALTER TABLE knowledge_promotions ALTER COLUMN namespace_id SET NOT NULL;
ALTER TABLE organizational_memory_items ALTER COLUMN namespace_id SET NOT NULL;

ALTER TABLE semantic_records
  ADD CONSTRAINT semantic_records_namespace_fk
  FOREIGN KEY (organization_id, namespace_id)
  REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE knowledge_claims
  ADD CONSTRAINT knowledge_claims_namespace_fk
  FOREIGN KEY (organization_id, namespace_id)
  REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE knowledge_promotions
  ADD CONSTRAINT knowledge_promotions_namespace_fk
  FOREIGN KEY (organization_id, namespace_id)
  REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE organizational_memory_items
  ADD CONSTRAINT organizational_memory_items_namespace_fk
  FOREIGN KEY (organization_id, namespace_id)
  REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS memory_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grantee_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  namespace_id UUID NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_.-]{2,127}$'),
  flow_id UUID,
  allowed_kinds TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  allowed_sensitivities TEXT[] NOT NULL DEFAULT ARRAY['public', 'organization']::text[],
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_actor_id UUID NOT NULL,
  revoked_by_actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (grantor_organization_id <> grantee_organization_id),
  CHECK (valid_until > valid_from),
  FOREIGN KEY (grantor_organization_id, namespace_id)
    REFERENCES memory_namespaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (grantor_organization_id, created_by_actor_id)
    REFERENCES actors(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (grantor_organization_id, revoked_by_actor_id)
    REFERENCES actors(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS raw_namespace_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  namespace_id UUID NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  source_version TEXT NOT NULL CHECK (length(trim(source_version)) BETWEEN 1 AND 200),
  payload JSONB NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (namespace_id, source_hash, source_version),
  FOREIGN KEY (organization_id, namespace_id)
    REFERENCES memory_namespaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID,
  namespace_id UUID NOT NULL,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,63}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (namespace_id, key),
  FOREIGN KEY (organization_id, namespace_id)
    REFERENCES memory_namespaces(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_pack_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_pack_id UUID NOT NULL REFERENCES knowledge_packs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (knowledge_pack_id, version),
  UNIQUE (knowledge_pack_id, source_hash)
);

CREATE TABLE IF NOT EXISTS memory_access_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_workspace_id UUID NOT NULL,
  requester_actor_id UUID NOT NULL,
  flow_id UUID,
  purpose TEXT NOT NULL,
  query_hash TEXT NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  requested_kinds TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  allowed_namespace_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  applied_grant_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  result_count INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
  denial_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (requester_organization_id, requester_workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (requester_organization_id, requester_actor_id)
    REFERENCES actors(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS memory_namespaces_scope_idx
  ON memory_namespaces (organization_id, workspace_id, namespace_kind, status);
CREATE INDEX IF NOT EXISTS memory_grants_lookup_idx
  ON memory_grants (grantee_organization_id, namespace_id, purpose, valid_from, valid_until)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS memory_items_namespace_search_idx
  ON organizational_memory_items (namespace_id, lifecycle, sensitivity, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS raw_namespace_retention_idx
  ON raw_namespace_records (namespace_id, retention_until) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS memory_access_decisions_scope_idx
  ON memory_access_decisions (requester_organization_id, requester_workspace_id, created_at DESC);

ALTER TABLE memory_namespaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_namespace_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_access_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON memory_namespaces
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON storage_policies
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON raw_namespace_records
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON knowledge_packs
  USING (organization_id = casioplus_private.current_organization_id())
  WITH CHECK (organization_id = casioplus_private.current_organization_id());
CREATE POLICY tenant_isolation_policy ON memory_access_decisions
  USING (requester_organization_id = casioplus_private.current_organization_id())
  WITH CHECK (requester_organization_id = casioplus_private.current_organization_id());
