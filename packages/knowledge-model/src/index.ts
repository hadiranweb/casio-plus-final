import type { Identifier, Provenance } from '../../domain/src/index.js';

export type KnowledgeKind =
  'verified_fact' | 'operational_procedure' | 'governed_decision' | 'validated_pattern';

export type KnowledgeLifecycle =
  'candidate' | 'pending_review' | 'approved' | 'rejected' | 'superseded' | 'deprecated';

export interface OperationalEvent {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  type: string;
  actorId: Identifier | null;
  processRunId: Identifier | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface SemanticRecord {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  kind: 'observation' | 'decision' | 'outcome' | 'constraint';
  subject: string;
  content: Record<string, unknown>;
  provenance: Provenance[];
  createdAt: string;
}

export interface KnowledgeClaim {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  statement: string;
  evidenceSourceIds: Identifier[];
  status: KnowledgeLifecycle;
  confidence: number | null;
  provenance: Provenance[];
  createdAt: string;
}

export interface KnowledgeReview {
  id: Identifier;
  organizationId: Identifier;
  claimId: Identifier;
  reviewerActorId: Identifier;
  decision: 'approve' | 'reject' | 'correct' | 'supersede';
  rationale: string;
  createdAt: string;
}

export interface OrganizationalMemoryItem {
  id: Identifier;
  organizationId: Identifier;
  workspaceId: Identifier | null;
  kind: KnowledgeKind;
  title: string;
  content: Record<string, unknown>;
  sourceClaimId: Identifier;
  lifecycle: KnowledgeLifecycle;
  sensitivity: 'public' | 'organization' | 'workspace' | 'restricted';
  validFrom: string;
  validUntil: string | null;
  provenance: Provenance[];
  createdAt: string;
}

export interface GovernedRetrievalRequest {
  organizationId: Identifier;
  workspaceId: Identifier | null;
  actorId: Identifier;
  query: string;
  allowedKinds?: KnowledgeKind[];
  limit: number;
}
