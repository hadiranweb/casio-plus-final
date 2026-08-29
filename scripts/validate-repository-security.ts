import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { cwd: root });
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
  }),
);
