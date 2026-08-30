import { z } from 'zod';

export const openClawChannelSchema = z.enum([
  'discord',
  'googlechat',
  'imessage',
  'matrix',
  'mattermost',
  'msteams',
  'signal',
  'slack',
  'telegram',
  'whatsapp',
]);

export const openClawExecutorTargetSchema = z.object({
  channel: openClawChannelSchema,
  target: z.string().trim().min(1).max(500),
  account: z.string().trim().min(1).max(200).optional(),
});

export const openClawActionRequestSchema = z.object({
  action: z.literal('send_message'),
  executorRef: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  message: z.string().trim().min(1).max(10_000),
  approvalId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(16).max(200),
  expiresAt: z.string().datetime(),
});

export const openClawCliResultSchema = z.object({
  runId: z.string().trim().min(1).max(500).optional(),
  messageId: z.string().trim().min(1).max(500).optional(),
  channel: z.string().trim().min(1).max(100).optional(),
  deliveryStatus: z
    .object({
      status: z.enum(['sent', 'suppressed', 'partial_failed', 'failed']),
      succeeded: z.union([z.boolean(), z.literal('partial')]),
      resultCount: z.number().int().nonnegative().optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .optional(),
});

export type OpenClawActionRequest = z.infer<typeof openClawActionRequestSchema>;
export type OpenClawExecutorTarget = z.infer<typeof openClawExecutorTargetSchema>;
export type OpenClawCliResult = z.infer<typeof openClawCliResultSchema>;

export function parseOpenClawExecutorTargets(
  input: string,
): Record<string, OpenClawExecutorTarget> {
  const parsed = z.record(z.string(), openClawExecutorTargetSchema).parse(JSON.parse(input));
  for (const key of Object.keys(parsed)) {
    if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(key)) throw new Error('openclaw_executor_ref_invalid');
  }
  return parsed;
}
