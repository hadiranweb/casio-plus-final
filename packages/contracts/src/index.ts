import { z } from 'zod';

export const identifierSchema = z.string().uuid();

export const publicRuntimeConfigSchema = z.object({
  coreApiUrl: z.string().url(),
  consoleUrl: z.string().url(),
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

export const switchContextSchema = z.object({
  organizationId: identifierSchema,
  workspaceId: identifierSchema,
});

export const updateMemberSchema = z
  .object({
    role: z.enum(['admin', 'editor', 'reviewer', 'viewer', 'consumer']).optional(),
    status: z.literal('revoked').optional(),
  })
  .refine((input) => input.role !== undefined || input.status !== undefined, {
    message: 'member update requires role or status',
  });

export const createExternalAppSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const createExternalTenantMappingSchema = z
  .object({
    externalAppId: z.string().uuid(),
    externalTenantRef: z.string().trim().min(1).max(300),
    workspaceId: z.string().uuid(),
    externalWorkspaceRef: z.string().trim().min(1).max(300),
    callbackOrigin: z.string().url().startsWith('https://').optional(),
    callbackPathPrefix: z.string().regex(/^\//).max(300).default('/'),
  })
  .strict();

export const createIntegrationKeyMetadataSchema = z
  .object({
    externalAppId: z.string().uuid(),
    keyId: z.string().regex(/^[A-Za-z0-9._-]{3,100}$/),
    secretRef: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
    retiringKeyId: z
      .string()
      .regex(/^[A-Za-z0-9._-]{3,100}$/)
      .optional(),
    retiringValidUntil: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.validFrom ||
      !input.validUntil ||
      new Date(input.validUntil).getTime() > new Date(input.validFrom).getTime(),
    { message: 'validUntil must be later than validFrom', path: ['validUntil'] },
  )
  .refine((input) => Boolean(input.retiringKeyId) === Boolean(input.retiringValidUntil), {
    message: 'retiringKeyId and retiringValidUntil must be supplied together',
    path: ['retiringKeyId'],
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
  operation: z.string().regex(/^(n8n|model|action|repository)\.[a-z][a-z0-9_.-]{1,120}$/),
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

export const openWebUiRuntimeDefinitionSchema = z.object({
  model: z.string().trim().min(1).max(200),
  systemPrompt: z.string().trim().min(1).max(20_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(131_072).optional(),
});

export const repositoryActionSchema = z.enum(['send_message', 'repository.open_translation_pr']);

export const openClawRuntimeDefinitionSchema = z.object({
  action: z.literal('send_message'),
  targetKey: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
});

export const createActionTargetSchema = organizationContextSchema.extend({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  action: repositoryActionSchema,
  executorRef: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
});

export const createActionPolicySchema = organizationContextSchema.extend({
  flowId: identifierSchema,
  flowVersionId: identifierSchema,
  targetId: identifierSchema,
  action: repositoryActionSchema,
  riskClass: z.enum(['low', 'medium', 'high']),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export const requestActionApprovalSchema = organizationContextSchema.extend({
  processRunId: identifierSchema,
  expiresInSeconds: z.number().int().min(60).max(86_400),
});

export const decideActionApprovalSchema = organizationContextSchema.extend({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().trim().min(1).max(2000),
});

export const translationLocaleSchema = z.enum(['en', 'fa']);
const translationTextSchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => value.trim().length > 0, 'translation_text_must_not_be_blank');
const translationItemContextSchema = z
  .object({
    surface: z.enum(['console', 'forge', 'shared']),
    route: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    characterLimit: z.number().int().min(1).max(20_000).optional(),
  })
  .strict();
const translationProvenanceSchema = z
  .object({
    model: z.string().trim().min(1).max(200).optional(),
    modelVersion: z.string().trim().min(1).max(200).optional(),
    promptVersion: z.string().trim().min(1).max(200).optional(),
    glossaryVersion: z.string().trim().min(1).max(200).optional(),
    scheduleId: identifierSchema.optional(),
  })
  .strict();
const translationMessageKeySchema = z.string().regex(/^[a-z][a-z0-9_]{2,199}$/);
const translationCommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const translationHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const translationChangeSetItemInputSchema = z.object({
  messageKey: translationMessageKeySchema,
  sourceText: translationTextSchema,
  currentTargetText: translationTextSchema.nullable().optional(),
  proposedText: translationTextSchema,
  placeholderSignature: z
    .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/))
    .max(50)
    .default([]),
  context: translationItemContextSchema,
});

export const createTranslationChangeSetSchema = organizationContextSchema
  .extend({
    processRunId: identifierSchema,
    repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    baseRef: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
    baseCommitSha: translationCommitShaSchema,
    catalogHash: translationHashSchema,
    sourceLocale: translationLocaleSchema,
    targetLocale: translationLocaleSchema,
    idempotencyKey: z.string().trim().min(16).max(200),
    expiresInSeconds: z.number().int().min(300).max(604_800).default(86_400),
    provenance: translationProvenanceSchema.default({}),
    items: z.array(translationChangeSetItemInputSchema).min(1).max(500),
  })
  .refine((value) => value.sourceLocale !== value.targetLocale, {
    message: 'translation_locales_must_differ',
    path: ['targetLocale'],
  });

export const submitTranslationChangeSetSchema = organizationContextSchema.extend({
  changeSetId: identifierSchema,
});

export const reviewTranslationChangeSetItemSchema = organizationContextSchema
  .extend({
    changeSetId: identifierSchema,
    itemId: identifierSchema,
    decision: z.enum(['accepted', 'edited', 'rejected']),
    reviewedText: translationTextSchema.optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .superRefine((value, context) => {
    if (value.decision === 'edited' && !value.reviewedText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reviewed_text_required_for_edited_translation',
        path: ['reviewedText'],
      });
    }
    if (value.decision !== 'edited' && value.reviewedText !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reviewed_text_only_allowed_for_edited_translation',
        path: ['reviewedText'],
      });
    }
  });

export const completeTranslationChangeSetReviewSchema = organizationContextSchema.extend({
  changeSetId: identifierSchema,
});

export const requestTranslationRepositoryApprovalSchema = organizationContextSchema.extend({
  changeSetId: identifierSchema,
  expiresInSeconds: z.number().int().min(60).max(86_400),
});

export const queueTranslationRepositorySyncSchema = organizationContextSchema.extend({
  changeSetId: identifierSchema,
});

export const translationRepositoryItemSchema = z
  .object({
    messageKey: translationMessageKeySchema,
    sourceText: translationTextSchema,
    currentTargetText: translationTextSchema.nullable(),
    reviewedText: translationTextSchema,
    sourceHash: translationHashSchema,
    currentTargetHash: translationHashSchema.nullable(),
    placeholderSignature: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(50),
  })
  .strict();

export const repositoryOpenTranslationPrPayloadSchema = z
  .object({
    action: z.literal('repository.open_translation_pr'),
    executorRef: z.literal('github-app.casio-plus-final'),
    changeSetId: identifierSchema,
    approvalId: identifierSchema,
    processRunId: identifierSchema,
    repositoryFullName: z.literal('hadiranweb/casio-plus-final'),
    baseRef: z.literal('main'),
    baseCommitSha: translationCommitShaSchema,
    catalogHash: translationHashSchema,
    sourceLocale: z.literal('en'),
    targetLocale: z.literal('fa'),
    branchRef: z.string().regex(/^casioplus\/translation\/[a-f0-9-]{36}$/),
    catalogPath: z.literal('packages/i18n/messages/fa.json'),
    sourceCatalogPath: z.literal('packages/i18n/messages/en.json'),
    items: z.array(translationRepositoryItemSchema).min(1).max(500),
    idempotencyKey: z.string().trim().min(16).max(200),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const translationRepositoryWebhookEventSchema = z
  .object({
    action: z.enum(['opened', 'reopened', 'synchronize', 'closed']),
    changeSetId: identifierSchema,
    repositoryFullName: z.literal('hadiranweb/casio-plus-final'),
    baseRef: z.literal('main'),
    branchRef: z.string().regex(/^casioplus\/translation\/[a-f0-9-]{36}$/),
    pullRequestNumber: z.number().int().positive(),
    pullRequestUrl: z
      .string()
      .regex(/^https:\/\/github\.com\/hadiranweb\/casio-plus-final\/pull\/[0-9]+$/),
    pullRequestHeadSha: translationCommitShaSchema,
    merged: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.changeSetId !== value.branchRef.slice('casioplus/translation/'.length)) {
      context.addIssue({ code: 'custom', message: 'translation_branch_change_set_mismatch' });
    }
    if (value.merged && value.action !== 'closed') {
      context.addIssue({ code: 'custom', message: 'translation_merged_event_invalid' });
    }
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
  contentType: z.string().trim().min(1).max(200),
  checksum: z.string().trim().max(200).nullable().optional(),
  sourceHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  sourceVersion: z.string().trim().min(1).max(200).nullable().optional(),
  sizeBytes: z.number().int().min(0).max(1_073_741_824).nullable().optional(),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
});

export const createArtifactUploadSchema = organizationContextSchema.extend({
  processRunId: identifierSchema,
  namespaceId: identifierSchema,
  artifactType: z.enum(['json', 'html', 'pdf', 'text', 'binary']),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().min(1).max(1_073_741_824),
  checksum: z.string().trim().min(16).max(200),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceVersion: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(16).max(200),
});

export const completeArtifactUploadSchema = organizationContextSchema.extend({
  artifactId: identifierSchema,
  observedSizeBytes: z.number().int().min(1).max(1_073_741_824),
  observedChecksum: z.string().trim().min(16).max(200),
});

export const createPricingAssumptionSchema = organizationContextSchema.extend({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  version: z.number().int().positive(),
  status: z.enum(['planning', 'active']),
  assumptions: z.record(z.string(), z.unknown()),
  effectiveFrom: z.string().datetime(),
  effectiveUntil: z.string().datetime().nullable().optional(),
});

export const createRuntimeMeterBindingSchema = organizationContextSchema.extend({
  runtime: z.enum(['open-webui', 'openclaw']),
  operation: z.enum([
    'model.chat.complete',
    'action.send_message',
    'action.repository.open_translation_pr',
  ]),
  resourceKey: z.string().trim().min(1).max(200),
  pricingVersionId: identifierSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  payer: z.enum(['casioplus', 'customer', 'external_product', 'shared']),
  directUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  inputTokenUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  outputTokenUnitCost: z.string().regex(/^\d+(\.\d{1,12})?$/),
  allocatedSharedCost: z.string().regex(/^\d+(\.\d{1,8})?$/),
  billableMultiplier: z.string().regex(/^\d+(\.\d{1,6})?$/),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export const recordUsageEventSchema = organizationContextSchema.extend({
  externalAppId: identifierSchema.nullable().optional(),
  externalTenantId: identifierSchema.nullable().optional(),
  flowId: identifierSchema,
  flowVersionId: identifierSchema,
  processRunId: identifierSchema,
  namespaceId: identifierSchema,
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  runtime: z.enum(['native', 'n8n', 'open-webui', 'openclaw']),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  inputBytes: z.number().int().min(0),
  outputBytes: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  unitCost: z.string().regex(/^\d+(\.\d{1,8})?$/),
  allocatedSharedCost: z.string().regex(/^\d+(\.\d{1,8})?$/),
  billableAmount: z.string().regex(/^\d+(\.\d{1,8})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  payer: z.enum(['casioplus', 'customer', 'external_product', 'shared']),
  pricingVersionId: identifierSchema,
  idempotencyKey: z.string().trim().min(16).max(200),
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

export const governedMemoryGraphSchema = organizationContextSchema.extend({
  purpose: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  flowId: identifierSchema.optional(),
  namespaceIds: z.array(identifierSchema).min(1).max(50).optional(),
  limit: z.number().int().min(10).max(80).default(60),
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
export type SwitchContextInput = z.infer<typeof switchContextSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
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
export type CreateTranslationChangeSetInput = z.infer<typeof createTranslationChangeSetSchema>;
export type ReviewTranslationChangeSetItemInput = z.infer<
  typeof reviewTranslationChangeSetItemSchema
>;
export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
export type CreateArtifactUploadInput = z.infer<typeof createArtifactUploadSchema>;
export type CompleteArtifactUploadInput = z.infer<typeof completeArtifactUploadSchema>;
export type CreatePricingAssumptionInput = z.infer<typeof createPricingAssumptionSchema>;
export type CreateRuntimeMeterBindingInput = z.infer<typeof createRuntimeMeterBindingSchema>;
export type RecordUsageEventInput = z.infer<typeof recordUsageEventSchema>;
export type CreateSemanticRecordInput = z.infer<typeof createSemanticRecordSchema>;
export type CreateKnowledgeClaimInput = z.infer<typeof createKnowledgeClaimSchema>;
export type CreateCommitInput = z.infer<typeof createCommitSchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type KnowledgePromotionInput = z.infer<typeof knowledgePromotionSchema>;
export type NativeDiagnosisJob = z.infer<typeof nativeDiagnosisJobSchema>;
export type NativeExecutionResult = z.infer<typeof nativeExecutionResultSchema>;
export type GovernedRetrievalInput = z.infer<typeof governedRetrievalSchema>;
export type GovernedMemoryGraphInput = z.infer<typeof governedMemoryGraphSchema>;
export type CreateMemoryNamespaceInput = z.infer<typeof createMemoryNamespaceSchema>;
export type CreateMemoryGrantInput = z.infer<typeof createMemoryGrantSchema>;
