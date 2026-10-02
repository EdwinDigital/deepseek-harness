/** Provider authentication inspection never refreshes a stored OAuth grant. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { PiAiAdapter, type PiAiAdapterOptions } from '../src/adapter.ts'
import { authContextFrom, credentialStoreFrom, recordKeyFor } from '../src/auth.ts'
import { resolveProfiles, type PiAiProviderProfile } from '../src/config.ts'

let directory: string | undefined
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
  vi.restoreAllMocks()
})

async function stored() {
  directory ??= await mkdtemp(join(tmpdir(), 'dsh-auth-configured-'))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(directory, '.credentials.yaml'), watch: false })
  return ctx
}

function adapter(ctx: Context, providers: Record<string, PiAiProviderProfile> = { 'github-copilot': {} },
  resolveApiKey: PiAiAdapterOptions['resolveApiKey'] = async () => undefined) {
  const profiles = resolveProfiles(providers)
  return new PiAiAdapter({
    profiles: () => profiles, resolveApiKey,
    auth: { credentials: credentialStoreFrom(ctx), authContext: { ...authContextFrom(ctx), env: async () => undefined } },
  })
}

const grant = { kind: 'grant' as const, payload: { type: 'oauth', access: 'expired-access', refresh: 'long-lived-refresh', expires: 1 } }

it('reads Copilot OAuth after reopening the store without network, refresh, or credential writes', async () => {
  const writer = await stored()
  await writer.credentials.modifyRecord(recordKeyFor('github-copilot'), async () => grant)
  await writer.fiber.dispose()
  const ctx = await stored()
  const filename = join(directory!, '.credentials.yaml')
  const before = await readFile(filename)
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('authentication inspection must stay offline'))
  const mutate = vi.spyOn(ctx.credentials, 'modifyRecord')
  const provider = adapter(ctx)
  expect(await provider.hasConfiguredAuth('github-copilot')).toBe(true)
  expect(network).not.toHaveBeenCalled()
  expect(mutate).not.toHaveBeenCalled()
  expect(await readFile(filename)).toEqual(before)
  await ctx.credentials.deleteRecord(recordKeyFor('github-copilot'))
  expect(await provider.hasConfiguredAuth('github-copilot')).toBe(false)
})

it('does not accept another provider grant or a search credential', async () => {
  const ctx = await stored()
  await ctx.credentials.modifyRecord(credentialKey('client-connection', 'browser-session'), async () => grant)
  await ctx.credentials.modifyRecord(recordKeyFor('openai-codex'), async () => grant)
  await ctx.credentials.set(credentialRef('WEBIQ_API_KEY'), 'search-only')
  expect(await adapter(ctx).hasConfiguredAuth('github-copilot')).toBe(false)
})

it('preserves explicit reference precedence over stored OAuth', async () => {
  const ctx = await stored()
  await ctx.credentials.modifyRecord(recordKeyFor('github-copilot'), async () => grant)
  const resolve = vi.fn<PiAiAdapterOptions['resolveApiKey']>().mockResolvedValue('explicit-key')
  const provider = adapter(ctx, { 'github-copilot': { apiKeyEnv: 'EXPLICIT_KEY' } }, resolve)
  expect(await provider.hasConfiguredAuth('github-copilot')).toBe(true)
  resolve.mockRejectedValueOnce(new LlmError('missing explicit key', 'MISSING_CREDENTIAL'))
  expect(await provider.hasConfiguredAuth('github-copilot')).toBe(false)
  resolve.mockResolvedValueOnce(undefined)
  expect(await provider.hasConfiguredAuth('github-copilot')).toBe(false)
  resolve.mockRejectedValueOnce(new LlmError('invalid explicit key', 'INVALID_CREDENTIAL'))
  await expect(provider.hasConfiguredAuth('github-copilot')).rejects.toThrow('invalid explicit key')
})

it('propagates storage failure without reporting a missing login', async () => {
  const ctx = await stored()
  vi.spyOn(ctx.credentials, 'readRecord').mockRejectedValue(new Error('storage offline'))
  await expect(adapter(ctx).hasConfiguredAuth('github-copilot')).rejects.toThrow('storage offline')
})

it('recognizes configured keyless custom endpoints without a credential', async () => {
  const ctx = await stored()
  const provider = adapter(ctx, { local: {
    api: 'openai-completions', baseURL: 'http://127.0.0.1:8080/v1',
    models: [{ id: 'example' }],
  } })
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not contact the endpoint'))
  expect(await provider.hasConfiguredAuth('local')).toBe(true)
  expect(network).not.toHaveBeenCalled()
})
