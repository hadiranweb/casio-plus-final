import { createHmac } from 'node:crypto';
import { z } from 'zod';

const absoluteUrlSchema = z.string().url();

export const openWebUiContextSchema = z.object({
  baseUrl: absoluteUrlSchema,
  conversationId: z.string().trim().min(1).max(200),
  allowedTools: z.array(z.enum(['get_work_status', 'retrieve_memory', 'start_flow'])).min(1),
  callbackUrl: absoluteUrlSchema,
});

export const openWebUiMessageSchema = z.object({
  conversationId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(20_000),
  contextRef: z.string().trim().min(1).max(200),
});

export type OpenWebUiContext = z.infer<typeof openWebUiContextSchema>;
export type OpenWebUiMessage = z.infer<typeof openWebUiMessageSchema>;

export function createOpenWebUiContext(input: unknown): OpenWebUiContext {
  return openWebUiContextSchema.parse(input);
}

export function createOpenWebUiMessage(input: unknown): OpenWebUiMessage {
  return openWebUiMessageSchema.parse(input);
}

export function signOpenWebUiCallback(rawBody: string, secret: string): string {
  if (secret.trim().length < 32)
    throw new Error('OPEN_WEBUI_SHARED_SECRET must contain at least 32 characters');
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function createOpenWebUiCallbackHeaders(rawBody: string, secret: string) {
  return {
    'content-type': 'application/json',
    'x-casioplus-runtime': 'open-webui',
    'x-casioplus-runtime-signature': signOpenWebUiCallback(rawBody, secret),
  };
}
