import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { stdout } = await execFileAsync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root },
);
const trackedFiles = stdout.split('\0').filter(Boolean);

const violations: string[] = [];
const allowedEnvironmentFiles = new Set(['.env.example']);
const environmentFiles = trackedFiles.filter((path) =>
  path.split('/').some((part) => part === '.env' || part.startsWith('.env.')),
);
for (const path of environmentFiles) {
  if (!allowedEnvironmentFiles.has(path)) {
    violations.push(`Tracked environment file is forbidden: ${path}`);
  }
}

const rustPaths = trackedFiles.filter(
  (path) => extname(path) === '.rs' || path.endsWith('/Cargo.toml') || path === 'Cargo.toml',
);
for (const path of rustPaths) {
  violations.push(`Rust is forbidden in the MVP critical path: ${path}`);
}

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const tokenPattern = /(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/;
const oldSurfacePattern = new RegExp(['stu', 'dio'].join(''), 'i');
const directDatabasePattern =
  /(?:from\s+['"](?:pg|drizzle-orm|postgres|postgres-js)['"]|require\(['"](?:pg|drizzle-orm|postgres|postgres-js)['"]\)|DATABASE_URL)/;

for (const relativePath of trackedFiles) {
  const extension = extname(relativePath);
  if (!textExtensions.has(extension) && !relativePath.endsWith('Dockerfile')) continue;

  let content: string;
  try {
    content = await readFile(resolve(root, relativePath), 'utf8');
  } catch {
    continue;
  }

  if (privateKeyPattern.test(content)) {
    violations.push(`Private key material detected: ${relativePath}`);
  }
  if (tokenPattern.test(content)) {
    violations.push(`Token-like secret detected: ${relativePath}`);
  }
  if (oldSurfacePattern.test(relativePath) || oldSurfacePattern.test(content)) {
    violations.push(`Non-canonical surface name detected: ${relativePath}`);
  }

  const isNonCoreService =
    relativePath.startsWith('services/') && !relativePath.startsWith('services/core-api/');
  if (isNonCoreService && directDatabasePattern.test(content)) {
    violations.push(`Non-Core service references canonical database access: ${relativePath}`);
  }
}

const githubClientPath = 'services/github-app-adapter/src/github-client.ts';
const githubServerPath = 'services/github-app-adapter/src/server.ts';
if (trackedFiles.includes(githubClientPath) || trackedFiles.includes(githubServerPath)) {
  const githubClient = await readFile(resolve(root, githubClientPath), 'utf8');
  const githubServer = await readFile(resolve(root, githubServerPath), 'utf8');
  const sharedContracts = await readFile(resolve(root, 'packages/contracts/src/index.ts'), 'utf8');
  if (/\/pulls\/[^'"`]+\/merge|\/merges(?:[?'"`/]|$)/.test(githubClient)) {
    violations.push('GitHub App adapter must not contain a merge endpoint');
  }
  for (const required of [
    "repositoryFullName: z.literal('hadiranweb/casio-plus-final')",
    "catalogPath: z.literal('packages/i18n/messages/fa.json')",
  ]) {
    if (!sharedContracts.includes(required)) {
      violations.push(`GitHub App shared scope guard missing: ${required}`);
    }
  }
  const permissionGuards = [
    {
      name: 'translation PR write permissions',
      pattern:
        /metadata:\s*'read'[\s\S]{0,120}contents:\s*'write'[\s\S]{0,120}pull_requests:\s*'write'/,
    },
    {
      name: 'catalog snapshot read-only permission',
      pattern: /metadata:\s*'read'[\s\S]{0,120}contents:\s*'read'/,
    },
  ];
  for (const guard of permissionGuards) {
    if (!guard.pattern.test(githubClient)) {
      violations.push(`GitHub App adapter scope guard missing: ${guard.name}`);
    }
  }
  if (!githubClient.includes('maintainer_can_modify: false')) {
    violations.push('GitHub App adapter scope guard missing: maintainer_can_modify: false');
  }
  const webhookSignatureCheck = githubServer.indexOf('const expected = `sha256=${createHmac');
  const webhookParse = githubServer.indexOf('pullRequestWebhookSchema.parse(parseJson(rawBody))');
  if (webhookSignatureCheck < 0 || webhookParse < 0 || webhookSignatureCheck > webhookParse) {
    violations.push('GitHub webhook raw-body signature must be verified before JSON parsing');
  }
}

if (violations.length > 0) {
  throw new Error(`Repository security validation failed:\n${violations.join('\n')}`);
}

console.log(
  JSON.stringify({
    status: 'ok',
    trackedFiles: trackedFiles.length,
    environmentFiles,
    rustPaths: rustPaths.length,
    nonCoreDatabaseViolations: 0,
    secretViolations: 0,
    surfaceNamingViolations: 0,
    githubAppMergeEndpoints: 0,
    githubAppScopeViolations: 0,
  }),
);
