import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const requiredDirectories = [
  'apps/console-web',
  'apps/console-web/app',
  'apps/console-web/app/routes',
  'apps/forge-web',
  'apps/forge-web/app',
  'apps/forge-web/app/routes',
  'services/core-api',
  'services/integration-dispatcher',
  'services/n8n-adapter',
  'services/open-webui-adapter',
  'services/openclaw-adapter',
  'services/github-app-adapter',
  'services/native-diagnosis-worker',
  'packages/contracts',
  'packages/domain',
  'packages/knowledge-model',
  'packages/i18n',
  'packages/ui',
  'migrations',
  'runtime/n8n/workflows',
  'runtime/open-webui',
  'runtime/openclaw',
  'deployment',
  'docs',
];

for (const directory of requiredDirectories) {
  await access(resolve(root, directory));
}

for (const path of [
  'apps/console-web/src',
  'apps/console-web/index.html',
  'apps/forge-web/src',
  'apps/forge-web/index.html',
]) {
  if (await pathExists(resolve(root, path))) {
    throw new Error(`Standalone UI path must not exist: ${path}`);
  }
}

const entries = await readdir(root);
const forbiddenRootEntries = entries.filter((entry) =>
  ['gateway', 'target', 'web', 'dist'].includes(entry),
);
if (forbiddenRootEntries.length > 0) {
  throw new Error(`Unexpected MVP root entries: ${forbiddenRootEntries.join(', ')}`);
}

const { stdout: trackedFiles } = await execFileAsync('git', ['ls-files', '-z'], {
  cwd: root,
});
const generatedTrackedPaths = trackedFiles
  .split('\0')
  .filter(
    (file) =>
      /(^|\/)(node_modules|dist|build)(\/|$)/.test(file) ||
      /^packages\/i18n\/src\/paraglide\//.test(file),
  );
if (generatedTrackedPaths.length > 0) {
  throw new Error(`Generated paths must stay outside Git: ${generatedTrackedPaths.join(', ')}`);
}

const workspacePackages = [
  'apps/console-web/package.json',
  'apps/forge-web/package.json',
  'packages/contracts/package.json',
  'packages/domain/package.json',
  'packages/knowledge-model/package.json',
  'packages/i18n/package.json',
  'packages/ui/package.json',
  'services/core-api/package.json',
  'services/integration-dispatcher/package.json',
  'services/native-diagnosis-worker/package.json',
  'services/n8n-adapter/package.json',
  'services/open-webui-adapter/package.json',
  'services/openclaw-adapter/package.json',
  'services/github-app-adapter/package.json',
];

type Manifest = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const manifests = new Map<string, { relativePath: string; manifest: Manifest }>();
for (const relativePath of workspacePackages) {
  const manifest = JSON.parse(await readFile(resolve(root, relativePath), 'utf8')) as Manifest;
  if (!manifest.name) throw new Error(`Workspace package has no name: ${relativePath}`);
  manifests.set(manifest.name, { relativePath, manifest });
}

const allowedInternalDependencies: Record<string, string[]> = {
  '@casioplus/console-web': ['@casioplus/contracts', '@casioplus/i18n', '@casioplus/ui'],
  '@casioplus/forge-web': ['@casioplus/contracts', '@casioplus/i18n', '@casioplus/ui'],
  '@casioplus/contracts': [],
  '@casioplus/domain': [],
  '@casioplus/knowledge-model': ['@casioplus/domain'],
  '@casioplus/i18n': [],
  '@casioplus/ui': [],
  '@casioplus/core-api': [
    '@casioplus/contracts',
    '@casioplus/domain',
    '@casioplus/knowledge-model',
  ],
  '@casioplus/native-diagnosis-worker': ['@casioplus/contracts'],
  '@casioplus/integration-dispatcher': [],
  '@casioplus/n8n-adapter': [],
  '@casioplus/open-webui-adapter': [],
  '@casioplus/openclaw-adapter': ['@casioplus/contracts'],
  '@casioplus/github-app-adapter': ['@casioplus/contracts'],
};

const sharedUiEntrypoint = 'packages/ui/src/index.tsx';
await access(resolve(root, sharedUiEntrypoint));
const sharedUiSource = await readFile(resolve(root, sharedUiEntrypoint), 'utf8');
const forbiddenSharedUiModules = [
  'pg',
  'express',
  'ioredis',
  '@casioplus/core-api',
  '@casioplus/domain',
  '@casioplus/knowledge-model',
];
for (const moduleName of forbiddenSharedUiModules) {
  if (
    sharedUiSource.includes(`from '${moduleName}'`) ||
    sharedUiSource.includes(`from \"${moduleName}\"`)
  ) {
    throw new Error(
      `Shared UI must remain presentation-only; forbidden import found: ${moduleName}`,
    );
  }
}

for (const [packageName, { relativePath, manifest }] of manifests) {
  const internalDependencies = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter((dependency) => dependency.startsWith('@casioplus/'));
  const allowed = new Set(allowedInternalDependencies[packageName] ?? []);
  const violations = internalDependencies.filter((dependency) => !allowed.has(dependency));
  if (violations.length > 0) {
    throw new Error(
      `Forbidden internal dependency direction for ${packageName}: ${violations.join(', ')}`,
    );
  }
}

