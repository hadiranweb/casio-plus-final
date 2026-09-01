# Casioplus GitHub App Adapter

This internal service is the only repository boundary for approved translation synchronization. It accepts one action: `repository.open_translation_pr` for `hadiranweb/casio-plus-final`, base ref `main`, and target catalog `packages/i18n/messages/fa.json`.

The adapter never writes to `main`, never calls a merge endpoint, and has no PostgreSQL credentials. It creates a deterministic branch named `casioplus/translation/<change-set-id>`, commits only the reviewed Persian catalog delta, and opens a pull request for CI and human review.

## GitHub App permissions

The installation token is narrowed per request to one repository and these permissions only:

| Permission    |         Access | Purpose                                                                    |
| ------------- | -------------: | -------------------------------------------------------------------------- |
| Metadata      |           Read | Resolve repository metadata required by GitHub                             |
| Contents      | Read and write | Read the pinned catalogs, create the branch, and commit one target catalog |
| Pull requests | Read and write | Find or create the scoped pull request                                     |

Administration, Actions write, Workflows write, Secrets, Environments, Deployments, and merge automation are neither requested nor implemented.

## Inbound boundaries

`POST /dispatch` is internal-only and requires `ADAPTER_SHARED_SECRET`. Its body must satisfy the shared strict contract, including the approved Change Set, approval ID, pinned base SHA, catalog hash, English source locale, Persian target locale, fixed repository/path, deterministic branch, item hashes, and placeholder signatures.

`POST /webhooks/github` is the only externally routed endpoint. GitHub's `X-Hub-Signature-256` is verified against the raw request bytes before JSON parsing. Only `pull_request` events for the private canonical repository, `main`, and the deterministic translation branch prefix are forwarded. Forwarding uses a separate rotatable HMAC key and the existing Casioplus Integration Gateway, which performs server-side tenant/workspace mapping and nonce/idempotency enforcement.

## Required configuration

The service requires the GitHub App ID, installation ID, base64-encoded PEM private key, webhook secret, internal adapter shared secret, Core URL, External App/Tenant/Workspace references, Integration Gateway key ID, and the corresponding HMAC signing secret. Secret values must be supplied by the deployment secret manager; none belong in Git, image layers, catalog items, Change Set context, or logs.

Rotate the GitHub webhook secret and Integration Gateway signing key through their existing key-ID lifecycle. Keep the previous key in retiring state only for the bounded overlap interval, then revoke it and verify replay/audit evidence.
