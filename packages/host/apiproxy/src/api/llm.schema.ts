/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ConfigurableProviderView, DiscoveredModelView } from './llm.ts'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  active: z.boolean(),
  declared: z.boolean().optional(),
  authMethods: z.array(z.literal('oauth')).optional(),
}) satisfies z.ZodType<Wire<ConfigurableProviderView>>

const llmAuthEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('info'),
    message: z.string(),
    links: z.array(z.object({ url: z.string(), label: z.string().optional() })).optional(),
  }),
  z.object({ type: z.literal('auth_url'), url: z.string(), instructions: z.string().optional() }),
  z.object({
    type: z.literal('device_code'),
    userCode: z.string(),
    verificationUri: z.string(),
    intervalSeconds: z.number().optional(),
    expiresInSeconds: z.number().optional(),
  }),
  z.object({ type: z.literal('progress'), message: z.string() }),
])

const llmAuthPromptViewSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['text', 'secret', 'manual_code', 'select']),
  message: z.string(),
  placeholder: z.string().optional(),
  options: z.array(z.object({
    id: z.string(), label: z.string(), description: z.string().optional(),
  })).optional(),
})

/** Browser-safe provider login operation view. */
export const llmAuthOperationViewSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled']),
  events: z.array(llmAuthEventSchema),
  prompt: llmAuthPromptViewSchema.optional(),
  error: z.string().optional(),
})

/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.providers'>>>

/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
  providers: z.array(configurableProviderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.providers'>>>

/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.models'>>>

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.models'>>>

/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<DiscoveredModelView>>

/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.discoverModels'>>>

/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
  models: z.array(discoveredModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.discoverModels'>>>

/** llm.authStatus request payload. */
export const llmAuthStatusRequestSchema = z.object({ provider: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'llm.authStatus'>>>
/** llm.authStatus response value. */
export const llmAuthStatusValueSchema = z.object({
  status: z.object({ type: z.enum(['api_key', 'oauth']), source: z.string().optional() }).optional(),
  operation: llmAuthOperationViewSchema.optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.authStatus'>>>
/** llm.startAuth request payload. */
export const llmStartAuthRequestSchema = z.object({ provider: z.string().min(1), type: z.literal('oauth') }) satisfies z.ZodType<Wire<RequestPayload<'llm.startAuth'>>>
/** llm.startAuth response value. */
export const llmStartAuthValueSchema = z.object({ operation: llmAuthOperationViewSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.startAuth'>>>
/** llm.authOperation request payload. */
export const llmAuthOperationRequestSchema = z.object({ id: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'llm.authOperation'>>>
/** llm.authOperation response value. */
export const llmAuthOperationValueSchema = z.object({ operation: llmAuthOperationViewSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.authOperation'>>>
/** llm.respondAuth request payload. */
export const llmRespondAuthRequestSchema = z.object({ id: z.string().min(1), promptId: z.string().min(1), value: z.string() }) satisfies z.ZodType<Wire<RequestPayload<'llm.respondAuth'>>>
/** llm.respondAuth response value. */
export const llmRespondAuthValueSchema = z.object({ operation: llmAuthOperationViewSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.respondAuth'>>>
/** llm.cancelAuth request payload. */
export const llmCancelAuthRequestSchema = z.object({ id: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'llm.cancelAuth'>>>
/** llm.cancelAuth response value. */
export const llmCancelAuthValueSchema = z.object({ operation: llmAuthOperationViewSchema }) satisfies z.ZodType<Wire<ResponseValue<'llm.cancelAuth'>>>
/** llm.logout request payload. */
export const llmLogoutRequestSchema = z.object({ provider: z.string().min(1) }) satisfies z.ZodType<Wire<RequestPayload<'llm.logout'>>>
/** llm.logout response value. */
export const llmLogoutValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'llm.logout'>>>
