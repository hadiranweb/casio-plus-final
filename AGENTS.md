# Casioplus Repository Rules

This repository is the single canonical source for Casioplus.

## Product naming

Only **Casioplus** and **کاسیو پلاس** are valid product names. The canonical web surfaces are **Console** and **Forge**. Product, package, path, hostname, database, runtime, workflow, commit, documentation, and operational messages must not introduce another product name.

## Canonical architecture

The MVP critical path is TypeScript/Node.js with PostgreSQL. Rust is not part of the MVP critical path. Console and Forge are Remix applications. Vite is only the official Remix Vite compiler; standalone Vite/React applications, independent `createRoot`, static SPA servers, and routing outside Remix are forbidden.

Core/API is the only canonical writer and the authorization, audit, lifecycle, artifact metadata, mapping, memory governance, and usage-attribution boundary. PostgreSQL is the only canonical store. Workers and adapters must not receive PostgreSQL credentials or access it directly.

n8n is orchestration-only. Open WebUI is the interaction/model plane. OpenClaw is the allowlisted, approval-gated action plane. These components never grant authority to one another and communicate through typed Core contracts.

## Tenant and memory governance

The tenant topology is `ExternalApp → ExternalTenant → CasioOrganization → Workspace → MemoryNamespace → StoragePolicy`. External identifiers are assertions and must be resolved server-side.

Every organization namespace is private and default-deny. Cross-tenant access requires an auditable, revocable MemoryGrant restricted by purpose, Flow, kind, scope, sensitivity, validity, and promotion state. Memory Broker is the only retrieval and access-check boundary.

The governed lifecycle is `OperationalEvent → SemanticRecord → KnowledgeClaim → KnowledgeReview → KnowledgePromotion → OrganizationalMemoryItem`. Raw namespaces and versioned Knowledge Packs remain separate.

## Integration and economics

Integration Gateway verifies HMAC against the raw body before parsing and enforces timestamp, nonce, key ID and rotation, server-side tenant mapping, callback allowlists, idempotency, outbox/dispatcher delivery, retry, timeout, redaction, and audit. Callback URLs and privileges in payload bodies are never authoritative.

Usage and cost records are immutable and attributable to organization, external application and tenant, workspace, Flow and version, run, namespace, operation, runtime or model, token, byte, latency, unit cost, allocated shared cost, billable amount, payer, and pricingVersion. Casioplus P&L and ecosystem TCO are separate views.

## Required validation

Every change must pass the applicable gates: frozen install, format check, typecheck, tests, topology validation, migration smoke, build, Remix SSR smoke, Docker build for changed units, tenant-negative tests, Integration Gateway replay tests, and Golden Flow smoke. Secrets and generated output must never be committed.
