import { z } from 'zod';

export const identifierSchema = z.string().uuid();

export const publicRuntimeConfigSchema = z.object({
  coreApiUrl: z.string().url(),
  appUrl: z.string().url(),
  studioUrl: z.string().url(),
});

export const organizationContextSchema = z.object({
  organizationId: identifierSchema,
  workspaceId: identifierSchema,
  actorId: identifierSchema,
});

const memoryKindSchema = z.enum([
  'verified_fact',
  'operational_procedure',
  'governed_decision',
  'validated_pattern',
]);

const semanticRecordTypeSchema = z.enum([
  'diagnostic_observation',
  'output_produced',
  'decision',
  'outcome_snapshot',
]);

const runtimeBindingSchema = z.enum(['native', 'n8n', 'openclaw', 'open-webui']);

export const createWorkItemSchema = organizationContextSchema.extend({
  title: z.string().trim().min(1).max(200),
  intent: z.string().trim().max(2000).nullable().optional(),
});

export const createFlowSchema = organizationContextSchema.extend({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  name: z.string().trim().min(1).max(200),
});

export const createFlowVersionSchema = organizationContextSchema.extend({
  flowId: identifierSchema,
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  definition: z.record(z.string(), z.unknown()).default({}),
  runtimeBinding: runtimeBindingSchema,
});

export const createProcessRunSchema = organizationContextSchema.extend({
  workItemId: identifierSchema,
  flowId: identifierSchema,
  flowVersionId: identifierSchema,
  idempotencyKey: z.string().trim().min(16).max(200),
  input: z.record(z.string(), z.unknown()),
});

export const runtimeEventSchema = organizationContextSchema.extend({
  processRunId: identifierSchema.nullable(),
  type: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
});

export const createArtifactSchema = organizationContextSchema.extend({
  processRunId: identifierSchema.nullable(),
  artifactType: z.enum(['json', 'html', 'pdf', 'text', 'binary']),
  objectKey: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(200),
  checksum: z.string().trim().max(200).nullable().optional(),
});

export const createSemanticRecordSchema = organizationContextSchema.extend({
  workItemId: identifierSchema,
  processRunId: identifierSchema,
  type: semanticRecordTypeSchema,
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(5000),
  payload: z.record(z.string(), z.unknown()),
  provenance: z.object({
    sourceType: z.enum(['process_run', 'artifact', 'human_input', 'external_reference']),
    sourceId: identifierSchema,
    actorId: identifierSchema.nullable(),
  }),
});

export const createKnowledgeClaimSchema = organizationContextSchema.extend({
  semanticRecordId: identifierSchema,
  processRunId: identifierSchema,
  subject: z.string().trim().min(1).max(300),
  claimType: memoryKindSchema,
  content: z.record(z.string(), z.unknown()),
  evidence: z.array(identifierSchema).min(1).max(50),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export const createCommitSchema = organizationContextSchema.extend({
  workItemId: identifierSchema,
  processRunId: identifierSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(5000),
  outcome: z.record(z.string(), z.unknown()),
});

export const reviewDecisionSchema = organizationContextSchema.extend({
  claimId: identifierSchema,
  decision: z.enum(['approve', 'reject', 'correct', 'supersede']),
  rationale: z.string().trim().min(1).max(5000),
});

export const knowledgePromotionSchema = organizationContextSchema.extend({
  claimId: identifierSchema,
  reviewId: identifierSchema,
  targetKind: memoryKindSchema,
  title: z.string().trim().min(1).max(300),
  content: z.record(z.string(), z.unknown()),
  sensitivity: z.enum(['public', 'organization', 'workspace', 'restricted']).default('workspace'),
  rationale: z.string().trim().min(1).max(5000),
});

export const nativeDiagnosisJobSchema = z.object({
  schemaVersion: z.literal('business-diagnosis.v1'),
  organizationId: identifierSchema,
  workspaceId: identifierSchema,
  actorId: identifierSchema,
  workItemId: identifierSchema,
  processRunId: identifierSchema,
  input: z.record(z.string(), z.unknown()),
});

export const nativeExecutionResultSchema = z.object({
  schemaVersion: z.literal('business-diagnosis.v1'),
  output: z.record(z.string(), z.unknown()),
});

export const governedRetrievalSchema = organizationContextSchema.extend({
  query: z.string().trim().min(1).max(1000),
  allowedKinds: z.array(memoryKindSchema).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>;
export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type CreateFlowInput = z.infer<typeof createFlowSchema>;
export type CreateFlowVersionInput = z.infer<typeof createFlowVersionSchema>;
export type CreateProcessRunInput = z.infer<typeof createProcessRunSchema>;
export type RuntimeEventInput = z.infer<typeof runtimeEventSchema>;
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
export type CreateSemanticRecordInput = z.infer<typeof createSemanticRecordSchema>;
export type CreateKnowledgeClaimInput = z.infer<typeof createKnowledgeClaimSchema>;
export type CreateCommitInput = z.infer<typeof createCommitSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type KnowledgePromotionInput = z.infer<typeof knowledgePromotionSchema>;
export type NativeDiagnosisJob = z.infer<typeof nativeDiagnosisJobSchema>;
export type NativeExecutionResult = z.infer<typeof nativeExecutionResultSchema>;
export type GovernedRetrievalInput = z.infer<typeof governedRetrievalSchema>;
