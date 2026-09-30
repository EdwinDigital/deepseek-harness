# GitHub Copilot provider

English | [中文](github-copilot-provider.zh.md)

The `github-copilot` route uses pi-ai's GitHub Device OAuth implementation. The [LLM subsystem](llm-streaming.md) owns model routing; the [credentials subsystem](credentials.md) owns credential records and authorization flows. This page describes how those plugins serve this provider.

## Plugin responsibilities

The implementation extends existing plugin services rather than adding provider behavior to the agent loop.

| Plugin | Responsibility |
|---|---|
| [`dsh-llm`](../../packages/llm/llm/README.md) | Routes model requests to the registered adapter. |
| [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) | Registers model routes and authorization flows, delegates the GitHub protocol to pi-ai, and adapts its credential store. |
| [`dsh-credentials`](../../packages/credentials/credentials/README.md) | Persists scoped credential records and owns serialized record updates. |
| [`dsh-authorization`](../../packages/credentials/authorization/README.md) | Registers login methods, routes notices and prompts to the caller, and confirms a credential commit before reporting success. |
| [`dsh-client-ui-settings-models`](../../packages/client/ui-settings-models/README.md) | Configures provider routes and model catalogs, with extension slots for additional provider controls. |

The adapter owns the provider protocol, while authorization is independent of model execution. Registrations use Cordis effects and unload with their plugin. No GitHub-specific branch enters `dsh-agent-loop`.

## Login flow

1. The pi-ai plugin registers the `llm-pi-ai/github-copilot` authorization flow independently of whether a model route is configured.
2. A caller starts the flow through `ctx.authorization.begin()` with the `oauth` method and its own interaction callbacks.
3. The authorization service validates the method and allows only one attempt per credential key. The flow runs pi-ai's login with the attempt's cancellation signal.
4. pi-ai emits the GitHub verification URL and user code, handles prompts, exchanges the approved device code, and writes the credential through `credentialStoreFrom()`.
5. The authorization service reports `authorized` only after observing a credential commit during the attempt. The configured model route reads that stored credential on later requests.

The caller receives notices, prompts, and an authorization outcome rather than the stored OAuth grant. Interaction belongs to the request that started it. Attempts are not resumable: reloading a browser during login abandons the attempt, and the user must start again.

## Credential storage and refresh

The adapter stores the OAuth grant as an opaque `grant` record at `llm-pi-ai/github-copilot`. Provider configuration contains route settings and optional credential references, not OAuth tokens. The [pi-ai package](../../packages/llm/llm-pi-ai/README.md) owns the sign-in contract.

Each pi-ai model collection uses the same Harness credential adapter. A route's explicit `apiKeyEnv` override takes precedence over the stored sign-in. Without that override, pi-ai reads and refreshes the stored grant as required.

Credential refresh runs inside `ctx.credentials.modifyRecord()`, whose local provider holds a cross-process lock across the update. The [credential-store documentation](../../packages/credentials/credentials/README.md) defines persistence and locking obligations.

## Logout and failure behavior

`ctx.authorization.cancel(key)` withdraws an active attempt. Signing out is `ctx.credentials.deleteRecord(key)`: it forgets the local grant without revoking it at GitHub. Independently configured credentials remain separate from that record.

Unknown flows, unsupported methods, and concurrent attempts fail before a new interaction starts. A declined prompt or withdrawn request settles as `cancelled`; network, storage, and provider failures remain errors. The authorization service rejects a flow that returns without committing a credential.

Cancellation and local record deletion are separate operations. Their lifecycle rules belong to the [authorization package](../../packages/credentials/authorization/README.md).

## Architecture assessment

The provider conforms to the repository's plugin architecture:

- model execution remains on `ctx.llm`, while interactive credential acquisition uses `ctx.authorization`;
- GitHub protocol and grant serialization remain provider-owned, while `ctx.credentials` owns persistence and locking;
- authorization callers render provider-neutral notices and prompts rather than implementing the GitHub protocol;
- OAuth interaction is not model-visible and does not add session events;
- API-key references, stored grants, and provider-native discovery follow the adapter's documented precedence.

Attempts are process-local and cannot be resumed. Local sign-out does not revoke access at the issuer. Those limits are shared authorization behavior, not GitHub-specific exceptions.

## Verification ownership

The pi-ai adapter, authorization service, and credential provider own tests for protocol adaptation, interaction cancellation, commit confirmation, persistence, and refresh locking. A live GitHub login additionally requires an authorized account; keyless tests do not establish that an account can access Copilot.