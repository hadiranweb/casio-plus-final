import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  GovernedMemoryGraphInput,
  GovernedRetrievalInput,
} from '../../../packages/contracts/src/index.js';
import { withTransaction } from './db.js';

export type GovernedMemoryResult = {
  results: Record<string, unknown>[];
  governance: {
    permissionFiltered: true;
    purpose: string;
    allowedNamespaceIds: string[];
    appliedGrantIds: string[];
    unreviewedExcluded: true;
    expiredExcluded: true;
  };
};

export type GovernedMemoryGraphResult = {
  nodes: Array<{
    id: string;
    entityId: string;
    entityType: 'namespace' | 'memory' | 'claim' | 'semantic_record' | 'run' | 'flow';
    label: string;
    kind?: string;
    namespaceId?: string;
    sensitivity?: string;
    createdAt?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    relation: 'belongs_to' | 'promoted_from' | 'derived_from' | 'recorded_in' | 'executed_by';
  }>;
  governance: {
    permissionFiltered: true;
    purpose: string;
    allowedNamespaceIds: string[];
    appliedGrantIds: string[];
    promotedOnly: true;
    expiredExcluded: true;
  };
};

type AccessibleNamespace = {
  namespaceId: string;
  grantId: string | null;
};

export async function retrieveGovernedMemory(
  pool: Pool,
  input: GovernedRetrievalInput,
): Promise<GovernedMemoryResult> {
  return withTransaction(pool, async (client) => {
    const accessible = await client.query<AccessibleNamespace>(
      `SELECT mn.id AS "namespaceId", access_grant.id AS "grantId"
         FROM memory_namespaces mn
         LEFT JOIN LATERAL (
           SELECT mg.id
             FROM memory_grants mg
            WHERE mg.namespace_id = mn.id
              AND mg.grantor_organization_id = mn.organization_id
              AND mg.grantee_organization_id = $1
              AND mg.purpose = $3
              AND mg.revoked_at IS NULL
              AND mg.valid_from <= now() AND mg.valid_until > now()
              AND (mg.flow_id IS NULL OR mg.flow_id = $4::uuid)
              AND (
                NOT (mg.scope ? 'workspaceIds')
                OR mg.scope->'workspaceIds' ? $2::text
              )
            ORDER BY mg.valid_until ASC
            LIMIT 1
         ) access_grant ON true
        WHERE mn.status = 'active' AND mn.namespace_kind = 'governed'
          AND ($5::uuid[] IS NULL OR mn.id = ANY($5::uuid[]))
          AND (
            (
              mn.organization_id = $1
              AND (mn.workspace_id IS NULL OR mn.workspace_id = $2::uuid)
            )
            OR access_grant.id IS NOT NULL
          )`,
      [
        input.organizationId,
        input.workspaceId,
        input.purpose,
        input.flowId ?? null,
        input.namespaceIds ?? null,
      ],
    );

    const allowedNamespaceIds = accessible.rows.map((row) => row.namespaceId);
    const appliedGrantIds = accessible.rows
      .map((row) => row.grantId)
      .filter((value): value is string => Boolean(value));

    let results: Record<string, unknown>[] = [];
    if (allowedNamespaceIds.length > 0) {
      const query = await client.query(
        `SELECT DISTINCT ON (omi.id)
                omi.id, omi.organization_id AS "organizationId",
                omi.workspace_id AS "workspaceId", omi.namespace_id AS "namespaceId",
                omi.kind, omi.title, omi.content,
                omi.source_semantic_record_id AS "sourceSemanticRecordId",
                omi.source_claim_id AS "sourceClaimId", omi.promotion_id AS "promotionId",
                omi.lifecycle, omi.sensitivity, omi.valid_from AS "validFrom",
                omi.valid_until AS "validUntil", omi.created_at AS "createdAt",
                ts_rank(omi.search_vector, plainto_tsquery('simple', $3)) AS rank
           FROM organizational_memory_items omi
           JOIN memory_namespaces mn ON mn.id = omi.namespace_id
           LEFT JOIN memory_grants mg
             ON mg.namespace_id = omi.namespace_id
            AND mg.id = ANY($6::uuid[])
            AND mg.revoked_at IS NULL
            AND mg.valid_from <= now() AND mg.valid_until > now()
          WHERE omi.namespace_id = ANY($1::uuid[])
            AND omi.lifecycle = 'approved'
            AND omi.promotion_id IS NOT NULL
            AND omi.valid_from <= now()
            AND (omi.valid_until IS NULL OR omi.valid_until > now())
            AND ($2::text[] IS NULL OR omi.kind = ANY($2::text[]))
            AND omi.search_vector @@ plainto_tsquery('simple', $3)
            AND (
              (
                mn.organization_id = $4
                AND (mn.workspace_id IS NULL OR mn.workspace_id = $5)
                AND omi.sensitivity IN ('public', 'organization', 'workspace')
              )
              OR (
                mg.id IS NOT NULL
                AND omi.kind = ANY(mg.allowed_kinds)
                AND omi.sensitivity = ANY(mg.allowed_sensitivities)
              )
            )
          ORDER BY omi.id, rank DESC, omi.created_at DESC
          LIMIT $7`,
        [
          allowedNamespaceIds,
          input.allowedKinds ?? null,
          input.query,
          input.organizationId,
          input.workspaceId,
          appliedGrantIds,
          input.limit,
        ],
      );
      results = query.rows;
    }

    const queryHash = createHash('sha256').update(input.query, 'utf8').digest('hex');
    await client.query(
      `INSERT INTO memory_access_decisions
          (requester_organization_id, requester_workspace_id, requester_actor_id,
           flow_id, purpose, query_hash, requested_kinds, allowed_namespace_ids,
           applied_grant_ids, result_count, decision, denial_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN cardinality($8::uuid[]) > 0 THEN 'allowed' ELSE 'denied' END,
               CASE WHEN cardinality($8::uuid[]) > 0 THEN NULL ELSE 'namespace_access_denied' END)`,
      [
        input.organizationId,
        input.workspaceId,
        input.actorId,
        input.flowId ?? null,
        input.purpose,
        queryHash,
        input.allowedKinds ?? [],
        allowedNamespaceIds,
        appliedGrantIds,
        results.length,
      ],
    );

    return {
      results,
      governance: {
        permissionFiltered: true,
        purpose: input.purpose,
        allowedNamespaceIds,
        appliedGrantIds,
        unreviewedExcluded: true,
        expiredExcluded: true,
      },
    };
  });
}

