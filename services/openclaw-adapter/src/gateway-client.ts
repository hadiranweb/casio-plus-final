import { spawn } from 'node:child_process';
import { openClawCliResultSchema, type OpenClawExecutorTarget } from './index.js';

export type OpenClawGatewayConfiguration = {
  executable: string;
  url?: string;
  token?: string;
  timeoutMs: number;
};

type SpawnLike = typeof spawn;

export async function sendOpenClawGatewayMessage(
  configuration: OpenClawGatewayConfiguration,
  target: OpenClawExecutorTarget,
  message: string,
  idempotencyKey: string,
  spawnImplementation: SpawnLike = spawn,
) {
  const parameters = {
    to: target.target,
    message,
    channel: target.channel,
    ...(target.account ? { accountId: target.account } : {}),
    idempotencyKey,
  };
  const child = spawnImplementation(
    configuration.executable,
    [
      'gateway',
      'call',
      'send',
      '--params',
      JSON.stringify(parameters),
      '--json',
      '--timeout',
      String(configuration.timeoutMs),
    ],
    {
      env: {
        ...process.env,
        ...(configuration.url ? { OPENCLAW_GATEWAY_URL: configuration.url } : {}),
        ...(configuration.token ? { OPENCLAW_GATEWAY_TOKEN: configuration.token } : {}),
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('openclaw_gateway_timeout'));
    }, configuration.timeoutMs + 1_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    const error = new Error('openclaw_gateway_call_failed');
    Object.assign(error, {
      retryable: !Buffer.concat(stderr).toString('utf8').includes('INVALID_REQUEST'),
    });
    throw error;
  }
  const raw = Buffer.concat(stdout).toString('utf8').trim();
  const parsed = openClawCliResultSchema.parse(JSON.parse(raw) as unknown);
  if (parsed.deliveryStatus && parsed.deliveryStatus.status !== 'sent') {
    throw new Error(`openclaw_delivery_${parsed.deliveryStatus.status}`);
  }
  return {
    runId: parsed.runId,
    messageId: parsed.messageId,
    channel: target.channel,
  };
}
