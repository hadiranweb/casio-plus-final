import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyMigrations, createPool } from './db.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describeWithDatabase('translation change set governance', () => {
  let pool!: ReturnType<typeof createPool>;
  let app!: ReturnType<typeof createApp>;
  let organizationId = '';
  let workspaceId = '';
  let proposerId = '';
  let reviewerId = '';
  let siblingWorkspaceId = '';
  let siblingActorId = '';
  let otherOrganizationId = '';
  let otherWorkspaceId = '';
  let otherActorId = '';
  const contexts = new Map<
    string,
    { organizationId: string; workspaceId: string; actorId: string }
  >();
  const unique = randomUUID().slice(0, 8);

  async function createTenant(name: string, slug: string) {
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [name, slug],
    );
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [organization.rows[0]!.id, `${name} Workspace`, 'translation-workspace'],
    );
    return { organizationId: organization.rows[0]!.id, workspaceId: workspace.rows[0]!.id };
  }

  async function createActor(
    targetOrganizationId: string,
    targetWorkspaceId: string,
    role: 'owner' | 'editor' | 'reviewer',
    displayName: string,
  ) {
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', $3) RETURNING id`,
      [targetOrganizationId, targetWorkspaceId, displayName],
    );
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, $3, 'active')`,
      [targetOrganizationId, actor.rows[0]!.id, role],
    );
    await pool.query(
      `INSERT INTO workspace_memberships
          (organization_id, workspace_id, actor_id, role, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [targetOrganizationId, targetWorkspaceId, actor.rows[0]!.id, role],
    );
    contexts.set(actor.rows[0]!.id, {
      organizationId: targetOrganizationId,
      workspaceId: targetWorkspaceId,
      actorId: actor.rows[0]!.id,
    });
    return actor.rows[0]!.id;
  }

  async function createRun(input?: {
    organizationId?: string;
    workspaceId?: string;
    actorId?: string;
    status?: 'queued' | 'succeeded';
    runtimeBinding?: 'open-webui' | 'openclaw';
  }) {
    const targetOrganizationId = input?.organizationId ?? organizationId;
    const targetWorkspaceId = input?.workspaceId ?? workspaceId;
    const targetActorId = input?.actorId ?? proposerId;
    const runtimeBinding = input?.runtimeBinding ?? 'open-webui';
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'Translation proposal', $3) RETURNING id`,
      [targetOrganizationId, targetWorkspaceId, targetActorId],
    );
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, $3, 'Translation proposal flow', $4) RETURNING id`,
      [targetOrganizationId, targetWorkspaceId, `translation-${randomUUID()}`, targetActorId],
    );
    const definition =
      runtimeBinding === 'open-webui'
        ? { model: 'translation-test-model', maxTokens: 128 }
        : { action: 'send_message', targetKey: 'translation-test-target' };
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, definition, created_by_actor_id)
       VALUES ($1, 1, $2, $3, $4) RETURNING id`,
      [flow.rows[0]!.id, runtimeBinding, definition, targetActorId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status, input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb) RETURNING id`,
      [
        targetOrganizationId,
        targetWorkspaceId,
        workItem.rows[0]!.id,
        flow.rows[0]!.id,
        version.rows[0]!.id,
        `translation-${randomUUID()}`,
        targetActorId,
        input?.status ?? 'succeeded',
      ],
    );
    return {
      processRunId: run.rows[0]!.id,
      flowId: flow.rows[0]!.id,
      flowVersionId: version.rows[0]!.id,
    };
  }

  function proposalBody(processRunId: string, idempotencyKey = `proposal-${randomUUID()}`) {
    return {
      processRunId,
      repositoryFullName: 'hadiranweb/casio-plus-final',
      baseRef: 'main',
      baseCommitSha: 'a'.repeat(40),
      catalogHash: 'b'.repeat(64),
      sourceLocale: 'en',
      targetLocale: 'fa',
      idempotencyKey,
      expiresInSeconds: 3600,
      provenance: { model: 'translation-test-model', promptVersion: 'test-v1' },
      items: [
        {
          messageKey: 'test_welcome_name',
          sourceText: 'Welcome, {name}',
          currentTargetText: 'خوش آمدید، {name}',
          proposedText: 'درود، {name}',
          placeholderSignature: ['name'],
          context: { surface: 'forge' },
        },
        {
          messageKey: 'test_review_action',
          sourceText: 'Review action',
          currentTargetText: 'بررسی عملیات',
          proposedText: 'بازبینی عملیات',
          placeholderSignature: [],
          context: { surface: 'console' },
        },
      ],
    };
  }

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    const primary = await createTenant(`Translation ${unique}`, `translation-${unique}`);
    organizationId = primary.organizationId;
    workspaceId = primary.workspaceId;
    proposerId = await createActor(organizationId, workspaceId, 'owner', 'Translation Proposer');
    reviewerId = await createActor(organizationId, workspaceId, 'reviewer', 'Translation Reviewer');
    const siblingWorkspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Sibling Translation Workspace', $2) RETURNING id`,
      [organizationId, `sibling-translation-${unique}`],
    );
    siblingWorkspaceId = siblingWorkspace.rows[0]!.id;
    siblingActorId = await createActor(
      organizationId,
      siblingWorkspaceId,
      'owner',
      'Sibling Workspace Owner',
    );
    const secondary = await createTenant(
      `Other Translation ${unique}`,
      `other-translation-${unique}`,
    );
    otherOrganizationId = secondary.organizationId;
    otherWorkspaceId = secondary.workspaceId;
    otherActorId = await createActor(
      otherOrganizationId,
      otherWorkspaceId,
      'owner',
      'Other Tenant Owner',
    );
    app = createApp(pool, {
      resolveTenantContext: async (req) => {
        const actorId = req.header('x-test-actor-id') ?? proposerId;
        const context = contexts.get(actorId);
        if (!context) throw new Error('test_actor_context_missing');
        return context;
      },
      enforceMembership: true,
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates an idempotent, server-resolved proposal and rejects invalid boundaries', async () => {
    const run = await createRun();
    const idempotencyKey = `proposal-${randomUUID()}`;
    const body = proposalBody(run.processRunId, idempotencyKey);
    const created = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.idempotent).toBe(false);
    expect(created.body.changeSet).toMatchObject({
      processRunId: run.processRunId,
      flowId: run.flowId,
      flowVersionId: run.flowVersionId,
      sourceLocale: 'en',
      targetLocale: 'fa',
      status: 'draft',
    });
    expect(created.body.changeSet.provenance).toMatchObject({
      runtimeBinding: 'open-webui',
      model: 'translation-test-model',
    });
    expect(
      created.body.items.find(
        (item: { messageKey: string }) => item.messageKey === 'test_review_action',
      ),
    ).toMatchObject({
      sourceHash: hash('Review action'),
      proposalHash: hash('بازبینی عملیات'),
    });

    const repeated = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(body);
    expect(repeated.status, JSON.stringify(repeated.body)).toBe(200);
    expect(repeated.body.idempotent).toBe(true);
    expect(repeated.body.changeSet.id).toBe(created.body.changeSet.id);

    const mismatchedReplay = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send({
        ...body,
        items: body.items.map((item, index) =>
          index === 0 ? { ...item, proposedText: 'ترجمهٔ متفاوت، {name}' } : item,
        ),
      });
    expect(mismatchedReplay.status).toBe(409);
    expect(mismatchedReplay.body.error).toBe('translation_idempotency_payload_mismatch');

    const invalidPlaceholders = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send({
        ...proposalBody(run.processRunId),
        items: [
          {
            messageKey: 'test_placeholder_mismatch',
            sourceText: 'Hello, {name}',
            proposedText: 'سلام',
            placeholderSignature: ['name'],
            context: { surface: 'forge' },
          },
        ],
      });
    expect(invalidPlaceholders.status).toBe(400);
    expect(invalidPlaceholders.body.error).toBe('translation_placeholder_signature_mismatch');

    const wrongRepository = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send({ ...proposalBody(run.processRunId), repositoryFullName: 'example/other-repository' });
    expect(wrongRepository.status).toBe(403);
    expect(wrongRepository.body.error).toBe('translation_repository_not_allowlisted');

    const queuedRun = await createRun({ status: 'queued' });
    const notSucceeded = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(queuedRun.processRunId));
    expect(notSucceeded.status).toBe(409);
    expect(notSucceeded.body.error).toBe('translation_process_run_not_succeeded');
  });

  it('rejects invalid direction, duplicate keys, invalid status and expired drafts', async () => {
    const run = await createRun();
    const invalidDirection = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send({
        ...proposalBody(run.processRunId),
        sourceLocale: 'fa',
        targetLocale: 'en',
      });
    expect(invalidDirection.status).toBe(400);
    expect(invalidDirection.body.error).toBe('translation_direction_not_allowed');

    const duplicateBody = proposalBody(run.processRunId);
    const duplicate = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send({ ...duplicateBody, items: [duplicateBody.items[0], duplicateBody.items[0]] });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toBe('translation_message_key_duplicate');

    const invalidStatus = await request(app)
      .get('/api/v1/translation-change-sets?status=unknown')
      .set('x-test-actor-id', proposerId);
    expect(invalidStatus.status).toBe(400);
    expect(invalidStatus.body.error).toBe('translation_change_set_status_invalid');

    const created = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(run.processRunId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await pool.query(
      `UPDATE translation_change_sets
          SET created_at = now() - interval '2 hours',
              expires_at = now() - interval '1 hour'
        WHERE id = $1`,
      [created.body.changeSet.id],
    );
    const expired = await request(app)
      .post(`/api/v1/translation-change-sets/${created.body.changeSet.id}/submit`)
      .set('x-test-actor-id', proposerId)
      .send({});
    expect(expired.status).toBe(409);
    expect(expired.body.error).toBe('translation_change_set_expired');

    const invalidId = await request(app)
      .post('/api/v1/translation-change-sets/not-a-uuid/submit')
      .set('x-test-actor-id', proposerId)
      .send({});
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error).toBe('invalid_request');
  });

  it('requires at least one accepted item before review completion', async () => {
    const run = await createRun();
    const created = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(run.processRunId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const changeSetId = created.body.changeSet.id as string;
    await request(app)
      .post(`/api/v1/translation-change-sets/${changeSetId}/submit`)
      .set('x-test-actor-id', proposerId)
      .send({});
    for (const item of created.body.items as Array<{ id: string }>) {
      const rejected = await request(app)
        .patch(`/api/v1/translation-change-sets/${changeSetId}/items/${item.id}/review`)
        .set('x-test-actor-id', reviewerId)
        .send({ decision: 'rejected', reason: 'Rejected by the translation reviewer.' });
      expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
      expect(rejected.body.item.status).toBe('rejected');
    }
    const completed = await request(app)
      .post(`/api/v1/translation-change-sets/${changeSetId}/complete-review`)
      .set('x-test-actor-id', reviewerId)
      .send({});
    expect(completed.status).toBe(409);
    expect(completed.body.error).toBe('translation_change_set_has_no_accepted_items');
  });

  it('enforces four-eyes item review, placeholder parity and a complete review gate', async () => {
    const run = await createRun();
    const created = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(run.processRunId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const changeSetId = created.body.changeSet.id as string;
    const [placeholderItem, plainItem] = created.body.items as Array<{ id: string }>;

    const submitted = await request(app)
      .post(`/api/v1/translation-change-sets/${changeSetId}/submit`)
      .set('x-test-actor-id', proposerId)
      .send({});
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.changeSet.status).toBe('ready_for_review');

    const selfReview = await request(app)
      .patch(`/api/v1/translation-change-sets/${changeSetId}/items/${plainItem!.id}/review`)
      .set('x-test-actor-id', proposerId)
      .send({ decision: 'accepted', reason: 'Self approval must fail.' });
    expect(selfReview.status).toBe(403);
    expect(selfReview.body.error).toBe('translation_self_review_forbidden');

    const brokenEdit = await request(app)
      .patch(`/api/v1/translation-change-sets/${changeSetId}/items/${placeholderItem!.id}/review`)
      .set('x-test-actor-id', reviewerId)
      .send({ decision: 'edited', reviewedText: 'خوش آمدید', reason: 'Missing placeholder.' });
    expect(brokenEdit.status).toBe(400);
    expect(brokenEdit.body.error).toBe('translation_placeholder_signature_mismatch');

    const edited = await request(app)
      .patch(`/api/v1/translation-change-sets/${changeSetId}/items/${placeholderItem!.id}/review`)
      .set('x-test-actor-id', reviewerId)
      .send({
        decision: 'edited',
        reviewedText: 'خوش آمدید، {name}',
        reason: 'Use the established product voice.',
      });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.item.status).toBe('edited');

    const incomplete = await request(app)
      .post(`/api/v1/translation-change-sets/${changeSetId}/complete-review`)
      .set('x-test-actor-id', reviewerId)
      .send({});
    expect(incomplete.status).toBe(409);
    expect(incomplete.body.error).toBe('translation_change_set_items_pending_review');

    const accepted = await request(app)
      .patch(`/api/v1/translation-change-sets/${changeSetId}/items/${plainItem!.id}/review`)
      .set('x-test-actor-id', reviewerId)
      .send({ decision: 'accepted', reason: 'Accurate and concise.' });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.item.status).toBe('accepted');

    const completed = await request(app)
      .post(`/api/v1/translation-change-sets/${changeSetId}/complete-review`)
      .set('x-test-actor-id', reviewerId)
      .send({});
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.changeSet.status).toBe('ready_for_approval');

    const audits = await pool.query<{ eventType: string }>(
      `SELECT event_type AS "eventType" FROM audit_events
        WHERE organization_id = $1 AND subject_id = ANY($2::uuid[])
        ORDER BY created_at`,
      [organizationId, [changeSetId, placeholderItem!.id, plainItem!.id]],
    );
    expect(audits.rows.map((row) => row.eventType)).toEqual(
      expect.arrayContaining([
        'translation.change_set_created',
        'translation.change_set_submitted',
        'translation.item_reviewed',
        'translation.review_completed',
      ]),
    );
  });

  it('keeps change sets invisible across organization boundaries', async () => {
    const run = await createRun();
    const created = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(run.processRunId));
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const hidden = await request(app)
      .get(`/api/v1/translation-change-sets/${created.body.changeSet.id}`)
      .set('x-test-actor-id', otherActorId);
    expect(hidden.status).toBe(404);

    const list = await request(app)
      .get('/api/v1/translation-change-sets')
      .set('x-test-actor-id', otherActorId);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.changeSets).toEqual([]);

    const siblingList = await request(app)
      .get('/api/v1/translation-change-sets')
      .set('x-test-actor-id', siblingActorId);
    expect(siblingList.status, JSON.stringify(siblingList.body)).toBe(200);
    expect(siblingList.body.changeSets).toEqual([]);

    const siblingRun = await createRun({
      organizationId,
      workspaceId: siblingWorkspaceId,
      actorId: siblingActorId,
    });
    const crossWorkspaceRejected = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(siblingRun.processRunId));
    expect(crossWorkspaceRejected.status).toBe(404);
    expect(crossWorkspaceRejected.body.error).toBe('translation_process_run_not_found');

    const crossTenantRun = await createRun({
      organizationId: otherOrganizationId,
      workspaceId: otherWorkspaceId,
      actorId: otherActorId,
    });
    const rejected = await request(app)
      .post('/api/v1/translation-change-sets')
      .set('x-test-actor-id', proposerId)
      .send(proposalBody(crossTenantRun.processRunId));
    expect(rejected.status).toBe(404);
    expect(rejected.body.error).toBe('translation_process_run_not_found');
  });
});
