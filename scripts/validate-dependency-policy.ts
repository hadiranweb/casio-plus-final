import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');

type Waiver = {
  id: string;
  severity: 'moderate';
  expiresOn: string;
  owner: string;
  justification: string;
};

type Advisory = {
  github_advisory_id?: string;
  module_name: string;
  severity: string;
  title: string;
};

const policy = JSON.parse(
  await readFile(resolve(root, 'security/advisory-waivers.json'), 'utf8'),
) as { schemaVersion: number; waivers: Waiver[] };

if (policy.schemaVersion !== 1) {
  throw new Error(`Unsupported advisory waiver schema: ${policy.schemaVersion}`);
}

const waiverById = new Map(policy.waivers.map((waiver) => [waiver.id, waiver]));
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

let auditOutput = '';
try {
  const { stdout } = await execFileAsync('pnpm', ['audit', '--prod', '--json'], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  auditOutput = stdout;
} catch (error) {
  const auditError = error as { stdout?: string };
  auditOutput = auditError.stdout ?? '';
}

if (!auditOutput) {
  throw new Error('Dependency audit returned no machine-readable output.');
}

const audit = JSON.parse(auditOutput) as { advisories?: Record<string, Advisory> };
const advisories = Object.values(audit.advisories ?? {});
const violations: string[] = [];
const activeIds = new Set<string>();

for (const advisory of advisories) {
  const id = advisory.github_advisory_id;
  if (!id) {
    violations.push(`Advisory without a GitHub identifier: ${advisory.module_name}`);
    continue;
  }
  activeIds.add(id);

  if (advisory.severity === 'critical' || advisory.severity === 'high') {
    violations.push(`${id} (${advisory.severity}) must be patched: ${advisory.title}`);
    continue;
  }

  if (advisory.severity === 'moderate') {
    const waiver = waiverById.get(id);
    if (!waiver) {
      violations.push(`${id} (moderate) has no approved waiver.`);
      continue;
    }
    const expiresOn = new Date(`${waiver.expiresOn}T00:00:00Z`);
    if (Number.isNaN(expiresOn.valueOf()) || expiresOn < today) {
      violations.push(`${id} waiver expired on ${waiver.expiresOn}.`);
    }
    if (!waiver.owner.trim() || !waiver.justification.trim()) {
      violations.push(`${id} waiver lacks owner or justification.`);
    }
  }
}

for (const waiver of policy.waivers) {
  if (!activeIds.has(waiver.id)) {
    violations.push(
      `Stale waiver must be removed because the advisory is no longer active: ${waiver.id}`,
    );
  }
}

if (violations.length > 0) {
  throw new Error(`Dependency policy validation failed:\n${violations.join('\n')}`);
}

console.log(
  JSON.stringify({
    status: 'ok',
    activeAdvisories: advisories.length,
    waivedModerateAdvisories: advisories.filter((item) => item.severity === 'moderate').length,
    highOrCriticalAdvisories: advisories.filter(
      (item) => item.severity === 'high' || item.severity === 'critical',
    ).length,
  }),
);
