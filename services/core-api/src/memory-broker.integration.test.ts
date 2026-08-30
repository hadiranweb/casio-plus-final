import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createPool } from './db.js';
import { retrieveGovernedMemory } from './memory-broker.js';
import { loadMigrations } from './migrations.js';

const databaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

type TenantSeed = {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  namespaceId: string;
};

describeWithDatabase('Memory Broker governance', () => {
  let pool!: ReturnType<typeof createPool>;
  const unique = randomUUID().slice(0, 8);
  let grantor!: TenantSeed;
  let grantee!: TenantSeed;
  let grantId = '';

  async function seedTenant(key: string): Promise<TenantSeed> {
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [`Casioplus ${key}`, `${key}-${unique}`],
    );
    const organizationId = organization.rows[0]!.id;
    const workspace = await pool.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, 'Primary Workspace', 'primary-workspace') RETURNING id`,
      [organizationId],
    );
    const workspaceId = workspace.rows[0]!.id;
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO actors (organization_id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', $3) RETURNING id`,
      [organizationId, workspaceId, `Actor ${key}`],
    );
    const actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO members (organization_id, actor_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [organizationId, actorId],
    );
    const policy = await pool.query<{ id: string }>(
      `INSERT INTO storage_policies (organization_id) VALUES ($1) RETURNING id`,
      [organizationId],
    );
    const namespace = await pool.query<{ id: string }>(
      `INSERT INTO memory_namespaces
          (organization_id, storage_policy_id, key, name, namespace_kind)
       VALUES ($1, $2, 'organization-memory', 'Organization Memory', 'governed')
       RETURNING id`,
      [organizationId, policy.rows[0]!.id],
    );
    return { organizationId, workspaceId, actorId, namespaceId: namespace.rows[0]!.id };
  }

  async function seedPromotedMemory(tenant: TenantSeed): Promise<void> {
    const workItem = await pool.query<{ id: string }>(
      `INSERT INTO work_items
          (organization_id, workspace_id, title, created_by_actor_id)
       VALUES ($1, $2, 'Operations diagnosis', $3) RETURNING id`,
      [tenant.organizationId, tenant.workspaceId, tenant.actorId],
    );
    const flow = await pool.query<{ id: string }>(
      `INSERT INTO flows
          (organization_id, workspace_id, key, name, created_by_actor_id)
       VALUES ($1, $2, 'operations-flow', 'Operations Flow', $3) RETURNING id`,
      [tenant.organizationId, tenant.workspaceId, tenant.actorId],
    );
    const version = await pool.query<{ id: string }>(
      `INSERT INTO flow_versions
          (flow_id, version, runtime_binding, created_by_actor_id)
       VALUES ($1, 1, 'native', $2) RETURNING id`,
      [flow.rows[0]!.id, tenant.actorId],
    );
    const run = await pool.query<{ id: string }>(
      `INSERT INTO flow_runs
          (organization_id, workspace_id, work_item_id, flow_id, flow_version_id,
           idempotency_key, created_by_actor_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded') RETURNING id`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        workItem.rows[0]!.id,
        flow.rows[0]!.id,
        version.rows[0]!.id,
        `memory-seed-${unique}`,
        tenant.actorId,
      ],
    );
    const record = await pool.query<{ id: string }>(
      `INSERT INTO semantic_records
          (organization_id, workspace_id, namespace_id, work_item_id, process_run_id,
           title, summary, created_by_actor_id, status)
       VALUES ($1, $2, $3, $4, $5, 'Operations result', 'Priority escalation path', $6, 'approved')
       RETURNING id`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        tenant.namespaceId,
        workItem.rows[0]!.id,
        run.rows[0]!.id,
        tenant.actorId,
      ],
    );
    const claim = await pool.query<{ id: string }>(
      `INSERT INTO knowledge_claims
          (organization_id, workspace_id, namespace_id, semantic_record_id, process_run_id,
           subject, claim_type, content, evidence, lifecycle, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, 'Operations priority', 'verified_fact',
               '{"priority":"urgent"}'::jsonb, '[]'::jsonb, 'approved', $6)
       RETURNING id`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        tenant.namespaceId,
        record.rows[0]!.id,
        run.rows[0]!.id,
        tenant.actorId,
      ],
    );
    const review = await pool.query<{ id: string }>(
      `INSERT INTO knowledge_reviews
          (organization_id, workspace_id, semantic_record_id, reviewer_actor_id, decision, rationale)
       VALUES ($1, $2, $3, $4, 'approve', 'Verified by owner') RETURNING id`,
      [tenant.organizationId, tenant.workspaceId, record.rows[0]!.id, tenant.actorId],
    );
    const promotion = await pool.query<{ id: string }>(
      `INSERT INTO knowledge_promotions
          (organization_id, workspace_id, namespace_id, claim_id, review_id,
           target_kind, promoted_by_actor_id, rationale)
       VALUES ($1, $2, $3, $4, $5, 'verified_fact', $6, 'Approved for governed retrieval')
       RETURNING id`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        tenant.namespaceId,
        claim.rows[0]!.id,
        review.rows[0]!.id,
        tenant.actorId,
      ],
    );
    await pool.query(
      `INSERT INTO organizational_memory_items
          (organization_id, workspace_id, namespace_id, kind, title, content,
           source_semantic_record_id, source_review_id, source_claim_id, promotion_id,
           lifecycle, sensitivity)
       VALUES ($1, $2, $3, 'verified_fact', 'Operations priority',
               '{"priority":"urgent"}'::jsonb, $4, $5, $6, $7, 'approved', 'organization')`,
      [
        tenant.organizationId,
        tenant.workspaceId,
        tenant.namespaceId,
        record.rows[0]!.id,
        review.rows[0]!.id,
        claim.rows[0]!.id,
        promotion.rows[0]!.id,
      ],
    );
  }

  beforeAll(async () => {
    pool = createPool(databaseUrl!);
    await applyMigrations(pool, await loadMigrations(resolve(process.cwd(), 'migrations')));
    grantor = await seedTenant('grantor');
    grantee = await seedTenant('grantee');
    await seedPromotedMemory(grantor);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('denies cross-tenant retrieval by default', async () => {
    const result = await retrieveGovernedMemory(pool, {
      ...grantee,
      query: 'operations priority',
      purpose: 'support.case',
      allowedKinds: ['verified_fact'],
      limit: 10,
    });
    expect(result.results).toHaveLength(0);
    expect(result.governance.appliedGrantIds).toHaveLength(0);
  });

  it('requires an active purpose- and scope-matched grant', async () => {
    const grant = await pool.query<{ id: string }>(
      `INSERT INTO memory_grants
          (grantor_organization_id, grantee_organization_id, namespace_id,
           purpose, allowed_kinds, allowed_sensitivities, scope, valid_until,
           created_by_actor_id)
       VALUES ($1, $2, $3, 'support.case', ARRAY['verified_fact'], ARRAY['organization'],
               jsonb_build_object('workspaceIds', jsonb_build_array($4::text)),
               now() + interval '1 day', $5)
       RETURNING id`,
      [
        grantor.organizationId,
        grantee.organizationId,
        grantor.namespaceId,
        grantee.workspaceId,
        grantor.actorId,
      ],
    );
    grantId = grant.rows[0]!.id;

    const wrongPurpose = await retrieveGovernedMemory(pool, {
      ...grantee,
      query: 'operations priority',
      purpose: 'sales.analysis',
      allowedKinds: ['verified_fact'],
      limit: 10,
    });
    expect(wrongPurpose.results).toHaveLength(0);

    const allowed = await retrieveGovernedMemory(pool, {
      ...grantee,
      query: 'operations priority',
      purpose: 'support.case',
      allowedKinds: ['verified_fact'],
      limit: 10,
    });
    expect(allowed.results).toHaveLength(1);
    expect(allowed.governance.appliedGrantIds).toContain(grantId);
  });

  it('applies revoke immediately and records access decisions', async () => {
    await pool.query(`UPDATE memory_grants SET revoked_at = now() WHERE id = $1`, [grantId]);
    const result = await retrieveGovernedMemory(pool, {
      ...grantee,
      query: 'operations priority',
      purpose: 'support.case',
      allowedKinds: ['verified_fact'],
      limit: 10,
    });
    expect(result.results).toHaveLength(0);

    const decisions = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM memory_access_decisions
        WHERE requester_organization_id = $1`,
      [grantee.organizationId],
    );
    expect(Number(decisions.rows[0]!.count)).toBeGreaterThanOrEqual(4);
  });
});
