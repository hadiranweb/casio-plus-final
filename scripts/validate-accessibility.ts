import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import axe from 'axe-core';
import puppeteer from 'puppeteer-core';

const databaseUrl = process.env.DATABASE_URL ?? '';
if (!databaseUrl) throw new Error('DATABASE_URL is required for accessibility validation');

const coreUrl = 'http://127.0.0.1:8080';
const consoleUrl = 'http://127.0.0.1:4173';
const forgeUrl = 'http://127.0.0.1:4174';
const localeCookieName = 'CASIOPLUS_LOCALE';
const screenshotDirectory = process.env.CASIOPLUS_A11Y_SCREENSHOT_DIR;
const processes: Array<{ name: string; process: ChildProcess; logs: string[] }> = [];

type Locale = 'en' | 'fa';

function start(name: string, command: string, args: string[], env: Record<string, string>) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const logs: string[] = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));
  processes.push({ name, process: child, logs });
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`service did not become ready: ${url}`);
}

async function findChromium() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next CI or local Chromium path.
    }
  }
  throw new Error('Chromium executable was not found');
}

type AuditResult = {
  name: string;
  locale: Locale;
  dir: 'ltr' | 'rtl';
  horizontalOverflow: boolean;
  controlOverlaps: string[];
  violations: Array<{ id: string; impact: string | null | undefined; targets: string[][] }>;
  incomplete: Array<{ id: string; impact: string | null | undefined; targets: string[][] }>;
};

