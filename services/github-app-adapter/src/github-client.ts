import { createHash, createSign } from 'node:crypto';
import {
  repositoryOpenTranslationPrPayloadSchema,
  translationCatalogSnapshotSchema,
} from '@casioplus/contracts';
import { z } from 'zod';

const installationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().datetime(),
  permissions: z.record(z.string(), z.string()).optional(),
  repositories: z
    .array(z.object({ full_name: z.string(), private: z.boolean().optional() }).passthrough())
    .optional(),
});
const referenceSchema = z.object({ object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) });
const contentFileSchema = z.object({
  type: z.literal('file'),
  encoding: z.literal('base64'),
  content: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
});
const updateContentSchema = z.object({
  commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }),
});
const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  state: z.enum(['open', 'closed']),
  merged_at: z.string().datetime().nullable().optional(),
  html_url: z.string().url(),
  head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/), ref: z.string() }),
  base: z.object({ ref: z.string() }),
});

type TranslationPayload = z.infer<typeof repositoryOpenTranslationPrPayloadSchema>;

export type GitHubAppConfiguration = {
  apiBaseUrl: string;
  appId: string;
  installationId: string;
  privateKey: string;
  requestTimeoutMs: number;
};

export type PullRequestResult = {
  changeSetId: string;
  repositoryFullName: 'hadiranweb/casio-plus-final';
  branchRef: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestHeadSha: string;
};

export class GitHubAppError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'GitHubAppError';
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function appJwt(configuration: GitHubAppConfiguration): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ iat: now - 30, exp: now + 540, iss: configuration.appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(configuration.privateKey.replaceAll('\\n', '\n'));
  return `${signingInput}.${base64Url(signature)}`;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GitHubAppError('github_response_invalid', 502, true);
  }
}

