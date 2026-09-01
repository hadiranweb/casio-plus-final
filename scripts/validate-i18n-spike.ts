import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const consoleUrl = 'http://127.0.0.1:4173';
const localeCookieName = 'CASIOPLUS_LOCALE';
const processes: Array<{ name: string; process: ChildProcess; logs: string[] }> = [];

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
      // The production server is still starting.
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function documentMarker(locale: 'en' | 'fa') {
  return locale === 'en'
    ? '<html lang="en" dir="ltr" data-locale="en">'
    : '<html lang="fa" dir="rtl" data-locale="fa">';
}

async function fetchDocument(locale?: 'en' | 'fa') {
  const response = await fetch(consoleUrl, {
    headers: locale ? { cookie: `${localeCookieName}=${locale}` } : undefined,
  });
  assert(response.ok, `SSR request failed with ${response.status}`);
  return response.text();
}

async function validateSsrIsolation() {
  const defaultHtml = await fetchDocument();
  assert(defaultHtml.includes(documentMarker('en')), 'default SSR locale is not English/LTR');

  const requestLocales = Array.from({ length: 80 }, (_, index) =>
    index % 2 === 0 ? ('en' as const) : ('fa' as const),
  );
  const results = await Promise.all(
    requestLocales.map(async (locale) => ({ locale, html: await fetchDocument(locale) })),
  );

  for (const result of results) {
    assert(
      result.html.includes(documentMarker(result.locale)),
      `SSR locale mismatch for concurrent ${result.locale} request`,
    );
    const otherLocale = result.locale === 'en' ? 'fa' : 'en';
    assert(
      !result.html.includes(documentMarker(otherLocale)),
      `SSR locale leaked from ${otherLocale} into ${result.locale}`,
    );
  }

  return { defaultLocale: 'en', concurrentRequests: results.length };
}

async function validateBrowserSwitch() {
  const browser = await puppeteer.launch({
    executablePath: await findChromium(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const hydrationErrors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => hydrationErrors.push(String(error)));
    page.on('console', (entry) => {
      const text = entry.text();
      if (/hydration failed|did not match|hydrating/i.test(text)) hydrationErrors.push(text);
    });

    await page.goto(consoleUrl, { waitUntil: 'networkidle0' });
    const defaultDocument = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      locale: document.documentElement.dataset.locale,
      labels: [...document.querySelectorAll('.locale-switcher button')].map((button) =>
        button.textContent?.trim(),
      ),
    }));
    assert(defaultDocument.lang === 'en', 'hydrated default lang is not en');
    assert(defaultDocument.dir === 'ltr', 'hydrated default dir is not ltr');
    assert(defaultDocument.locale === 'en', 'hydrated default data-locale is not en');
    assert(defaultDocument.labels.includes('Persian'), 'English switch label is missing');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.evaluate(() => {
        const button = [...document.querySelectorAll('.locale-switcher button')].find(
          (candidate) => candidate.textContent?.trim() === 'Persian',
        );
        if (!(button instanceof HTMLButtonElement)) throw new Error('Persian switch is missing');
        button.click();
      }),
    ]);

    const persianDocument = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      locale: document.documentElement.dataset.locale,
      labels: [...document.querySelectorAll('.locale-switcher button')].map((button) =>
        button.textContent?.trim(),
      ),
    }));
    assert(persianDocument.lang === 'fa', 'switched lang is not fa');
    assert(persianDocument.dir === 'rtl', 'switched dir is not rtl');
    assert(persianDocument.locale === 'fa', 'switched data-locale is not fa');
    assert(persianDocument.labels.includes('انگلیسی'), 'Persian switch label is missing');

    const persianCookie = (await page.cookies()).find((cookie) => cookie.name === localeCookieName);
    assert(persianCookie?.value === 'fa', 'Persian locale cookie was not persisted');

    await page.reload({ waitUntil: 'networkidle0' });
    assert(
      (await page.evaluate(() => document.documentElement.lang)) === 'fa',
      'Persian locale did not survive a full reload',
    );

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.evaluate(() => {
        const button = [...document.querySelectorAll('.locale-switcher button')].find(
          (candidate) => candidate.textContent?.trim() === 'انگلیسی',
        );
        if (!(button instanceof HTMLButtonElement)) throw new Error('English switch is missing');
        button.click();
      }),
    ]);

    const englishDocument = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      locale: document.documentElement.dataset.locale,
    }));
    assert(englishDocument.lang === 'en', 'return switch lang is not en');
    assert(englishDocument.dir === 'ltr', 'return switch dir is not ltr');
    assert(englishDocument.locale === 'en', 'return switch data-locale is not en');

    const englishCookie = (await page.cookies()).find((cookie) => cookie.name === localeCookieName);
    assert(englishCookie?.value === 'en', 'English locale cookie was not persisted');
    assert(hydrationErrors.length === 0, `hydration errors: ${hydrationErrors.join(' | ')}`);

    return { cookie: localeCookieName, fullReloadSwitches: 2, hydrationErrors: 0 };
  } finally {
    await browser.close();
  }
}

async function main() {
  start('console', 'pnpm', ['--filter', '@casioplus/console-web', 'start'], {
    PORT: '4173',
    CASIOPLUS_CORE_API_URL: 'http://127.0.0.1:8080',
    CASIOPLUS_FORGE_URL: 'http://127.0.0.1:4174',
  });
  await waitFor(consoleUrl);

  const [ssr, browser] = await Promise.all([validateSsrIsolation(), validateBrowserSwitch()]);
  console.log(JSON.stringify({ status: 'ok', ssr, browser }));
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
    if (process.exitCode) console.error(`--- ${entry.name} logs ---\n${entry.logs.join('')}`);
  }
}
