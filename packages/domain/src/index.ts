export type Identifier = string;

export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer' | 'consumer';

export type FlowStatus = 'draft' | 'validated' | 'published' | 'archived' | 'retired';

export type ProcessRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type WorkItemStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type KnowledgeClaimLifecycle =
  'candidate' | 'pending_review' | 'approved' | 'rejected' | 'corrected' | 'superseded';

export type MemoryKind =
  'verified_fact' | 'operational_procedure' | 'governed_decision' | 'validated_pattern';

export interface Actor {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  kind: 'human' | 'agent' | 'runtime';
  displayName: string;
}

export interface WorkItem {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  title: string;
  intent: string | null;
  status: WorkItemStatus;
  createdByActorId: Identifier;
  createdAt: string;
  updatedAt: string;
}

export interface FlowDefinition {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  key: string;
  name: string;
  status: FlowStatus;
  activeVersionId: Identifier | null;
}

export interface FlowVersion {
  id: Identifier;
  flowId: Identifier;
  version: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  runtimeBinding: 'native' | 'n8n' | 'openclaw' | 'open-webui';
  createdAt: string;
}

export interface ProcessRun {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  workItemId: Identifier;
  flowId: Identifier;
  flowVersionId: Identifier;
  status: ProcessRunStatus;
  idempotencyKey: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OperationalEvent {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  processRunId: Identifier | null;
  actorId: Identifier | null;
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  idempotencyKey: string | null;
}

export interface SemanticRecord {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  workItemId: Identifier;
  processRunId: Identifier;
  type: 'diagnostic_observation' | 'output_produced' | 'decision' | 'outcome_snapshot';
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  provenance: Provenance;
  status: 'pending_review' | 'approved' | 'rejected' | 'superseded';
  createdAt: string;
}

/**
 * Compatibility view label only. It is not a GitHub-like domain entity.
 */
export type WorkCommit = SemanticRecord;

export interface KnowledgeClaim {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  semanticRecordId: Identifier;
  processRunId: Identifier;
  subject: string;
  claimType: MemoryKind;
  content: Record<string, unknown>;
  evidence: Identifier[];
  confidence: number | null;
  lifecycle: KnowledgeClaimLifecycle;
  createdByActorId: Identifier;
  createdAt: string;
}

export interface KnowledgeReview {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  semanticRecordId: Identifier;
  reviewerActorId: Identifier;
  decision: 'approve' | 'reject' | 'correct' | 'supersede';
  rationale: string;
  createdAt: string;
}

export interface KnowledgePromotion {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier;
  claimId: Identifier;
  reviewId: Identifier;
  targetKind: MemoryKind;
  promotedByActorId: Identifier;
  rationale: string;
  createdAt: string;
}

export interface OrganizationalMemoryItem {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  kind: MemoryKind;
  title: string;
  content: Record<string, unknown>;
  sourceSemanticRecordId: Identifier | null;
  sourceClaimId: Identifier | null;
  promotionId: Identifier | null;
  lifecycle: 'candidate' | 'pending_review' | 'approved' | 'rejected' | 'superseded' | 'deprecated';
  sensitivity: 'public' | 'organization' | 'workspace' | 'restricted';
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
}

export interface Provenance {
  sourceType: 'process_run' | 'artifact' | 'human_input' | 'external_reference';
  sourceId: Identifier;
  actorId: Identifier | null;
  capturedAt: string;
}
