import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const root = process.cwd();
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const semver = /^\d+\.\d+\.\d+$/;
const scheduleEnvironmentVariables = [
  'CASIOPLUS_GITHUB_APP_INTERNAL_URL',
  'ADAPTER_SHARED_SECRET',
  'CASIOPLUS_CORE_INTERNAL_URL',
  'TRANSLATION_SCHEDULER_SECRET',
] as const;

const nodeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.string().min(1),
  typeVersion: z.number().positive(),
  position: z.tuple([z.number(), z.number()]),
  parameters: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()).optional(),
});

const connectionSchema = z.object({
  node: z.string().min(1),
  type: z.literal('main'),
  index: z.number().int().nonnegative(),
});

const webhookMetaSchema = z.object({
  casioplusSchemaVersion: z.literal('casioplus.n8n.workflow.v1'),
  requiredCredentialType: z.literal('httpHeaderAuth'),
  requiredCredentialHeader: z.literal('Authorization'),
  activationRequiresCredentialBinding: z.literal(true),
});
const scheduleMetaSchema = z.object({
  casioplusSchemaVersion: z.literal('casioplus.n8n.workflow.v1'),
  triggerType: z.literal('schedule'),
  requiredEnvironmentVariables: z.array(z.enum(scheduleEnvironmentVariables)).length(4),
  activationRequiresEnvironmentBinding: z.literal(true),
  proposalOnly: z.literal(true),
});

const workflowSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  active: z.boolean(),
  nodes: z.array(nodeSchema).min(2),
  connections: z.record(z.string(), z.object({ main: z.array(z.array(connectionSchema)) })),
  pinData: z.record(z.string(), z.unknown()),
  settings: z.object({
    executionOrder: z.literal('v1'),
    saveDataErrorExecution: z.literal('all'),
    saveDataSuccessExecution: z.literal('none'),
    executionTimeout: z.number().int().min(1).max(120),
  }),
  meta: z.union([webhookMetaSchema, scheduleMetaSchema]),
});

const webhookManifestEntrySchema = z.object({
  path: z.string().startsWith('runtime/n8n/workflows/'),
  name: z.string(),
  triggerType: z.literal('webhook'),
  webhookPath: z.string(),
  operationPrefixes: z.array(z.literal('n8n.')).min(1),
  activeInRepository: z.literal(false),
  requiredCredential: z.object({
    type: z.literal('httpHeaderAuth'),
    header: z.literal('Authorization'),
    secretEnvironmentVariable: z.literal('N8N_WEBHOOK_TOKEN'),
  }),
});
const scheduleManifestEntrySchema = z.object({
  path: z.string().startsWith('runtime/n8n/workflows/'),
  name: z.string(),
  triggerType: z.literal('schedule'),
  activeInRepository: z.literal(false),
  requiredEnvironmentVariables: z.array(z.enum(scheduleEnvironmentVariables)).length(4),
  proposalOnly: z.literal(true),
});
const manifestEntrySchema = z.discriminatedUnion('triggerType', [
  webhookManifestEntrySchema,
  scheduleManifestEntrySchema,
]);
const manifestSchema = z.object({
  schemaVersion: z.literal('casioplus.n8n.manifest.v1'),
  n8nVersion: z.string().regex(semver),
  workflows: z.array(manifestEntrySchema).min(2),
  activationGates: z.array(z.string()).min(7),
  forbiddenNodeFamilies: z.array(z.string()).min(1),
});

type Workflow = z.infer<typeof workflowSchema>;
type ManifestEntry = z.infer<typeof manifestEntrySchema>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stringParameter(node: z.infer<typeof nodeSchema>, key: string): string {
  const value = node.parameters[key];
  assert(typeof value === 'string', `n8n_string_parameter_required:${node.name}:${key}`);
  return value;
}