type MemoryGraphRow = {
  namespaceId: string;
  namespaceName: string;
  memoryId: string;
  memoryTitle: string;
  memoryKind: string;
  sensitivity: string;
  memoryCreatedAt: string;
  claimId: string | null;
  claimSubject: string | null;
  semanticRecordId: string | null;
  semanticTitle: string | null;
  processRunId: string | null;
  flowId: string | null;
  flowName: string | null;
};

export async function retrieveGovernedMemoryGraph(
  pool: Pool,
  input: GovernedMemoryGraphInput,
): Promise<GovernedMemoryGraphResult> {
  return withTransaction(pool, async (client) => {
    const accessible = await client.query<AccessibleNamespace>(
      `SELECT mn.id AS "namespaceId", access_grant.id AS "grantId"
         FROM memory_namespaces mn
         LEFT JOIN LATERAL (
           SELECT mg.id
             FROM memory_grants mg
            WHERE mg.namespace_id = mn.id
              AND mg.grantor_organization_id = mn.organization_id
              AND mg.grantee_organization_id = $1
              AND mg.purpose = $3
              AND mg.revoked_at IS NULL
              AND mg.valid_from <= now() AND mg.valid_until > now()
              AND (mg.flow_id IS NULL OR mg.flow_id = $4::uuid)
              AND (
                NOT (mg.scope ? 'workspaceIds')
                OR mg.scope->'workspaceIds' ? $2::text
              )
            ORDER BY mg.valid_until ASC
            LIMIT 1
         ) access_grant ON true
        WHERE mn.status = 'active' AND mn.namespace_kind = 'governed'
          AND ($5::uuid[] IS NULL OR mn.id = ANY($5::uuid[]))
          AND (
            (
              mn.organization_id = $1
              AND (mn.workspace_id IS NULL OR mn.workspace_id = $2::uuid)
            )
            OR access_grant.id IS NOT NULL
          )`,
      [
        input.organizationId,
        input.workspaceId,
        input.purpose,
        input.flowId ?? null,
        input.namespaceIds ?? null,
      ],
    );
    const allowedNamespaceIds = accessible.rows.map((row) => row.namespaceId);
    const appliedGrantIds = accessible.rows
      .map((row) => row.grantId)
      .filter((value): value is string => Boolean(value));

    let rows: MemoryGraphRow[] = [];
    if (allowedNamespaceIds.length > 0) {
      const result = await client.query<MemoryGraphRow>(
        `SELECT DISTINCT ON (omi.id)
                mn.id AS "namespaceId", mn.name AS "namespaceName",
                omi.id AS "memoryId", omi.title AS "memoryTitle", omi.kind AS "memoryKind",
                omi.sensitivity, omi.created_at AS "memoryCreatedAt",
                kc.id AS "claimId", kc.subject AS "claimSubject",
                sr.id AS "semanticRecordId", sr.title AS "semanticTitle",
                fr.id AS "processRunId", f.id AS "flowId", f.name AS "flowName"
           FROM organizational_memory_items omi
           JOIN memory_namespaces mn ON mn.id = omi.namespace_id
           LEFT JOIN knowledge_claims kc ON kc.id = omi.source_claim_id
           LEFT JOIN semantic_records sr ON sr.id = omi.source_semantic_record_id
           LEFT JOIN flow_runs fr ON fr.id = sr.process_run_id
           LEFT JOIN flows f ON f.id = fr.flow_id
           LEFT JOIN memory_grants mg
             ON mg.namespace_id = omi.namespace_id
            AND mg.id = ANY($2::uuid[])
            AND mg.revoked_at IS NULL
            AND mg.valid_from <= now() AND mg.valid_until > now()
          WHERE omi.namespace_id = ANY($1::uuid[])
            AND omi.lifecycle = 'approved'
            AND omi.promotion_id IS NOT NULL
            AND omi.valid_from <= now()
            AND (omi.valid_until IS NULL OR omi.valid_until > now())
            AND (
              (
                mn.organization_id = $3
                AND (mn.workspace_id IS NULL OR mn.workspace_id = $4)
                AND omi.sensitivity IN ('public', 'organization', 'workspace')
              )
              OR (
                mg.id IS NOT NULL
                AND omi.kind = ANY(mg.allowed_kinds)
                AND omi.sensitivity = ANY(mg.allowed_sensitivities)
              )
            )
          ORDER BY omi.id, omi.created_at DESC
          LIMIT $5`,
        [
          allowedNamespaceIds,
          appliedGrantIds,
          input.organizationId,
          input.workspaceId,
          input.limit,
        ],
      );
      rows = result.rows;
    }

    const nodes = new Map<string, GovernedMemoryGraphResult['nodes'][number]>();
    const edges = new Map<string, GovernedMemoryGraphResult['edges'][number]>();
    const addNode = (node: GovernedMemoryGraphResult['nodes'][number]) => nodes.set(node.id, node);
    const addEdge = (edge: GovernedMemoryGraphResult['edges'][number]) => edges.set(edge.id, edge);

    for (const row of rows) {
      const namespaceNodeId = `namespace:${row.namespaceId}`;
      const memoryNodeId = `memory:${row.memoryId}`;
      addNode({
        id: namespaceNodeId,
        entityId: row.namespaceId,
        entityType: 'namespace',
        label: row.namespaceName,
        namespaceId: row.namespaceId,
      });
      addNode({
        id: memoryNodeId,
        entityId: row.memoryId,
        entityType: 'memory',
        label: row.memoryTitle,
        kind: row.memoryKind,
        namespaceId: row.namespaceId,
        sensitivity: row.sensitivity,
        createdAt: row.memoryCreatedAt,
      });
      addEdge({
        id: `${memoryNodeId}:belongs_to:${namespaceNodeId}`,
        source: memoryNodeId,
        target: namespaceNodeId,
        relation: 'belongs_to',
      });
      if (row.claimId) {
        const claimNodeId = `claim:${row.claimId}`;
        addNode({
          id: claimNodeId,
          entityId: row.claimId,
          entityType: 'claim',
          label: row.claimSubject ?? 'Knowledge claim',
          namespaceId: row.namespaceId,
        });
        addEdge({
          id: `${memoryNodeId}:promoted_from:${claimNodeId}`,
          source: memoryNodeId,
          target: claimNodeId,
          relation: 'promoted_from',
        });
        if (row.semanticRecordId) {
          const semanticNodeId = `semantic:${row.semanticRecordId}`;
          addNode({
            id: semanticNodeId,
            entityId: row.semanticRecordId,
            entityType: 'semantic_record',
            label: row.semanticTitle ?? 'Semantic record',
            namespaceId: row.namespaceId,
          });
          addEdge({
            id: `${claimNodeId}:derived_from:${semanticNodeId}`,
            source: claimNodeId,
            target: semanticNodeId,
            relation: 'derived_from',
          });
          if (row.processRunId) {
            const runNodeId = `run:${row.processRunId}`;
            addNode({
              id: runNodeId,
              entityId: row.processRunId,
              entityType: 'run',
              label: `Run ${row.processRunId.slice(0, 8)}`,
            });
            addEdge({
              id: `${semanticNodeId}:recorded_in:${runNodeId}`,
              source: semanticNodeId,
              target: runNodeId,
              relation: 'recorded_in',
            });
            if (row.flowId) {
              const flowNodeId = `flow:${row.flowId}`;
              addNode({
                id: flowNodeId,
                entityId: row.flowId,
                entityType: 'flow',
                label: row.flowName ?? 'Flow',
              });
              addEdge({
                id: `${runNodeId}:executed_by:${flowNodeId}`,
                source: runNodeId,
                target: flowNodeId,
                relation: 'executed_by',
              });
            }
          }
        }
      }
    }

    const queryHash = createHash('sha256')
      .update(
        JSON.stringify({
          kind: 'memory_graph',
          purpose: input.purpose,
          flowId: input.flowId ?? null,
          namespaceIds: input.namespaceIds ?? null,
          limit: input.limit,
        }),
      )
      .digest('hex');
    await client.query(
      `INSERT INTO memory_access_decisions
          (requester_organization_id, requester_workspace_id, requester_actor_id,
           flow_id, purpose, query_hash, requested_kinds, allowed_namespace_ids,
           applied_grant_ids, result_count, decision, denial_code)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::text[], $7, $8, $9,
               CASE WHEN cardinality($7::uuid[]) > 0 THEN 'allowed' ELSE 'denied' END,
               CASE WHEN cardinality($7::uuid[]) > 0 THEN NULL ELSE 'namespace_access_denied' END)`,
      [
        input.organizationId,
        input.workspaceId,
        input.actorId,
        input.flowId ?? null,
        input.purpose,
        queryHash,
        allowedNamespaceIds,
        appliedGrantIds,
        nodes.size,
      ],
    );

    return {
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      governance: {
        permissionFiltered: true,
        purpose: input.purpose,
        allowedNamespaceIds,
        appliedGrantIds,
        promotedOnly: true,
        expiredExcluded: true,
      },
    };
  });
}
