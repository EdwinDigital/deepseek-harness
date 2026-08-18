// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { TestRemote, stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { MicrosoftWebIqSettingsCard } from '../src/client/MicrosoftWebIqSettingsCard.tsx'
import type {
  MicrosoftWebIqClientSettings,
  WebRuntimeClientSettings,
} from '../src/client/controller.ts'
import { en, zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const remote = new TestRemote(ctx)
  const provider = stubSettingsScope<MicrosoftWebIqClientSettings>()
  const web = stubSettingsScope<WebRuntimeClientSettings>()
  ctx.provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }): SettingsScope<unknown> =>
      namespace === 'web-search-microsoft-webiq' ? provider.scope : web.scope,
  } as never)
  const describe = vi.fn(({ refs }: { refs: string[] }) => Promise.resolve({
    rpcId: 'credential-view' as never,
    result: {
      ok: true as const,
      value: { credentials: { [refs[0] ?? '']: { configured: false, writable: true } } },
    },
  }))
  ctx.provide('connection', {
    api: {
      credentials: {
        describe,
        set: vi.fn(() => Promise.resolve({
          rpcId: 'credential-write',
          result: { ok: true, value: {} },
        })),
      },
    },
  } as never)
  return { ctx, slots: ctx.slots, locale, remote, provider, web, describe }
}

function declareCardSlot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugin.item': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('Microsoft Web IQ browser plugin', () => {
  it('declares the browser services it uses and key-identical dictionaries', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('registers one package-local card with stable identity and order', async () => {
    const b = await bench()
    declareCardSlot(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const [entry] = b.slots.entries('settings.plugin.item')
    expect(entry?.component).toBe(MicrosoftWebIqSettingsCard)
    expect(entry?.options).toMatchObject({ id: 'web-search-microsoft-webiq', order: 30 })
    expect(entry?.locale).toBe(NS)
    expect(b.locale.bind(NS)('title')).toBe(zh.title)
    await b.ctx.fiber.dispose()
  })

  it('registers when the card slot is declared after plugin activation', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugin.item')).toHaveLength(0)

    declareCardSlot(b.slots)

    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugin.item')[0]?.component).toBe(MicrosoftWebIqSettingsCard)
    })
    await b.ctx.fiber.dispose()
  })

  it('refreshes the watched credential from the forwarded Host event', async () => {
    const b = await bench()
    declareCardSlot(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalled() })
    b.describe.mockClear()

    b.remote.$dispatch('credentials/updated', ['MICROSOFT_WEBIQ_API_KEY'])

    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
    await b.ctx.fiber.dispose()
  })

  it('removes the card, dictionaries, remote listener, and scope subscriptions on teardown', async () => {
    const b = await bench()
    declareCardSlot(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.provider.listenerCount()).toBe(1)
    expect(b.web.listenerCount()).toBe(1)

    await fiber.dispose()

    expect(b.slots.entries('settings.plugin.item')).toHaveLength(0)
    expect(b.provider.listenerCount()).toBe(0)
    expect(b.web.listenerCount()).toBe(0)
    expect(b.locale.bind(NS)('title')).not.toBe(zh.title)
    await b.ctx.fiber.dispose()
  })
})