const remixSurfaceNames = ['@casioplus/console-web', '@casioplus/forge-web'];
for (const packageName of remixSurfaceNames) {
  const entry = manifests.get(packageName);
  if (!entry) throw new Error(`Missing Remix surface package: ${packageName}`);
  const { relativePath, manifest } = entry;
  const scripts = manifest.scripts ?? {};
  for (const scriptName of ['dev', 'build', 'start']) {
    if (!scripts[scriptName]?.includes(scriptName === 'start' ? 'remix-serve' : 'remix')) {
      throw new Error(`Remix script missing for ${packageName}: ${scriptName}`);
    }
  }
  const allDependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  for (const dependency of [
    '@remix-run/node',
    '@remix-run/react',
    '@remix-run/serve',
    '@remix-run/dev',
  ]) {
    if (!allDependencies[dependency]) {
      throw new Error(`Remix dependency missing for ${packageName}: ${dependency}`);
    }
  }
  const forbiddenStandaloneDependencies = ['@vitejs/plugin-react', 'wouter'];
  const foundForbiddenDependencies = forbiddenStandaloneDependencies.filter(
    (dependency) => allDependencies[dependency],
  );
  if (foundForbiddenDependencies.length > 0) {
    throw new Error(
      `Standalone UI dependency found for ${packageName}: ${foundForbiddenDependencies.join(', ')}`,
    );
  }
  const viteConfig = await readFile(
    resolve(root, relativePath.replace('package.json', 'vite.config.ts')),
    'utf8',
  );
  if (!viteConfig.includes('@remix-run/dev') || !viteConfig.includes('vitePlugin as remix')) {
    throw new Error(`UI compiler is not Remix Vite plugin for ${packageName}`);
  }
}

for (const dockerfile of ['deployment/Dockerfile.console', 'deployment/Dockerfile.forge']) {
  const content = await readFile(resolve(root, dockerfile), 'utf8');
  if (!content.includes('remix-serve') || !content.includes('build/server/index.js')) {
    throw new Error(`Remix server contract missing from ${dockerfile}`);
  }
  if (content.includes('static-server') || content.includes('/dist')) {
    throw new Error(`Static frontend deployment contract found in ${dockerfile}`);
  }
}

const runtimeAdapterDockerfiles: Record<string, string[]> = {
  'deployment/Dockerfile.n8n-adapter': [
    '@casioplus/n8n-adapter build',
    '@casioplus/n8n-adapter deploy',
  ],
  'deployment/Dockerfile.open-webui-adapter': [
    '@casioplus/open-webui-adapter build',
    '@casioplus/open-webui-adapter deploy',
  ],
  'deployment/Dockerfile.openclaw-adapter': [
    '@casioplus/openclaw-adapter build',
    '@casioplus/openclaw-adapter deploy',
    'openclaw@2026.7.1-2',
  ],
  'deployment/Dockerfile.github-app-adapter': [
    '@casioplus/github-app-adapter build',
    '@casioplus/github-app-adapter deploy',
  ],
};
for (const [dockerfile, requiredFragments] of Object.entries(runtimeAdapterDockerfiles)) {
  const content = await readFile(resolve(root, dockerfile), 'utf8');
  for (const requiredFragment of [...requiredFragments, 'USER node', 'dist/server.js']) {
    if (!content.includes(requiredFragment)) {
      throw new Error(`${dockerfile} runtime contract missing: ${requiredFragment}`);
    }
  }
}

const runtimeComposeContracts: Record<string, string[]> = {
  'runtime/open-webui/docker-compose.yml': [
    'ghcr.io/open-webui/open-webui:v0.11.1',
    'internal: true',
    'OPEN_WEBUI_API_KEY',
  ],
  'runtime/openclaw/docker-compose.yml': [
    'ghcr.io/openclaw/openclaw:2026.7.1-2',
    'internal: true',
    'OPENCLAW_GATEWAY_TOKEN',
  ],
};
for (const [composePath, requiredFragments] of Object.entries(runtimeComposeContracts)) {
  const content = await readFile(resolve(root, composePath), 'utf8');
  for (const requiredFragment of requiredFragments) {
    if (!content.includes(requiredFragment)) {
      throw new Error(`${composePath} contract missing: ${requiredFragment}`);
    }
  }
  for (const forbiddenFragment of [
    'DATABASE_URL',
    '\n    ports:',
    ':latest',
    ':main\n',
    ':dev\n',
  ]) {
    if (content.includes(forbiddenFragment)) {
      throw new Error(`${composePath} contains forbidden runtime contract: ${forbiddenFragment}`);
    }
  }
}

for (const path of [
  'apps/console-web/app/root.tsx',
  'apps/console-web/app/routes/_index.tsx',
  'apps/console-web/app/entry.client.tsx',
  'apps/console-web/app/entry.server.tsx',
  'apps/console-web/remix.env.d.ts',
  'apps/forge-web/app/root.tsx',
  'apps/forge-web/app/routes/_index.tsx',
  'apps/forge-web/app/entry.client.tsx',
  'apps/forge-web/app/entry.server.tsx',
  'apps/forge-web/remix.env.d.ts',
]) {
  await access(resolve(root, path));
}

console.log(
  JSON.stringify({
    status: 'ok',
    root,
    requiredDirectories,
    checkedWorkspacePackages: manifests.size,
    checkedRemixSurfaces: remixSurfaceNames,
    checkedRemixDockerfiles: ['deployment/Dockerfile.console', 'deployment/Dockerfile.forge'],
    checkedRuntimeDockerfiles: Object.keys(runtimeAdapterDockerfiles),
    checkedRuntimeComposeContracts: Object.keys(runtimeComposeContracts),
    forbiddenStandaloneUiPaths: [
      'apps/console-web/src',
      'apps/console-web/index.html',
      'apps/forge-web/src',
      'apps/forge-web/index.html',
    ],
    generatedTrackedPaths: 0,
  }),
);
