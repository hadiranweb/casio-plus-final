import { z } from 'zod';

const absoluteUrlSchema = z.string().url();

export const n8nWebhookConfigSchema = z.object({
  productionUrl: absoluteUrlSchema,
  testUrl: absoluteUrlSchema.optional(),
  authentication: z.enum(['basic', 'header', 'jwt']),
  allowedOrigins: z.array(absoluteUrlSchema).min(1),
  responseMode: z.enum(['immediate', 'last_node', 'respond_to_webhook']),
});

export const n8nHttpRequestSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: absoluteUrlSchema,
  headers: z.record(z.string(), z.string()).default({}),
  body: z.record(z.string(), z.unknown()).optional(),
});

export type N8nWebhookConfig = z.infer<typeof n8nWebhookConfigSchema>;
export type N8nHttpRequest = z.infer<typeof n8nHttpRequestSchema>;

export type N8nOrchestratorBinding = {
  runtime: 'n8n';
  role: 'orchestrator-only';
  webhook: N8nWebhookConfig;
};

export function createN8nOrchestratorBinding(input: unknown): N8nOrchestratorBinding {
  return {
    runtime: 'n8n',
    role: 'orchestrator-only',
    webhook: n8nWebhookConfigSchema.parse(input),
  };
}

export function createN8nHttpRequest(input: unknown): N8nHttpRequest {
  const request = n8nHttpRequestSchema.parse(input);
  return {
    ...request,
    headers: {
      ...request.headers,
      'x-casioplus-runtime': 'n8n',
    },
  };
}
