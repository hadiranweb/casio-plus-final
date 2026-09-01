import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(root, 'packages/i18n');
const settingsPath = resolve(packageRoot, 'project.inlang/settings.json');
const catalogPaths = {
  en: resolve(packageRoot, 'messages/en.json'),
  fa: resolve(packageRoot, 'messages/fa.json'),
} as const;

type Settings = {
  baseLocale?: string;
  locales?: string[];
  modules?: string[];
  'plugin.inlang.messageFormat'?: { pathPattern?: string };
};

type Catalog = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function messageKeys(catalog: Catalog) {
  return Object.keys(catalog)
    .filter((key) => key !== '$schema')
    .sort();
}

function placeholders(message: string) {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort();
}

const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Settings;
assert(settings.baseLocale === 'en', 'English must remain the i18n base locale');
assert(
  JSON.stringify(settings.locales) === JSON.stringify(['en', 'fa']),
  'Supported locales must be exactly en and fa in canonical order',
);
assert(
  settings['plugin.inlang.messageFormat']?.pathPattern === './messages/{locale}.json',
  'Catalog path pattern must remain canonical',
);
assert((settings.modules?.length ?? 0) > 0, 'At least one inlang module is required');
for (const moduleUrl of settings.modules ?? []) {
  assert(!moduleUrl.includes('@latest/'), `Unpinned inlang module URL: ${moduleUrl}`);
  assert(/@\d+\.\d+\.\d+\//.test(moduleUrl), `Module URL must pin a version: ${moduleUrl}`);
}

const catalogs = Object.fromEntries(
  await Promise.all(
    Object.entries(catalogPaths).map(async ([locale, path]) => [
      locale,
      JSON.parse(await readFile(path, 'utf8')) as Catalog,
    ]),
  ),
) as Record<keyof typeof catalogPaths, Catalog>;

const englishKeys = messageKeys(catalogs.en);
const persianKeys = messageKeys(catalogs.fa);
assert(englishKeys.length > 0, 'English catalog must not be empty');
assert(
  JSON.stringify(englishKeys) === JSON.stringify(persianKeys),
  'English and Persian catalog keys must have exact parity',
);

for (const key of englishKeys) {
  assert(/^[a-z][a-z0-9_]*$/.test(key), `Message key must be flat snake_case: ${key}`);
  const english = catalogs.en[key];
  const persian = catalogs.fa[key];
  assert(
    typeof english === 'string' && english.trim().length > 0,
    `Invalid English message: ${key}`,
  );
  assert(
    typeof persian === 'string' && persian.trim().length > 0,
    `Invalid Persian message: ${key}`,
  );
  assert(
    JSON.stringify(placeholders(english)) === JSON.stringify(placeholders(persian)),
    `Placeholder signature mismatch for ${key}`,
  );
}

const { stdout: tracked } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root });
const trackedGenerated = tracked
  .split('\0')
  .filter((path) => path.startsWith('packages/i18n/src/paraglide/'));
assert(trackedGenerated.length === 0, 'Generated Paraglide output must not be tracked');

console.log(
  JSON.stringify({
    status: 'ok',
    baseLocale: settings.baseLocale,
    locales: settings.locales,
    messageCount: englishKeys.length,
    placeholderParity: true,
    generatedOutputTracked: false,
  }),
);
