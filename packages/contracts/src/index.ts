import { z } from 'zod';

export const identifierSchema = z.string().uuid();

export const publicRuntimeConfigSchema = z.object({
  coreApiUrl: z.string().url(),
  appUrl: z.string().url(),
  forgeUrl: z.string().url(),
});

export const organizationContextSchema = z.object({
  organizationId: identifierSchema,
  workspaceId: identifierSchema,
  actorId: identifierSchema,
});

export const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(12).max(200);
export const slugSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

export const registerAccountSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(200),
  organizationName: z.string().trim().min(1).max(200),
  organizationSlug: slugSchema,
  workspaceName: z.string().trim().min(1).max(200),
  workspaceSlug: slugSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  organizationId: identifierSchema.optional(),
  workspaceId: identifierSchema.optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  workspaceName: z.string().trim().min(1).max(200),
  workspaceSlug: slugSchema,
});

export const createWorkspaceSchema = organizationContextSchema.extend({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
});

export const createInvitationSchema = organizationContextSchema.extend({
  email: emailSchema,
  workspaceId: identifierSchema.optional(),
  role: z.enum(['admin', 'editor', 'reviewer', 'viewer', 'consumer']),
  expiresInHours: z.number().int().min(1).max(720).default(168),
});

export const acceptInvitationSchema = z.object({
  token: z.string().trim().min(32).max(512),
});

export const integrationIngressSchema = z.object({
  externalTenantRef: z.string().trim().min(1).max(300),
  externalWorkspaceRef: z.string().trim().min(1).max(300),
  operation: z.string().regex(/^(n8n|model|action)\.[a-z][a-z0-9_.-]{1,120}$/),
  idempotencyKey: z.string().trim().min(16).max(200),
  payload: z.record(z.string(), z.unknown()).default({}),
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
  purpose: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  flowId: identifierSchema.optional(),
  namespaceIds: z.array(identifierSchema).min(1).max(50).optional(),
  allowedKinds: z.array(memoryKindSchema).optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const createMemoryNamespaceSchema = organizationContextSchema.extend({
  key: slugSchema,
  name: z.string().trim().min(1).max(200),
  namespaceKind: z.enum(['raw', 'governed', 'knowledge_pack']),
  targetWorkspaceId: identifierSchema.nullable().optional(),
});

export const createMemoryGrantSchema = organizationContextSchema.extend({
  namespaceId: identifierSchema,
  granteeOrganizationId: identifierSchema,
  purpose: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  flowId: identifierSchema.nullable().optional(),
  allowedKinds: z.array(memoryKindSchema).min(1).max(20),
  allowedSensitivities: z
    .array(z.enum(['public', 'organization', 'workspace', 'restricted']))
    .min(1)
    .max(4),
  scope: z.record(z.string(), z.unknown()).default({}),
  validUntil: z.string().datetime(),
});

export type PublicRuntimeConfig = z.infer<typeof publicRuntimeConfigSchema>;
export type RegisterAccountInput = z.infer<typeof registerAccountSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type IntegrationIngressInput = z.infer<typeof integrationIngressSchema>;
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
export type CreateMemoryNamespaceInput = z.infer<typeof createMemoryNamespaceSchema>;
export type CreateMemoryGrantInput = z.infer<typeof createMemoryGrantSchema>;