async function githubRequest(
  configuration: GitHubAppConfiguration,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: unknown }> {
  try {
    const response = await fetch(`${configuration.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'casioplus-github-app-adapter',
        'x-github-api-version': '2026-03-10',
        ...init.headers,
      },
      signal: AbortSignal.timeout(configuration.requestTimeoutMs),
    });
    const body = await responseJson(response);
    return { response, body };
  } catch (caught) {
    if (caught instanceof GitHubAppError) throw caught;
    throw new GitHubAppError('github_request_failed', 502, true);
  }
}

async function installationToken(
  configuration: GitHubAppConfiguration,
  access: 'read' | 'write',
): Promise<string> {
  const { response, body } = await githubRequest(
    configuration,
    appJwt(configuration),
    `/app/installations/${encodeURIComponent(configuration.installationId)}/access_tokens`,
    {
      method: 'POST',
      body: JSON.stringify({
        repositories: ['casio-plus-final'],
        permissions:
          access === 'write'
            ? { metadata: 'read', contents: 'write', pull_requests: 'write' }
            : { metadata: 'read', contents: 'read' },
      }),
    },
  );
  if (!response.ok) {
    throw new GitHubAppError(
      'github_installation_token_failed',
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  const parsed = installationTokenSchema.parse(body);
  if (
    parsed.permissions &&
    (access === 'write'
      ? parsed.permissions.contents !== 'write' || parsed.permissions.pull_requests !== 'write'
      : !['read', 'write'].includes(parsed.permissions.contents ?? ''))
  ) {
    throw new GitHubAppError('github_app_permissions_insufficient', 403, false);
  }
  if (
    parsed.repositories &&
    !parsed.repositories.some(
      (repository) => repository.full_name === 'hadiranweb/casio-plus-final',
    )
  ) {
    throw new GitHubAppError('github_repository_not_installed', 403, false);
  }
  return parsed.token;
}

function textHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1]!)
    .filter((placeholder, index, values) => values.indexOf(placeholder) === index)
    .sort();
}

function equalStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function parseCatalog(raw: string): Record<string, string> {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubAppError('github_catalog_invalid', 409, false);
  }
  const catalog: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') throw new GitHubAppError('github_catalog_invalid', 409, false);
    catalog[key] = entry;
  }
  return catalog;
}

function serializeCatalog(catalog: Record<string, string>): string {
  const ordered = Object.fromEntries(
    Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

async function getReference(
  configuration: GitHubAppConfiguration,
  token: string,
  ref: string,
): Promise<string> {
  const { response, body } = await githubRequest(
    configuration,
    token,
    `/repos/hadiranweb/casio-plus-final/git/ref/heads/${encodeURIComponent(ref)}`,
  );
  if (!response.ok) {
    throw new GitHubAppError(
      'github_reference_read_failed',
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  return referenceSchema.parse(body).object.sha;
}

async function getCatalogFile(
  configuration: GitHubAppConfiguration,
  token: string,
  path: string,
  ref: string,
) {
  const { response, body } = await githubRequest(
    configuration,
    token,
    `/repos/hadiranweb/casio-plus-final/contents/${path}?ref=${encodeURIComponent(ref)}`,
  );
  if (!response.ok) {
    throw new GitHubAppError(
      'github_catalog_read_failed',
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  const parsed = contentFileSchema.parse(body);
  const raw = Buffer.from(parsed.content.replaceAll('\n', ''), 'base64').toString('utf8');
  return { raw, sha: parsed.sha, catalog: parseCatalog(raw) };
}

async function findPullRequest(
  configuration: GitHubAppConfiguration,
  token: string,
  payload: TranslationPayload,
) {
  const query = new URLSearchParams({
    state: 'all',
    head: `hadiranweb:${payload.branchRef}`,
    base: payload.baseRef,
    per_page: '10',
  });
  const { response, body } = await githubRequest(
    configuration,
    token,
    `/repos/hadiranweb/casio-plus-final/pulls?${query.toString()}`,
  );
  if (!response.ok) {
    throw new GitHubAppError(
      'github_pull_request_lookup_failed',
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
  const pulls = z.array(pullRequestSchema).parse(body);
  return pulls[0];
}

function resultFromPullRequest(
  payload: TranslationPayload,
  pullRequest: z.infer<typeof pullRequestSchema>,
): PullRequestResult {
  if (pullRequest.head.ref !== payload.branchRef || pullRequest.base.ref !== payload.baseRef) {
    throw new GitHubAppError('github_pull_request_scope_mismatch', 409, false);
  }
  if (pullRequest.state === 'closed' && !pullRequest.merged_at) {
    throw new GitHubAppError('github_pull_request_closed', 409, false);
  }
  return {
    changeSetId: payload.changeSetId,
    repositoryFullName: payload.repositoryFullName,
    branchRef: payload.branchRef,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.html_url,
    pullRequestHeadSha: pullRequest.head.sha,
  };
}

export async function readTranslationCatalogSnapshot(configuration: GitHubAppConfiguration) {
  const token = await installationToken(configuration, 'read');
  const baseCommitSha = await getReference(configuration, token, 'main');
  const [sourceFile, targetFile] = await Promise.all([
    getCatalogFile(configuration, token, 'packages/i18n/messages/en.json', baseCommitSha),
    getCatalogFile(configuration, token, 'packages/i18n/messages/fa.json', baseCommitSha),
  ]);
  return translationCatalogSnapshotSchema.parse({
    repositoryFullName: 'hadiranweb/casio-plus-final',
    baseRef: 'main',
    baseCommitSha,
    catalogHash: textHash(targetFile.raw),
    sourceLocale: 'en',
    targetLocale: 'fa',
    sourceCatalog: sourceFile.catalog,
    targetCatalog: targetFile.catalog,
  });
}

export async function openTranslationPullRequest(
  configuration: GitHubAppConfiguration,
  rawPayload: unknown,
): Promise<PullRequestResult> {
  const payload = repositoryOpenTranslationPrPayloadSchema.parse(rawPayload);
  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    throw new GitHubAppError('github_translation_approval_expired', 409, false);
  }
  const token = await installationToken(configuration, 'write');
  const baseHead = await getReference(configuration, token, payload.baseRef);
  if (baseHead !== payload.baseCommitSha) {
    throw new GitHubAppError('github_translation_base_stale', 409, false);
  }

  const existingPullRequest = await findPullRequest(configuration, token, payload);
  if (existingPullRequest) return resultFromPullRequest(payload, existingPullRequest);

  const [sourceFile, targetFile] = await Promise.all([
    getCatalogFile(configuration, token, payload.sourceCatalogPath, payload.baseCommitSha),
    getCatalogFile(configuration, token, payload.catalogPath, payload.baseCommitSha),
  ]);
  if (textHash(targetFile.raw) !== payload.catalogHash) {
    throw new GitHubAppError('github_translation_catalog_stale', 409, false);
  }
  const nextTarget = { ...targetFile.catalog };
  for (const item of payload.items) {
    const sourceText = sourceFile.catalog[item.messageKey];
    const currentTargetText = targetFile.catalog[item.messageKey] ?? null;
    if (sourceText !== item.sourceText || textHash(sourceText ?? '') !== item.sourceHash) {
      throw new GitHubAppError('github_translation_source_stale', 409, false);
    }
    if (currentTargetText !== item.currentTargetText) {
      throw new GitHubAppError('github_translation_target_stale', 409, false);
    }
    if (
      item.currentTargetHash !== null &&
      textHash(currentTargetText ?? '') !== item.currentTargetHash
    ) {
      throw new GitHubAppError('github_translation_target_hash_mismatch', 409, false);
    }
    if (item.currentTargetHash === null && currentTargetText !== null) {
      throw new GitHubAppError('github_translation_target_hash_missing', 409, false);
    }
    const asserted = [...new Set(item.placeholderSignature)].sort();
    if (
      !equalStrings(placeholders(sourceText), asserted) ||
      !equalStrings(placeholders(item.reviewedText), asserted)
    ) {
      throw new GitHubAppError('github_translation_placeholder_mismatch', 409, false);
    }
    nextTarget[item.messageKey] = item.reviewedText;
  }
  const nextRaw = serializeCatalog(nextTarget);

  const createReference = await githubRequest(
    configuration,
    token,
    '/repos/hadiranweb/casio-plus-final/git/refs',
    {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${payload.branchRef}`, sha: payload.baseCommitSha }),
    },
  );
  if (!createReference.response.ok && createReference.response.status !== 422) {
    throw new GitHubAppError(
      'github_translation_branch_create_failed',
      createReference.response.status,
      createReference.response.status === 429 || createReference.response.status >= 500,
    );
  }

  let pullRequestHeadSha: string;
  if (createReference.response.status === 422) {
    const branchFile = await getCatalogFile(
      configuration,
      token,
      payload.catalogPath,
      payload.branchRef,
    );
    if (branchFile.raw !== nextRaw) {
      throw new GitHubAppError('github_translation_branch_conflict', 409, false);
    }
    pullRequestHeadSha = await getReference(configuration, token, payload.branchRef);
  } else {
    const updated = await githubRequest(
      configuration,
      token,
      `/repos/hadiranweb/casio-plus-final/contents/${payload.catalogPath}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `i18n: apply reviewed Persian translations ${payload.changeSetId}`,
          content: Buffer.from(nextRaw, 'utf8').toString('base64'),
          sha: targetFile.sha,
          branch: payload.branchRef,
        }),
      },
    );
    if (!updated.response.ok) {
      throw new GitHubAppError(
        'github_translation_catalog_update_failed',
        updated.response.status,
        updated.response.status === 429 || updated.response.status >= 500,
      );
    }
    pullRequestHeadSha = updateContentSchema.parse(updated.body).commit.sha;
  }

  const createdPullRequest = await githubRequest(
    configuration,
    token,
    '/repos/hadiranweb/casio-plus-final/pulls',
    {
      method: 'POST',
      body: JSON.stringify({
        title: `i18n: reviewed Persian translations ${payload.changeSetId.slice(0, 8)}`,
        head: payload.branchRef,
        base: payload.baseRef,
        body: [
          'This pull request was created from an approved Casioplus Translation Change Set.',
          '',
          `Change Set: ${payload.changeSetId}`,
          `Approval: ${payload.approvalId}`,
          `Process Run: ${payload.processRunId}`,
          `Base commit: ${payload.baseCommitSha}`,
          '',
          'A human must review CI and merge this pull request. Auto-merge is intentionally unavailable.',
        ].join('\n'),
        draft: false,
        maintainer_can_modify: false,
      }),
    },
  );
  if (createdPullRequest.response.status === 422) {
    const retryLookup = await findPullRequest(configuration, token, payload);
    if (retryLookup) return resultFromPullRequest(payload, retryLookup);
  }
  if (!createdPullRequest.response.ok) {
    throw new GitHubAppError(
      'github_translation_pull_request_create_failed',
      createdPullRequest.response.status,
      createdPullRequest.response.status === 429 || createdPullRequest.response.status >= 500,
    );
  }
  const pullRequest = pullRequestSchema.parse(createdPullRequest.body);
  const result = resultFromPullRequest(payload, pullRequest);
  if (result.pullRequestHeadSha !== pullRequestHeadSha) {
    throw new GitHubAppError('github_translation_pull_request_head_mismatch', 409, false);
  }
  return result;
}
