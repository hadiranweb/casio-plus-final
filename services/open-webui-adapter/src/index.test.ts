import { describe, expect, it } from 'vitest';
import {
  createOpenWebUiCallbackHeaders,
  createOpenWebUiContext,
  createOpenWebUiMessage,
} from './index.js';

const secret = 'open-webui-shared-secret-with-at-least-32-chars';

describe('Open WebUI adapter boundary', () => {
  it('allows only typed governed tools', () => {
    const context = createOpenWebUiContext({
      baseUrl: 'https://webui.example.com',
      conversationId: 'conversation-1',
      allowedTools: ['get_work_status', 'retrieve_memory'],
      callbackUrl: 'https://api.casioplus.com/callbacks/open-webui',
    });
    expect(context.allowedTools).toEqual(['get_work_status', 'retrieve_memory']);
  });

  it('requires a context reference on model messages', () => {
    expect(() =>
      createOpenWebUiMessage({ conversationId: 'conversation-1', message: 'hello' }),
    ).toThrow();
    expect(
      createOpenWebUiMessage({
        conversationId: 'conversation-1',
        message: 'summarize this work',
        contextRef: 'work:00000000-0000-4000-8000-000000000001',
      }),
    ).toMatchObject({ contextRef: 'work:00000000-0000-4000-8000-000000000001' });
  });

  it('signs callbacks and rejects short secrets', () => {
    const rawBody = JSON.stringify({ event: 'assistant.completed', ref: 'run-1' });
    const headers = createOpenWebUiCallbackHeaders(rawBody, secret);
    expect(headers['x-casioplus-runtime']).toBe('open-webui');
    expect(headers['x-casioplus-runtime-signature']).toHaveLength(64);
    expect(() => createOpenWebUiCallbackHeaders(rawBody, 'short')).toThrow();
  });
});
