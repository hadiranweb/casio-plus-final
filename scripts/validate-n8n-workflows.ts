import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const root = process.cwd();
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const semver = /^\d+\.\d+\.\d+$/;

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
  meta: z.object({
    casioplusSchemaVersion: z.literal('casioplus.n8n.workflow.v1'),
    requiredCredentialType: z.literal('httpHeaderAuth'),
    requiredCredentialHeader: z.literal('Authorization'),
    activationRequiresCredentialBinding: z.literal(true),
  }),
});

const manifestSchema = z.object({
  schemaVersion: z.literal('casioplus.n8n.manifest.v1'),
  n8nVersion: z.string().regex(semver),
  workflows: z.array(
    z.object({
      path: z.string().startsWith('runtime/n8n/workflows/'),
      name: z.string(),
      webhookPath: z.string(),
      operationPrefixes: z.array(z.literal('n8n.')).min(1),
      activeInRepository: z.literal(false),
      requiredCredential: z.object({
        type: z.literal('httpHeaderAuth'),
        header: z.literal('Authorization'),
        secretEnvironmentVariable: z.literal('N8N_WEBHOOK_TOKEN'),
      }),
    }),
  ),
  activationGates: z.array(z.string()).min(6),
  forbiddenNodeFamilies: z.array(z.string()).min(1),
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

  const validated: Array<{ name: string; nodes: number; webhookPath: string }> = [];
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
      assert(uuidV4.test(node.id), `n8n_node_id_must_be_uuid_v4:${node.name}`);
      assert(!names.has(node.name), `n8n_duplicate_node_name:${node.name}`);
      names.add(node.name);
      inbound.set(node.name, 0);
      assert(
        !manifest.forbiddenNodeFamilies.includes(node.type),
        `n8n_database_node_forbidden:${node.name}:${node.type}`,
      );
      assert(
        [
          'n8n-nodes-base.webhook',
          'n8n-nodes-base.code',
          'n8n-nodes-base.if',
          'n8n-nodes-base.respondToWebhook',
        ].includes(node.type),
        `n8n_node_type_not_allowlisted:${node.name}:${node.type}`,
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

    for (const [source, branches] of Object.entries(workflow.connections)) {
      assert(names.has(source), `n8n_unknown_connection_source:${source}`);
      for (const branch of branches.main) {
        for (const connection of branch) {
          assert(names.has(connection.node), `n8n_unknown_connection_target:${connection.node}`);
          inbound.set(connection.node, (inbound.get(connection.node) ?? 0) + 1);
        }
      }
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
    for (const node of workflow.nodes) {
      if (node !== webhook)
        assert((inbound.get(node.name) ?? 0) > 0, `n8n_disconnected_node:${node.name}`);
      if (node.type === 'n8n-nodes-base.if') {
        assert(
          workflow.connections[node.name]?.main.length === 2,
          `n8n_if_requires_two_branches:${node.name}`,
        );
      }
      if (node.type === 'n8n-nodes-base.respondToWebhook') {
        const options = node.parameters.options as { responseCode?: number } | undefined;
        assert(options?.responseCode === 200, `n8n_typed_result_must_return_200:${node.name}`);
      }
    }
    validated.push({
      name: workflow.name,
      nodes: workflow.nodes.length,
      webhookPath: entry.webhookPath,
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
    }),
  );
}

void main();
