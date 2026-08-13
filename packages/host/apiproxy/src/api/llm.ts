/**
 * llm domain contract: host-scoped provider topology for configuration
 * surfaces. `llm.providers` merges the configurable-provider directory
 * (which providers CAN be configured, and where their settings live) with the
 * live route registry; `llm.models` is the session-independent model catalog
 * (the same groups as `session.models`, without a per-session selection).
 * Clients invalidate from the forwarded `llm/adapters-updated` and
 * `settings/document-updated` owner events.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ModelCatalogFailure, ModelProviderGroup } from './sessions.ts'
import type { LlmAuthEvent, LlmInteractiveAuthType, LlmProviderAuthStatus } from '@deepseek-ai/dsh-llm/types'

/** Wire view of one configurable provider. */
export interface ConfigurableProviderView {
  /** Provider route key (`deepseek-official`, `openai`, …). */
  provider: string
  /** Human-readable name for configuration surfaces. */
  displayName: string
  /** Settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  settingsPath: string[]
  /** Whether the route is currently registered (its models are requestable). */
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. Absent when the adapter draws no such distinction, so a
   * surface must treat absence as "unknown", not as "shipped".
   */
  declared?: boolean
  /** Interactive authentication methods supported by the live route. */
  authMethods?: LlmInteractiveAuthType[]
}

/** Browser-safe prompt currently awaiting a user response. */
export interface LlmAuthPromptView {
  id: string
  type: 'text' | 'secret' | 'manual_code' | 'select'
  message: string
  placeholder?: string
  options?: { id: string; label: string; description?: string }[]
}

/** Recoverable state of one provider login operation. */
export interface LlmAuthOperationView {
  id: string
  provider: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  events: LlmAuthEvent[]
  prompt?: LlmAuthPromptView
  error?: string
}

/** Llm-domain unary methods (the map keys llm.* of RpcMethodMap). */
export interface LlmApi {
  /**
   * List every configurable provider with its live/dormant state, in
   * directory declaration order. Routes registered outside the directory
   * (an adapter that never declared configurability) are appended with their
   * registration identity and no settings address.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>>

  /**
   * Host-scoped model catalog over every registered provider route: the
   * settings surface's models view, needing no session. Per-provider listing
   * failures ride `failures` without failing the sound groups.
   */
  models(request: RpcRequest<{}>): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>>

  /**
   * Interrogate a provider endpoint the configuration surface is still
   * drafting, and return the models it advertises for the user to adopt.
   *
   * The payload is the draft, not a stored route: `settingsNs` selects the
   * adapter family that answers, and the rest comes from the form. `provider`
   * names the route being edited when there is one — an adapter that already
   * describes that route answers from its own registry, with better metadata
   * and no network call, and needs no endpoint. A route it does not describe is
   * asked over the wire, which is what `baseURL`, `api`, and `apiKey` are for.
   *
   * Nothing is written — the reply is candidates, and only a later
   * `settings.mutate` decides what a route serves. `apiKey` is accepted here
   * but never stored or returned; a provider whose key is already stored omits
   * it and the endpoint answers unauthenticated or refuses.
   */
  discoverModels(
    request: RpcRequest<{
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: DiscoveredModelView[] }>>

  /** Read the provider credential state and its most recent login operation. */
  authStatus(request: RpcRequest<{ provider: string }>): Promise<RpcResponse<{
    status?: LlmProviderAuthStatus
    operation?: LlmAuthOperationView
  }>>

  /** Start one provider-owned interactive login operation. */
  startAuth(request: RpcRequest<{
    provider: string
    type: LlmInteractiveAuthType
  }>): Promise<RpcResponse<{ operation: LlmAuthOperationView }>>

  /** Read a login operation after start or page reconnection. */
  authOperation(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ operation: LlmAuthOperationView }>>

  /** Answer the prompt currently owned by a login operation. */
  respondAuth(request: RpcRequest<{
    id: string
    promptId: string
    value: string
  }>): Promise<RpcResponse<{ operation: LlmAuthOperationView }>>

  /** Cancel a running provider login operation. */
  cancelAuth(request: RpcRequest<{ id: string }>): Promise<RpcResponse<{ operation: LlmAuthOperationView }>>

  /** Remove the provider-owned OAuth credential. */
  logout(request: RpcRequest<{ provider: string }>): Promise<RpcResponse<{}>>
}

/** Wire view of one model an interrogated endpoint advertises. */
export interface DiscoveredModelView {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
