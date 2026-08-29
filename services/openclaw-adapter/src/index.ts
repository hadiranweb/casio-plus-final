import { createHmac } from 'node:crypto';
import { z } from 'zod';

const openClawActionSchema = z.enum(['send_message', 'create_ticket', 'post_webhook']);

export const openClawActionRequestSchema = z.object({
  action: openClawActionSchema,
  target: z.string().trim().min(1).max(500),
  payload: z.record(z.string(), z.unknown()),
  approvalId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(16).max(200),
  expiresAt: z.string().datetime(),
});

export type OpenClawActionRequest = z.infer<typeof openClawActionRequestSchema>;

export function createOpenClawActionRequest(input: unknown): OpenClawActionRequest {
  return openClawActionRequestSchema.parse(input);
}

export function signOpenClawAction(rawBody: string, secret: string): string {
  if (secret.trim().length < 32)
    throw new Error('OPENCLAW_SHARED_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function createOpenClawActionHeaders(rawBody: string, secret: string) {
  return {
    'content-type': 'application/json',
    'x-casioplus-runtime': 'openclaw',
    'x-casioplus-action-signature': signOpenClawAction(rawBody, secret),
  };
}