async function main() {
  start('core', 'node', ['services/core-api/dist/index.js'], {
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: 'ci-accessibility-session-secret-at-least-32-chars',
    ALLOW_DEV_TENANT_HEADERS: 'false',
    NODE_ENV: 'development',
    PORT: '8080',
    CORS_ORIGINS: `${consoleUrl},${forgeUrl}`,
  });
  start('console', 'pnpm', ['--filter', '@casioplus/console-web', 'start'], {
    PORT: '4173',
    CASIOPLUS_CORE_API_URL: coreUrl,
    CASIOPLUS_FORGE_URL: forgeUrl,
  });
  start('forge', 'pnpm', ['--filter', '@casioplus/forge-web', 'start'], {
    PORT: '4174',
    CASIOPLUS_CORE_API_URL: coreUrl,
    CASIOPLUS_CONSOLE_URL: consoleUrl,
  });
  await Promise.all([waitFor(`${coreUrl}/healthz`), waitFor(consoleUrl), waitFor(forgeUrl)]);

  const browser = await puppeteer.launch({
    executablePath: await findChromium(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    const results: AuditResult[] = [];

    async function audit(
      name: string,
      url: string,
      width: number,
      height: number,
      locale: Locale,
      loadGraph = false,
    ) {
      await page.setViewport({ width, height });
      await page.setCookie({
        name: localeCookieName,
        value: locale,
        domain: '127.0.0.1',
        path: '/',
      });
      await page.goto(url, { waitUntil: 'networkidle0' });
      const documentState = await page.evaluate(() => {
        const switcher = document.querySelector('.locale-switcher');
        const switcherRect = switcher?.getBoundingClientRect();
        const controlOverlaps = switcherRect
          ? [
              ...document.querySelectorAll(
                '.console-topbar button, .console-topbar a, .forge-topbar button, .forge-topbar a, .mobile-menu, .forge-mobile-menu',
              ),
            ]
              .filter((element) => !switcher?.contains(element))
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;
                return !(
                  rect.right <= switcherRect.left ||
                  rect.left >= switcherRect.right ||
                  rect.bottom <= switcherRect.top ||
                  rect.top >= switcherRect.bottom
                );
              })
              .map((element) => {
                const rect = element.getBoundingClientRect();
                const label =
                  element.className ||
                  element.getAttribute('aria-label') ||
                  element.tagName.toLowerCase();
                return `${label}@${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}|switch=${Math.round(switcherRect.left)},${Math.round(switcherRect.top)},${Math.round(switcherRect.right)},${Math.round(switcherRect.bottom)}`;
              })
          : [];
        return {
          lang: document.documentElement.lang,
          dir: document.documentElement.dir,
          horizontalOverflow:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          controlOverlaps,
        };
      });
      const expectedDirection = locale === 'fa' ? 'rtl' : 'ltr';
      if (documentState.lang !== locale || documentState.dir !== expectedDirection) {
        throw new Error(
          `${name}-${locale} document locale mismatch: ${documentState.lang}/${documentState.dir}`,
        );
      }
      if (documentState.horizontalOverflow) {
        throw new Error(`${name}-${locale} has horizontal document overflow at ${width}x${height}`);
      }
      if (documentState.controlOverlaps.length > 0) {
        throw new Error(
          `${name}-${locale} locale switch overlaps controls: ${documentState.controlOverlaps.join(', ')}`,
        );
      }
      if (loadGraph) {
        await page.evaluate(() => {
          const button = document.querySelector('[data-testid="load-memory-graph"]');
          if (!(button instanceof HTMLButtonElement))
            throw new Error('graph load control is missing');
          button.click();
        });
        await page.waitForSelector('.memory-graph-canvas canvas', { timeout: 15_000 });
      }
      if (screenshotDirectory) {
        await mkdir(screenshotDirectory, { recursive: true });
        await page.screenshot({
          path: `${screenshotDirectory}/${name}-${locale}-${width}x${height}.png`,
          fullPage: true,
        });
      }
      await page.evaluate(axe.source);
      const raw = (await page.evaluate(`
        (async () => {
          const auditResult = await window.axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
            }
          });
          const project = (items) => items.map((item) => ({
            id: item.id,
            impact: item.impact,
            targets: item.nodes.map((node) => node.target.map(String))
          }));
          return {
            violations: project(auditResult.violations),
            incomplete: project(auditResult.incomplete)
          };
        })()
      `)) as Pick<AuditResult, 'violations' | 'incomplete'>;
      results.push({
        name: `${name}-${locale}`,
        locale,
        dir: expectedDirection,
        horizontalOverflow: documentState.horizontalOverflow,
        controlOverlaps: documentState.controlOverlaps,
        ...raw,
      });
    }

    for (const locale of ['en', 'fa'] as const) {
      await audit('console-anonymous', consoleUrl, 1440, 1000, locale);
      await audit('forge-anonymous', forgeUrl, 1440, 1000, locale);
    }

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const registration = await fetch(`${coreUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `accessibility-${suffix}@example.test`,
        password: 'Accessibility-Validation-2026!',
        displayName: 'Accessibility Owner',
        organizationName: 'Accessibility Organization',
        organizationSlug: `accessibility-${suffix}`,
        workspaceName: 'Accessibility Workspace',
        workspaceSlug: 'accessibility-workspace',
      }),
    });
    if (!registration.ok) {
      throw new Error(`registration failed: ${registration.status} ${await registration.text()}`);
    }
    const registrationBody = (await registration.json()) as {
      csrfToken: string;
      context: { actorId: string };
    };
    const setCookie =
      (registration.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (setCookie.length === 0) throw new Error('registration did not issue session cookies');
    const cookieHeader = setCookie.map((header) => header.split(';', 1)[0]).join('; ');

    async function postJson<T>(path: string, body: unknown): Promise<T> {
      const response = await fetch(`${coreUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
          'x-casioplus-csrf': registrationBody.csrfToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
      }
      return (await response.json()) as T;
    }

    const work = await postJson<{ id: string }>('/api/v1/work-items', {
      title: 'Accessibility graph lineage',
      intent: 'Validate the governed graph in browser accessibility checks',
    });
    const flow = await postJson<{ id: string }>('/api/v1/flows', {
      key: `accessibility-flow-${suffix}`,
      name: 'Accessibility graph flow',
    });
    const version = await postJson<{ id: string }>(`/api/v1/flows/${flow.id}/versions`, {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      definition: { name: 'accessibility-graph-v1' },
      runtimeBinding: 'native',
    });
    await postJson(`/api/v1/flows/${flow.id}/versions/${version.id}/publish`, {});
    const run = await postJson<{ run: { id: string } }>('/api/v1/process-runs', {
      workItemId: work.id,
      flowId: flow.id,
      flowVersionId: version.id,
      idempotencyKey: `accessibility-run-${suffix}`,
      input: { business: { name: 'Accessibility validation' } },
    });
    const record = await postJson<{ record: { id: string } }>('/api/v1/semantic-records', {
      workItemId: work.id,
      processRunId: run.run.id,
      type: 'diagnostic_observation',
      title: 'Accessibility graph observation',
      summary: 'A governed record used only to validate the graph user interface.',
      payload: { source: 'accessibility_validation' },
      provenance: {
        sourceType: 'process_run',
        sourceId: run.run.id,
        actorId: registrationBody.context.actorId,
      },
    });
    const claim = await postJson<{ claim: { id: string } }>('/api/v1/knowledge-claims', {
      semanticRecordId: record.record.id,
      processRunId: run.run.id,
      subject: 'Accessible organizational memory',
      claimType: 'verified_fact',
      content: { finding: 'The graph state is available for accessibility validation.' },
      evidence: [record.record.id],
      confidence: 0.95,
    });
    const review = await postJson<{ review: { id: string } }>(
      `/api/v1/knowledge-claims/${claim.claim.id}/review`,
      { decision: 'approve', rationale: 'Approved for deterministic accessibility validation.' },
    );
    await postJson(`/api/v1/knowledge-claims/${claim.claim.id}/promote`, {
      reviewId: review.review.id,
      targetKind: 'verified_fact',
      title: 'Accessible organizational memory',
      content: { finding: 'The graph state is available for accessibility validation.' },
      sensitivity: 'workspace',
      rationale: 'Expose one governed lineage chain to the authenticated test owner.',
    });

    await page.setCookie(
      ...setCookie.map((header) => {
        const pair = header.split(';', 1)[0]!;
        const separator = pair.indexOf('=');
        return {
          name: pair.slice(0, separator),
          value: pair.slice(separator + 1),
          domain: '127.0.0.1',
          path: '/',
        };
      }),
    );

    for (const locale of ['en', 'fa'] as const) {
      await audit('console-authenticated-desktop', consoleUrl, 1440, 1000, locale, true);
      await audit('console-authenticated-mobile', consoleUrl, 390, 844, locale, true);
      await audit('forge-authenticated-desktop', forgeUrl, 1440, 1000, locale);
      await audit('forge-authenticated-mobile', forgeUrl, 390, 844, locale);
    }

    const violations = results.flatMap((result) =>
      result.violations.map((violation) => ({ state: result.name, ...violation })),
    );
    const unresolvedIncomplete = results.flatMap((result) =>
      result.incomplete
        .filter((item) => item.id !== 'color-contrast')
        .map((item) => ({ state: result.name, ...item })),
    );
    console.log(
      JSON.stringify({
        status: violations.length === 0 && unresolvedIncomplete.length === 0 ? 'ok' : 'failed',
        states: results.map((result) => ({
          name: result.name,
          locale: result.locale,
          dir: result.dir,
          horizontalOverflow: result.horizontalOverflow,
          controlOverlaps: result.controlOverlaps,
          violations: result.violations.length,
          incomplete: result.incomplete.length,
        })),
        violations,
        unresolvedIncomplete,
      }),
    );
    if (violations.length > 0 || unresolvedIncomplete.length > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

try {
  await main();
} finally {
  for (const entry of processes.reverse()) {
    if (entry.process.pid) {
      try {
        process.kill(-entry.process.pid, 'SIGTERM');
      } catch {
        entry.process.kill('SIGTERM');
      }
    }
    if (process.exitCode) {
      console.error(`--- ${entry.name} logs ---\n${entry.logs.join('')}`);
    }
  }
}
