import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const localeCookieName = 'CASIOPLUS_LOCALE';
const processes: Array<{ name: string; process: ChildProcess; logs: string[] }> = [];

type Surface = {
  name: 'console' | 'forge';
  url: string;
  packageName: '@casioplus/console-web' | '@casioplus/forge-web';
  headlineSelector: string;
  englishHeadline: string;
  persianHeadline: string;
  env: Record<string, string>;
};

const surfaces: Surface[] = [
  {
    name: 'console',
    url: 'http://127.0.0.1:4173',
    packageName: '@casioplus/console-web',
    headlineSelector: '.auth-story h1',
    englishHeadline: 'Decision, execution, and memory in an auditable path.',
    persianHeadline: 'تصمیم، اجرا و حافظه در یک مسیر قابل ممیزی.',
    env: {
      PORT: '4173',
      CASIOPLUS_CORE_API_URL: 'http://127.0.0.1:8080',
      CASIOPLUS_FORGE_URL: 'http://127.0.0.1:4174',
    },
  },
  {
    name: 'forge',
    url: 'http://127.0.0.1:4174',
    packageName: '@casioplus/forge-web',
    headlineSelector: '.forge-auth h1',
    englishHeadline: 'Flows are created only in a valid organizational session.',
    persianHeadline: 'Flowها فقط در یک session سازمانی معتبر ساخته می‌شوند.',
    env: {
      PORT: '4174',
      CASIOPLUS_CORE_API_URL: 'http://127.0.0.1:8080',
      CASIOPLUS_CONSOLE_URL: 'http://127.0.0.1:4173',
    },
  },
];

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

async function fetchDocument(surface: Surface, locale?: 'en' | 'fa') {
  const response = await fetch(surface.url, {
    headers: locale ? { cookie: `${localeCookieName}=${locale}` } : undefined,
  });
  assert(response.ok, `${surface.name} SSR request failed with ${response.status}`);
  return response.text();
}

async function validateSsrIsolation(surface: Surface) {
  const defaultHtml = await fetchDocument(surface);
  assert(
    defaultHtml.includes(documentMarker('en')),
    `${surface.name} default SSR locale is not English/LTR`,
  );

  const requestLocales = Array.from({ length: 80 }, (_, index) =>
    index % 2 === 0 ? ('en' as const) : ('fa' as const),
  );
  const results = await Promise.all(
    requestLocales.map(async (locale) => ({ locale, html: await fetchDocument(surface, locale) })),
  );

  for (const result of results) {
    assert(
      result.html.includes(documentMarker(result.locale)),
      `${surface.name} SSR locale mismatch for concurrent ${result.locale} request`,
    );
    const otherLocale = result.locale === 'en' ? 'fa' : 'en';
    assert(
      !result.html.includes(documentMarker(otherLocale)),
      `${surface.name} SSR locale leaked from ${otherLocale} into ${result.locale}`,
    );
  }

  return { surface: surface.name, defaultLocale: 'en', concurrentRequests: results.length };
}

async function documentState(page: import('puppeteer-core').Page, surface: Surface) {
  return page.evaluate((headlineSelector) => {
    return {
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      locale: document.documentElement.dataset.locale,
      labels: [...document.querySelectorAll('.locale-switcher button')].map((button) =>
        button.textContent?.trim(),
      ),
      headline: document.querySelector(headlineSelector)?.textContent?.trim(),
    };
  }, surface.headlineSelector);
}

async function clickLocale(page: import('puppeteer-core').Page, label: string) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.evaluate((expectedLabel) => {
      const button = [...document.querySelectorAll('.locale-switcher button')].find(
        (candidate) => candidate.textContent?.trim() === expectedLabel,
      );
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error(`${expectedLabel} switch is missing`);
      }
      button.click();
    }, label),
  ]);
}

async function validateBrowserSwitch(surface: Surface) {
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

    await page.goto(surface.url, { waitUntil: 'networkidle0' });
    await page.waitForSelector(surface.headlineSelector);
    const defaultDocument = await documentState(page, surface);
    assert(defaultDocument.lang === 'en', `${surface.name} hydrated default lang is not en`);
    assert(defaultDocument.dir === 'ltr', `${surface.name} hydrated default dir is not ltr`);
    assert(defaultDocument.locale === 'en', `${surface.name} hydrated data-locale is not en`);
    assert(defaultDocument.labels.includes('Persian'), `${surface.name} Persian switch is missing`);
    assert(
      defaultDocument.headline === surface.englishHeadline,
      `${surface.name} English copy was not rendered`,
    );

    await clickLocale(page, 'Persian');
    const persianDocument = await documentState(page, surface);
    assert(persianDocument.lang === 'fa', `${surface.name} switched lang is not fa`);
    assert(persianDocument.dir === 'rtl', `${surface.name} switched dir is not rtl`);
    assert(persianDocument.locale === 'fa', `${surface.name} switched data-locale is not fa`);
    assert(persianDocument.labels.includes('انگلیسی'), `${surface.name} English switch is missing`);
    assert(
      persianDocument.headline === surface.persianHeadline,
      `${surface.name} Persian copy was not rendered`,
    );

    const persianCookie = (await page.cookies()).find((cookie) => cookie.name === localeCookieName);
    assert(persianCookie?.value === 'fa', `${surface.name} Persian cookie was not persisted`);
    await page.reload({ waitUntil: 'networkidle0' });
    assert(
      (await page.evaluate(() => document.documentElement.lang)) === 'fa',
      `${surface.name} Persian locale did not survive a full reload`,
    );

    await clickLocale(page, 'انگلیسی');
    const englishDocument = await documentState(page, surface);
    assert(englishDocument.lang === 'en', `${surface.name} return switch lang is not en`);
    assert(englishDocument.dir === 'ltr', `${surface.name} return switch dir is not ltr`);
    assert(englishDocument.locale === 'en', `${surface.name} return data-locale is not en`);
    assert(
      englishDocument.headline === surface.englishHeadline,
      `${surface.name} English copy was not restored`,
    );

    const englishCookie = (await page.cookies()).find((cookie) => cookie.name === localeCookieName);
    assert(englishCookie?.value === 'en', `${surface.name} English cookie was not persisted`);
    assert(
      hydrationErrors.length === 0,
      `${surface.name} hydration errors: ${hydrationErrors.join(' | ')}`,
    );

    return { surface: surface.name, fullReloadSwitches: 2, hydrationErrors: 0 };
  } finally {
    await browser.close();
  }
}

async function main() {
  for (const surface of surfaces) {
    start(surface.name, 'pnpm', ['--filter', surface.packageName, 'start'], surface.env);
  }
  await Promise.all(surfaces.map((surface) => waitFor(surface.url)));

  const [ssr, browser] = await Promise.all([
    Promise.all(surfaces.map(validateSsrIsolation)),
    Promise.all(surfaces.map(validateBrowserSwitch)),
  ]);
  console.log(
    JSON.stringify({
      status: 'ok',
      cookie: localeCookieName,
      ssr,
      browser,
      totals: {
        concurrentRequests: ssr.reduce((total, result) => total + result.concurrentRequests, 0),
        fullReloadSwitches: browser.reduce((total, result) => total + result.fullReloadSwitches, 0),
      },
    }),
  );
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
