# GitHub Copilot provider

English | [中文](github-copilot-provider.zh.md)

The `github-copilot` route uses pi-ai's GitHub Device OAuth implementation and the Harness LLM, credential, Host API, and Web client plugins. This page describes the responsibilities and lifecycle of that assembled provider. The generic authentication types remain part of the [LLM subsystem](llm-streaming.md), and the rationale for assigning provider protocol to the adapter is recorded in the [provider OAuth Agent Note](../../.agents/notes/implemented/feature/2026-08-14-llm-provider-oauth.md).

## Plugin responsibilities

The implementation extends existing plugin services rather than adding provider behavior to the agent loop.

| Plugin | Responsibility |
|---|---|
| [`dsh-llm`](../../packages/llm/llm/README.md) | Declares provider-neutral authentication methods, status, interaction callbacks, login, and logout on `LlmAdapter`; `LlmRuntime` routes calls to the adapter registered for a provider. |
| [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) | Registers `github-copilot` on `ctx.llm`, delegates login, refresh, request authentication, and logout to pi-ai, and adapts pi-ai credentials to Harness storage. |
| [`dsh-credentials`](../../packages/credentials/credentials/README.md) | Supplies the active secret store through `ctx.credentials`; it persists opaque values without knowing GitHub or pi-ai protocols. |
| [`dsh-host-apiproxy`](../../packages/host/apiproxy/README.md) | Exposes generic LLM authentication operations over typed unary RPC and keeps live prompts, cancellation, and bounded non-secret progress on the Host. |
| [`dsh-ui-settings-models`](../../packages/client/ui-settings-models/README.md) | Renders the provider-neutral operation, Device OAuth code and verification URL, prompts, cancellation, completion, and logout. |

This division follows the Harness capability model: `dsh-llm` is the Service Definition, `dsh-llm-pi-ai` is the Service Provider, and ApiProxy plus Models settings are Consumers. The provider remains replaceable through `ctx.llm`; registrations use Cordis effects and unload with their plugin. No GitHub-specific branch enters `dsh-agent-loop`.

## Login flow

1. Models settings starts `llm.startAuth` for the registered route and the `oauth` method.
2. ApiProxy creates or reuses the route's running operation and calls `ctx.llm.providerLogin()` with Host-owned notification, prompt, and cancellation callbacks.
3. `LlmRuntime` verifies that the live adapter advertises the method, then dispatches to `PiAiAdapter.login()`.
4. pi-ai emits the GitHub verification URL and user code, handles any prompt, exchanges the approved device code, and writes its canonical OAuth credential through `HarnessCredentialStore`.
5. Models settings polls the operation while it is running. A successful terminal state triggers a fresh non-secret authentication-status read and makes the route usable.

The browser receives operation ids, status, bounded notifications, and at most one pending prompt. It never receives the access token, refresh token, or serialized credential. The retained operation lets a reloaded page recover a running or terminal flow while the Host process remains alive; operations do not survive a Host restart.

## Credential storage and refresh

`HarnessCredentialStore` derives one deterministic `CredentialRef` from each provider route and stores a versioned JSON document through the active `ctx.credentials` provider. Settings contain provider profiles and credential references for API-key routes, but never GitHub OAuth tokens.

Each pi-ai `Models` snapshot shares this store. pi-ai reads the credential before a provider request, checks expiry, refreshes when required, and persists credential rotation before dispatch. A stored OAuth credential remains authoritative until logout; refresh failure does not fall back to an ambient API key.

`modify()` and `delete()` serialize operations per provider route inside one Harness process. A shared backing credential provider remains responsible for cross-process locking. Without that support, two Harness processes may refresh concurrently and later reads observe the last completed write.

## Logout and failure behavior

`llm.logout` cancels a running login, rejects any pending prompt, delegates credential deletion to the adapter, and removes the retained operation. Later requests require another login unless the route also has independently configured authentication.

Unknown routes and unsupported methods fail before interaction begins. Device-flow denial, expiry, cancellation, network failure, storage failure, corrupt stored JSON, and refresh failure surface as provider or credential errors without returning tokens. Corrupt documents remain removable through logout.

ApiProxy keeps at most 32 non-secret notifications and one retained operation per provider. Starting a new flow replaces that provider's terminal operation, which bounds Host memory by provider count.

## Architecture assessment

The provider conforms to the repository's plugin architecture:

- provider authentication extends the registered `ctx.llm` adapter instead of introducing a GitHub service or modifying the loop;
- GitHub protocol and credential serialization remain provider-owned, while `ctx.credentials` owns secret persistence;
- Host RPC and Web settings depend only on provider-neutral LLM authentication types;
- OAuth interaction is not model-visible and therefore does not add session events; model requests retain their existing logged provider and model provenance;
- API-key adapters inherit empty authentication methods and keep their existing behavior.

The deliberate limitations are process-local refresh serialization and process-local authentication operations. They do not weaken plugin replacement or expose secrets, but deployments that share one credential store across processes need a backing provider with stronger locking.

## Verification ownership

Storage parsing, versioning, serialization, deletion, and concurrent modification belong to [`credential-store.spec.ts`](../../packages/llm/llm-pi-ai/tests/credential-store.spec.ts). Adapter registration and provider authentication routing belong to the `dsh-llm` and `dsh-llm-pi-ai` package tests. Operation recovery, prompts, cancellation, bounded events, logout, and wire validation belong to the ApiProxy tests. Models settings tests cover Device OAuth rendering, polling, page recovery, prompt responses, cancellation, and logout. The assembled Web snapshot proves that a real profile exposes the provider flow without requiring live credentials.