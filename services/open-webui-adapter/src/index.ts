import { z } from 'zod';

const runtimeDefinitionSchema = z.object({
  model: z.string().trim().min(1).max(200),
  systemPrompt: z.string().trim().min(1).max(20_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(131_072).optional(),
});

export const openWebUiRuntimeRequestSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    definition: runtimeDefinitionSchema,
  })
  .transform(({ input, definition }, context) => {
    const prompt = input.prompt;
    if (typeof prompt !== 'string' || prompt.trim().length < 1 || prompt.length > 50_000) {
      context.addIssue({
        code: 'custom',
        path: ['input', 'prompt'],
        message: 'input.prompt must contain between 1 and 50000 characters',
      });
      return z.NEVER;
    }
    return { ...definition, prompt: prompt.trim() };
  });

export const openWebUiModelResponseSchema = z.object({
  id: z.string().trim().min(1).max(500).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().max(200_000),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type OpenWebUiRuntimeRequest = z.infer<typeof openWebUiRuntimeRequestSchema>;
export type OpenWebUiModelResponse = z.infer<typeof openWebUiModelResponseSchema>;
