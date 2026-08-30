import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sendOpenClawGatewayMessage } from './gateway-client.js';

const cleanup: string[] = [];
afterEach(async () => {
  delete process.env.CASIOPLUS_OPENCLAW_TEST_CAPTURE;
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OpenClaw Gateway client', () => {
  it('uses official gateway call with stable idempotency without putting the token in argv', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casioplus-openclaw-'));
    cleanup.push(directory);
    const executable = join(directory, 'fake-openclaw');
    const capture = join(directory, 'arguments.txt');
    process.env.CASIOPLUS_OPENCLAW_TEST_CAPTURE = capture;
    await writeFile(
      executable,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$CASIOPLUS_OPENCLAW_TEST_CAPTURE"\nprintf \'%s\\n\' \'{"runId":"gateway-run-42","messageId":"message-42","channel":"slack"}\'\n',
      'utf8',
    );
    await chmod(executable, 0o700);
    const result = await sendOpenClawGatewayMessage(
      {
        executable,
        url: 'ws://127.0.0.1:18789',
        token: 'gateway-token-that-must-not-appear-in-argv',
        timeoutMs: 5_000,
      },
      { channel: 'slack', target: 'channel:C123', account: 'operations' },
      'Production deployment completed.',
      'openclaw-idempotency-key-42',
    );
    expect(result).toEqual({
      runId: 'gateway-run-42',
      messageId: 'message-42',
      channel: 'slack',
    });
    const argumentsText = await readFile(capture, 'utf8');
    expect(argumentsText).toContain('gateway\ncall\nsend\n');
    expect(argumentsText).toContain('openclaw-idempotency-key-42');
    expect(argumentsText).not.toContain('gateway-token-that-must-not-appear-in-argv');
  });

  it('fails closed when OpenClaw reports a non-sent delivery status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casioplus-openclaw-'));
    cleanup.push(directory);
    const executable = join(directory, 'fake-openclaw');
    await writeFile(
      executable,
      '#!/bin/sh\nprintf \'%s\\n\' \'{"runId":"gateway-run-failed","deliveryStatus":{"status":"failed","succeeded":false,"reason":"channel unavailable"}}\'\n',
      'utf8',
    );
    await chmod(executable, 0o700);
    await expect(
      sendOpenClawGatewayMessage(
        {
          executable,
          url: 'ws://127.0.0.1:18789',
          token: 'gateway-token',
          timeoutMs: 5_000,
        },
        { channel: 'slack', target: 'channel:C123' },
        'This delivery must fail.',
        'openclaw-idempotency-key-failed',
      ),
    ).rejects.toThrow('openclaw_delivery_failed');
  });
});
