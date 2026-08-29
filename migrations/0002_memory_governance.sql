-- Canonical memory terminology replaces the initial bootstrap table names.
ALTER TABLE IF EXISTS work_commits RENAME TO semantic_records;
ALTER TABLE IF EXISTS work_commit_inputs RENAME TO semantic_record_inputs;
ALTER TABLE IF EXISTS work_commit_outputs RENAME TO semantic_record_outputs;
ALTER TABLE IF EXISTS reviews RENAME TO knowledge_reviews;
ALTER TABLE IF EXISTS memory_items RENAME TO organizational_memory_items;
ALTER TABLE IF EXISTS memory_revisions RENAME TO organizational_memory_revisions;

ALTER TABLE IF EXISTS knowledge_reviews RENAME COLUMN commit_id TO semantic_record_id;
ALTER TABLE IF EXISTS organizational_memory_items RENAME COLUMN source_commit_id TO source_semantic_record_id;

ALTER TABLE IF EXISTS semantic_records
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'outcome_snapshot'
    CHECK (record_type IN ('diagnostic_observation', 'output_produced', 'decision', 'outcome_snapshot'));
ALTER TABLE IF EXISTS semantic_records
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE IF EXISTS semantic_records
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  semantic_record_id UUID NOT NULL REFERENCES semantic_records(id) ON DELETE RESTRICT,
  process_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 300),
  claim_type TEXT NOT NULL CHECK (claim_type IN ('verified_fact', 'operational_procedure', 'governed_decision', 'validated_pattern')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(5, 4) CHECK (confidence >= 0 AND confidence <= 1),
  lifecycle TEXT NOT NULL DEFAULT 'candidate'
    CHECK (lifecycle IN ('candidate', 'pending_review', 'approved', 'rejected', 'corrected', 'superseded')),
  created_by_actor_id UUID NOT NULL REFERENCES actors(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL UNIQUE REFERENCES knowledge_claims(id) ON DELETE RESTRICT,
  review_id UUID NOT NULL REFERENCES knowledge_reviews(id) ON DELETE RESTRICT,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('verified_fact', 'operational_procedure', 'governed_decision', 'validated_pattern')),
  promoted_by_actor_id UUID NOT NULL REFERENCES actors(id),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS organizational_memory_items
  ADD COLUMN IF NOT EXISTS source_claim_id UUID REFERENCES knowledge_claims(id) ON DELETE RESTRICT;
ALTER TABLE IF EXISTS organizational_memory_items
  ADD COLUMN IF NOT EXISTS promotion_id UUID UNIQUE REFERENCES knowledge_promotions(id) ON DELETE RESTRICT;
ALTER TABLE IF EXISTS organizational_memory_items
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content::text, ''))
  ) STORED;

CREATE TABLE IF NOT EXISTS semantic_record_parents (
  semantic_record_id UUID NOT NULL REFERENCES semantic_records(id) ON DELETE CASCADE,
  parent_semantic_record_id UUID NOT NULL REFERENCES semantic_records(id) ON DELETE RESTRICT,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('derived_from', 'supports', 'supersedes', 'contradicts')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (semantic_record_id, parent_semantic_record_id, relation_type),
  CHECK (semantic_record_id <> parent_semantic_record_id)
);

CREATE INDEX IF NOT EXISTS knowledge_claims_scope_lifecycle_idx
  ON knowledge_claims (organization_id, workspace_id, lifecycle, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_promotions_scope_created_idx
  ON knowledge_promotions (organization_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS semantic_records_run_created_idx
  ON semantic_records (process_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS semantic_record_parents_parent_idx
  ON semantic_record_parents (parent_semantic_record_id);
CREATE INDEX IF NOT EXISTS organizational_memory_search_vector_idx
  ON organizational_memory_items USING GIN (search_vector);
