import { describe, expect, it } from 'vitest';
import { openWebUiModelResponseSchema, openWebUiRuntimeRequestSchema } from './index.js';

describe('Open WebUI model-plane contracts', () => {
  it('accepts a bounded prompt and version-owned model definition', () => {
    expect(
      openWebUiRuntimeRequestSchema.parse({
        input: { prompt: 'Summarize the governed evidence.' },
        definition: {
          model: 'casioplus-default-model',
          systemPrompt: 'Use only supplied context.',
          temperature: 0.2,
          maxTokens: 800,
        },
      }),
    ).toMatchObject({
      model: 'casioplus-default-model',
      prompt: 'Summarize the governed evidence.',
    });
  });

  it('rejects missing prompts and invalid model definitions', () => {
    expect(() =>
      openWebUiRuntimeRequestSchema.parse({
        input: { message: 'No authoritative prompt field' },
        definition: { model: 'model-a' },
      }),
    ).toThrow();
    expect(() =>
      openWebUiRuntimeRequestSchema.parse({
        input: { prompt: 'hello' },
        definition: { model: '' },
      }),
    ).toThrow();
  });

  it('accepts whole-reply usage returned by Open WebUI', () => {
    const response = openWebUiModelResponseSchema.parse({
      id: 'completion-1',
      model: 'model-a',
      choices: [{ message: { content: 'Completed response' } }],
      usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    });
    expect(response.usage?.total_tokens).toBe(20);
  });
});