function validateCommonNode(
  node: z.infer<typeof nodeSchema>,
  forbiddenNodeFamilies: string[],
): void {
  assert(uuidV4.test(node.id), `n8n_node_id_must_be_uuid_v4:${node.name}`);
  assert(
    !forbiddenNodeFamilies.includes(node.type),
    `n8n_database_node_forbidden:${node.name}:${node.type}`,
  );
  if (node.credentials) {
    const serialized = JSON.stringify(node.credentials);
    assert(
      !/replace[_-]?me|placeholder|example/i.test(serialized),
      `n8n_placeholder_credential:${node.name}`,
    );
  }
  const parameters = JSON.stringify(node.parameters);
  assert(
    !/postgres|mysql|mongodb|sqlite|database_url/i.test(parameters),
    `n8n_database_reference_forbidden:${node.name}`,
  );
  assert(
    !/Bearer\s+[A-Za-z0-9._-]{16,}/.test(parameters),
    `n8n_hardcoded_bearer_token:${node.name}`,
  );
  assert(!/https?:\/\//.test(parameters), `n8n_hardcoded_url_forbidden:${node.name}`);
  if (node.type === 'n8n-nodes-base.code') {
    assert(
      node.parameters.mode === 'runOnceForAllItems',
      `n8n_code_mode_must_be_all_items:${node.name}`,
    );
  }
}

function validateWebhookWorkflow(workflow: Workflow, entry: ManifestEntry): string {
  assert(entry.triggerType === 'webhook', `n8n_manifest_trigger_mismatch:${workflow.name}`);
  const allowed = [
    'n8n-nodes-base.webhook',
    'n8n-nodes-base.code',
    'n8n-nodes-base.if',
    'n8n-nodes-base.respondToWebhook',
  ];
  for (const node of workflow.nodes) {
    assert(allowed.includes(node.type), `n8n_node_type_not_allowlisted:${node.name}:${node.type}`);
  }
  const webhookNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook');
  const responseNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.respondToWebhook',
  );
  assert(webhookNodes.length === 1, `n8n_exactly_one_webhook_required:${workflow.name}`);
  assert(responseNodes.length >= 1, `n8n_response_node_required:${workflow.name}`);
  const webhook = webhookNodes[0]!;
  assert(
    webhook.parameters.authentication === 'headerAuth',
    `n8n_webhook_header_auth_required:${workflow.name}`,
  );
  assert(
    webhook.parameters.responseMode === 'responseNode',
    `n8n_webhook_response_node_mode_required:${workflow.name}`,
  );
  assert(
    webhook.parameters.path === entry.webhookPath,
    `n8n_webhook_path_mismatch:${workflow.name}`,
  );
  for (const node of responseNodes) {
    const options = node.parameters.options as { responseCode?: number } | undefined;
    assert(options?.responseCode === 200, `n8n_typed_result_must_return_200:${node.name}`);
  }
  assert(
    !('triggerType' in workflow.meta),
    `n8n_webhook_metadata_contract_mismatch:${workflow.name}`,
  );
  return entry.webhookPath;
}

function headerValues(node: z.infer<typeof nodeSchema>): Map<string, string> {
  const headerParameters = node.parameters.headerParameters as
    { parameters?: Array<{ name?: unknown; value?: unknown }> } | undefined;
  const values = new Map<string, string>();
  for (const header of headerParameters?.parameters ?? []) {
    if (typeof header.name === 'string' && typeof header.value === 'string') {
      values.set(header.name.toLowerCase(), header.value);
    }
  }
  return values;
}

function validateScheduleWorkflow(workflow: Workflow, entry: ManifestEntry): string {
  assert(entry.triggerType === 'schedule', `n8n_manifest_trigger_mismatch:${workflow.name}`);
  const allowed = [
    'n8n-nodes-base.scheduleTrigger',
    'n8n-nodes-base.httpRequest',
    'n8n-nodes-base.code',
  ];
  for (const node of workflow.nodes) {
    assert(allowed.includes(node.type), `n8n_node_type_not_allowlisted:${node.name}:${node.type}`);
    assert(!node.credentials, `n8n_schedule_credentials_forbidden:${node.name}`);
  }
  const triggerNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.scheduleTrigger',
  );
  const httpNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.httpRequest');
  const codeNodes = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.code');
  assert(triggerNodes.length === 1, `n8n_exactly_one_schedule_trigger_required:${workflow.name}`);
  assert(httpNodes.length === 2, `n8n_schedule_exactly_two_http_nodes_required:${workflow.name}`);
  assert(codeNodes.length === 1, `n8n_schedule_exactly_one_code_node_required:${workflow.name}`);
  assert(
    workflow.nodes.every(
      (node) =>
        node.type !== 'n8n-nodes-base.webhook' && node.type !== 'n8n-nodes-base.respondToWebhook',
    ),
    `n8n_schedule_inbound_endpoint_forbidden:${workflow.name}`,
  );
  const triggerSerialized = JSON.stringify(triggerNodes[0]!.parameters);
  assert(
    triggerSerialized.includes('"minutesInterval":15'),
    `n8n_schedule_interval_must_be_fifteen_minutes:${workflow.name}`,
  );

  const snapshotNode = httpNodes.find((node) =>
    stringParameter(node, 'url').includes('/internal/v1/translation-catalog-snapshot'),
  );
  const tickNode = httpNodes.find((node) =>
    stringParameter(node, 'url').includes('/internal/v1/translation-proposal-schedules/tick'),
  );
  assert(snapshotNode, `n8n_schedule_snapshot_node_required:${workflow.name}`);
  assert(tickNode, `n8n_schedule_tick_node_required:${workflow.name}`);
  assert(
    stringParameter(snapshotNode, 'url') ===
      "={{ $env.CASIOPLUS_GITHUB_APP_INTERNAL_URL + '/internal/v1/translation-catalog-snapshot' }}",
    `n8n_schedule_snapshot_url_not_allowlisted:${workflow.name}`,
  );
  assert(
    stringParameter(tickNode, 'url') ===
      "={{ $env.CASIOPLUS_CORE_INTERNAL_URL + '/internal/v1/translation-proposal-schedules/tick' }}",
    `n8n_schedule_tick_url_not_allowlisted:${workflow.name}`,
  );
  const snapshotHeaders = headerValues(snapshotNode);
  const tickHeaders = headerValues(tickNode);
  assert(
    snapshotHeaders.get('x-casioplus-adapter-secret') === '={{ $env.ADAPTER_SHARED_SECRET }}',
    `n8n_schedule_snapshot_secret_binding_required:${workflow.name}`,
  );
  assert(
    tickHeaders.get('x-casioplus-scheduler-secret') === '={{ $env.TRANSLATION_SCHEDULER_SECRET }}',
    `n8n_schedule_tick_secret_binding_required:${workflow.name}`,
  );
  assert(
    tickNode.parameters.method === 'POST' && tickNode.parameters.sendBody === true,
    `n8n_schedule_tick_post_body_required:${workflow.name}`,
  );
  const scheduleSerialized = JSON.stringify(workflow);
  for (const variable of scheduleEnvironmentVariables) {
    assert(scheduleSerialized.includes(`$env.${variable}`), `n8n_schedule_env_missing:${variable}`);
  }
  const referencedVariables = [...scheduleSerialized.matchAll(/\$env\.([A-Z0-9_]+)/g)].map(
    (match) => match[1],
  );
  assert(
    referencedVariables.every((variable) =>
      scheduleEnvironmentVariables.includes(
        variable as (typeof scheduleEnvironmentVariables)[number],
      ),
    ),
    `n8n_schedule_env_not_allowlisted:${workflow.name}`,
  );
  assert(
    !/request-approval|action-approvals|open_translation_pr|git\/refs|\/pulls|\/merge|auto.?publish/i.test(
      scheduleSerialized,
    ),
    `n8n_schedule_forbidden_action_path:${workflow.name}`,
  );
  assert(
    'triggerType' in workflow.meta &&
      workflow.meta.triggerType === 'schedule' &&
      workflow.meta.proposalOnly === true,
    `n8n_schedule_metadata_contract_mismatch:${workflow.name}`,
  );
  assert(
    JSON.stringify([...entry.requiredEnvironmentVariables].sort()) ===
      JSON.stringify([...workflow.meta.requiredEnvironmentVariables].sort()),
    `n8n_schedule_environment_manifest_mismatch:${workflow.name}`,
  );
  return 'every-15-minutes';
}

