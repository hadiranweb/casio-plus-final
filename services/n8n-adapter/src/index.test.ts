import { describe, expect, it } from 'vitest';
import { createN8nHttpRequest, createN8nOrchestratorBinding } from './index.js';

const webhook = {
  productionUrl: 'https://n8n.example.com/webhook/casioplus-diagnosis',
  testUrl: 'https://n8n.example.com/webhook-test/casioplus-diagnosis',
  authentication: 'header' as const,
  allowedOrigins: ['https://app.casioplus.com'],
  responseMode: 'respond_to_webhook' as const,
};

describe('n8n adapter boundary', () => {
  it('requires production webhook authentication and an origin allowlist', () => {
    const binding = createN8nOrchestratorBinding(webhook);
    expect(binding).toMatchObject({ runtime: 'n8n', role: 'orchestrator-only' });
    expect(binding.webhook.authentication).toBe('header');
    expect(binding.webhook.allowedOrigins).toEqual(['https://app.casioplus.com']);
  });

  it('adds a non-secret runtime marker to outbound HTTP requests', () => {
    const request = createN8nHttpRequest({
      method: 'POST',
      url: 'https://api.casioplus.com/api/v1/process-runs',
      body: { processRunId: 'run-1' },
    });
    expect(request.headers).toEqual({ 'x-casioplus-runtime': 'n8n' });
    expect(request.body).toEqual({ processRunId: 'run-1' });
  });

  it('rejects an unprotected webhook binding', () => {
    expect(() =>
      createN8nOrchestratorBinding({
        productionUrl: webhook.productionUrl,
        allowedOrigins: webhook.allowedOrigins,
        responseMode: webhook.responseMode,
      }),
    ).toThrow();
  });
});
