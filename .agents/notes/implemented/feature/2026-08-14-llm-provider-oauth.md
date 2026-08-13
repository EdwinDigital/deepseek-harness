# Agent Note: LLM provider OAuth login and refresh

Status: implemented

English | [中文](2026-08-14-llm-provider-oauth.zh.md)

## Problem

An installed pi-ai provider can advertise OAuth and a static model catalog, but provider requests need durable login, expiry refresh, logout, and restart recovery. Storing a short-lived access token as an API key cannot provide those behaviors. OAuth credentials must remain secret, concurrent refresh must serialize, and the browser must never receive access or refresh tokens.

Provider-specific login protocol does not belong in the generic credentials service. That service owns durable reference-to-secret storage; the LLM adapter owns provider authentication behavior.

## Decision

The LLM service exposes optional provider authentication methods, non-secret status, login with caller-owned interaction callbacks, and logout. Configurable-provider entries advertise the methods supported by their live adapter. Adapters without interactive authentication keep the empty default implementation.

The pi-ai adapter injects one Harness-backed `CredentialStore` into every immutable `Models` snapshot. A deterministic reference derived from the provider route stores a versioned JSON document containing pi-ai's canonical OAuth credential through `ctx.credentials`. Reads parse and validate the complete document. `modify` serializes updates per provider route in-process before writing; `delete` removes the secret. API-key routes retain explicit `apiKeyEnv` resolution.

pi-ai owns login, expiry checks, locked refresh, credential rotation, request authentication, and logout. A stored OAuth credential remains the provider's authentication source until logout; refresh failure never falls back to an ambient API key. Replacement model snapshots share the credential store but not mutable provider registries.

ApiProxy represents each login as a bounded operation resource with a stable random id, status, at most 32 non-secret notifications, and at most one pending prompt. `startAuth` reuses a running operation for the provider; `authOperation` supports polling and page recovery; `respondAuth`, `cancelAuth`, and `logout` release pending callbacks. Starting a later operation replaces that provider's retained terminal operation, bounding Host memory by provider count. Tokens never enter operation views.

Web Models settings renders the generic operation. GitHub Device OAuth shows the verification URL and user code, opens the URL only after a user action, polls only while the operation runs, recovers the current operation after refresh, and offers cancellation and logout. OAuth routes count as usable only when their non-secret status reports configured authentication.

## Failure and lifecycle semantics

Unknown providers and unsupported methods fail before an interaction starts. Corrupt stored documents fail as credential-store errors and remain removable through logout. Device-flow denial, expiry, network failure, storage failure, and refresh failure preserve provider error text without logging or returning tokens. Cancellation aborts provider work and rejects a pending prompt; pi-ai leaves the pre-login credential unchanged unless login completed and stored a replacement.

One process serializes `CredentialStore.modify` per provider route, satisfying pi-ai's double-checked refresh protocol. Cross-process serialization remains the backing credential provider's responsibility. Two Harness processes sharing one home can perform duplicate refreshes when that provider supplies no stronger lock; each completed write is a valid canonical credential, and later requests observe the last writer.

## Alternatives considered

**Add OAuth methods to the credentials service.** Rejected because device flow, token exchange, refresh, and model availability are provider behavior. It would make a generic secret store know GitHub and pi-ai protocols.

**Add pi-ai-specific Host RPC methods.** Rejected because the Web client would depend on one adapter namespace and every future OAuth-capable adapter would require another protocol.

**Forward login through the global Host event stream.** Rejected because a recoverable operation resource carries the same prompts and progress without expanding the forwarded-event allowlist. Polling is limited to a running operation and a stable id restores state after reconnection.

**Persist only `COPILOT_GITHUB_TOKEN`.** Rejected because the Copilot access token is short-lived and cannot refresh without the provider OAuth credential and implementation.

## Consequences

The browser can complete provider Device OAuth and logout without receiving tokens. A successful login is durable through `ctx.credentials`; a new Harness process can resolve and refresh it. Concurrent `Models.getAuth()` calls with one expired credential execute one refresh in-process and persist rotation before dispatch. API-key providers and explicit `apiKeyEnv` routes retain their behavior.

The generic LLM and ApiProxy APIs gain public interaction, operation-state, polling, and cancellation contracts. Serialized OAuth JSON increases the impact of credential-store disclosure but remains in the existing secret plane, outside settings and session logs. Harness relies on pi-ai for GitHub Device Flow and Copilot token-exchange compatibility.

Focused tests pin versioned storage validation, pi-ai login persistence, one-refresh concurrent resolution, Host operation recovery and cancellation, fetch-carrier schemas, and Web recovery of a running device-code operation.
