/** Authentication inspection uses only active adapter registrations. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '../src/index.ts'

class Adapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('authentication inspection must not start inference')
  }
}

let context: Context | undefined
afterEach(async () => { await context?.fiber.dispose(); context = undefined })
async function setup() {
  context = new Context()
  await context.plugin(LlmRuntime)
  return context.llm
}

it('does not infer authentication from registration or a configurable directory entry', async () => {
  const llm = await setup()
  expect(await llm.hasConfiguredAuth()).toBe(false)
  llm.registerConfigurableProviders([{ provider: 'dormant', displayName: 'Dormant', settingsNs: 'test', settingsPath: [] }])
  llm.registerAdapter(['uninspected'], new Adapter())
  expect(await llm.hasConfiguredAuth()).toBe(false)
})

it('inspects active routes and forgets authentication when their registration is disposed', async () => {
  const llm = await setup()
  const adapter = new Adapter()
  const inspect = vi.spyOn(adapter, 'hasConfiguredAuth').mockImplementation(async provider => provider === 'oauth')
  const registration = llm.registerAdapter(['missing', 'oauth'], adapter)
  expect(await llm.hasConfiguredAuth()).toBe(true)
  expect(inspect.mock.calls).toEqual([['missing'], ['oauth']])
  registration()
  expect(await llm.hasConfiguredAuth()).toBe(false)
  expect(inspect).toHaveBeenCalledTimes(2)
})

it.each(['dispose', 'replace'] as const)('discards a pending positive result after route %s', async (action) => {
  const llm = await setup()
  const adapter = new Adapter()
  const pending = Promise.withResolvers<boolean>()
  vi.spyOn(adapter, 'hasConfiguredAuth').mockReturnValueOnce(pending.promise).mockResolvedValue(false)
  const registration = llm.registerAdapter(['oauth'], adapter)
  const checking = llm.hasConfiguredAuth()
  if (action === 'dispose') registration()
  else registration.replace(['oauth'])
  pending.resolve(true)
  expect(await checking).toBe(false)
})

it('propagates credential read failures rather than reporting missing authentication', async () => {
  const llm = await setup()
  const adapter = new Adapter()
  vi.spyOn(adapter, 'hasConfiguredAuth').mockRejectedValue(new Error('credential store unavailable'))
  llm.registerAdapter(['oauth'], adapter)
  await expect(llm.hasConfiguredAuth()).rejects.toThrow('credential store unavailable')
})