async function main() {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(resolve(root, 'runtime/n8n/manifest.json'), 'utf8')),
  );
  const files = (await readdir(resolve(root, 'runtime/n8n/workflows')))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const declared = manifest.workflows.map((workflow) => workflow.path.split('/').at(-1)).sort();
  assert(JSON.stringify(files) === JSON.stringify(declared), 'n8n_manifest_file_set_mismatch');

  const validated: Array<{ name: string; nodes: number; triggerType: string; trigger: string }> =
    [];
  for (const entry of manifest.workflows) {
    const workflow = workflowSchema.parse(
      JSON.parse(await readFile(resolve(root, entry.path), 'utf8')),
    );
    assert(workflow.name === entry.name, `n8n_workflow_name_mismatch:${entry.path}`);
    assert(uuidV4.test(workflow.id), `n8n_workflow_id_must_be_uuid_v4:${workflow.name}`);
    assert(!workflow.active, `n8n_repository_workflow_must_be_inactive:${workflow.name}`);
    assert(Object.keys(workflow.pinData).length === 0, `n8n_pin_data_forbidden:${workflow.name}`);

    const names = new Set<string>();
    const inbound = new Map<string, number>();
    for (const node of workflow.nodes) {
      assert(!names.has(node.name), `n8n_duplicate_node_name:${node.name}`);
      names.add(node.name);
      inbound.set(node.name, 0);
      validateCommonNode(node, manifest.forbiddenNodeFamilies);
    }
    for (const [source, branches] of Object.entries(workflow.connections)) {
      assert(names.has(source), `n8n_unknown_connection_source:${source}`);
      for (const branch of branches.main) {
        for (const connection of branch) {
          assert(names.has(connection.node), `n8n_unknown_connection_target:${connection.node}`);
          inbound.set(connection.node, (inbound.get(connection.node) ?? 0) + 1);
        }
      }
    }
    const trigger =
      entry.triggerType === 'webhook'
        ? validateWebhookWorkflow(workflow, entry)
        : validateScheduleWorkflow(workflow, entry);
    const rootType =
      entry.triggerType === 'webhook' ? 'n8n-nodes-base.webhook' : 'n8n-nodes-base.scheduleTrigger';
    for (const node of workflow.nodes) {
      if (node.type !== rootType) {
        assert((inbound.get(node.name) ?? 0) > 0, `n8n_disconnected_node:${node.name}`);
      }
      if (node.type === 'n8n-nodes-base.if') {
        assert(
          workflow.connections[node.name]?.main.length === 2,
          `n8n_if_requires_two_branches:${node.name}`,
        );
      }
    }
    validated.push({
      name: workflow.name,
      nodes: workflow.nodes.length,
      triggerType: entry.triggerType,
      trigger,
    });
  }

  console.log(
    JSON.stringify({
      status: 'ok',
      n8nVersion: manifest.n8nVersion,
      workflows: validated,
      activationGates: manifest.activationGates.length,
      databaseNodes: 0,
      hardcodedSecrets: 0,
      automatedApprovals: 0,
      automatedRepositoryWrites: 0,
    }),
  );
}

void main();
