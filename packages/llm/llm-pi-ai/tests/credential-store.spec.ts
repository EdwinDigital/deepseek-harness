import { describe, expect, it } from 'vitest'
import { createModels, createProvider } from '@earendil-works/pi-ai'
import type {
  CredentialRef,
  ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import {
  HarnessCredentialStore,
  oauthCredentialRef,
} from '../src/credential-store.ts'

class MemorySecrets {
  readonly values = new Map<CredentialRef, string>()

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(
      value === undefined ? undefined : { value, source: 'memory' },
    )
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    this.values.set(ref, value)
    return Promise.resolve()
  }

  unset(ref: CredentialRef): Promise<void> {
    this.values.delete(ref)
    return Promise.resolve()
  }
}

const first = {
  type: 'oauth' as const,
  refresh: 'refresh-1',
  access: 'access-1',
  expires: 1,
}
const second = {
  type: 'oauth' as const,
  refresh: 'refresh-2',
  access: 'access-2',
  expires: 2,
}

describe('HarnessCredentialStore', () => {
  it('persists and restores a versioned OAuth document', async () => {
    const secrets = new MemorySecrets()
    const store = new HarnessCredentialStore(
      () => secrets,
      () => ['github-copilot'],
    )

    await expect(
      store.modify('github-copilot', async (current) => {
        expect(current).toBeUndefined()
        return first
      }),
    ).resolves.toEqual(first)

    await expect(store.read('github-copilot')).resolves.toEqual(first)
    await expect(store.list()).resolves.toEqual([
      { providerId: 'github-copilot', type: 'oauth' },
    ])
    expect(
      JSON.parse(
        secrets.values.get(oauthCredentialRef('github-copilot')) ?? '',
      ),
    ).toEqual({
      version: 1,
      credential: first,
    })
  })

  it('serializes modifications and returns the lock-held current value for a skipped write', async () => {
    const secrets = new MemorySecrets()
    const store = new HarnessCredentialStore(
      () => secrets,
      () => ['github-copilot'],
    )
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })

    const write = store.modify('github-copilot', async () => {
      await blocked
      return first
    })
    const observe = store.modify('github-copilot', async (current) => {
      expect(current).toEqual(first)
      return undefined
    })
    release?.()

    await expect(write).resolves.toEqual(first)
    await expect(observe).resolves.toEqual(first)
  })

  it('rejects corrupt documents and non-OAuth writes', async () => {
    const secrets = new MemorySecrets()
    const store = new HarnessCredentialStore(
      () => secrets,
      () => ['github-copilot'],
    )
    secrets.values.set(oauthCredentialRef('github-copilot'), '{')

    await expect(store.read('github-copilot')).rejects.toThrow(
      /not valid JSON/,
    )
    secrets.values.clear()
    await expect(
      store.modify('github-copilot', async () => ({
        type: 'api_key',
        key: 'key',
      })),
    ).rejects.toThrow(/accepts OAuth credentials only/)
  })

  it('deletes without parsing a corrupt document', async () => {
    const secrets = new MemorySecrets()
    const store = new HarnessCredentialStore(
      () => secrets,
      () => ['github-copilot'],
    )
    secrets.values.set(oauthCredentialRef('github-copilot'), 'corrupt')

    await expect(store.delete('github-copilot')).resolves.toBeUndefined()
    expect(secrets.values).toEqual(new Map())
  })

  it('requires the credentials service only for writes', async () => {
    const store = new HarnessCredentialStore(
      () => undefined,
      () => ['github-copilot'],
    )

    await expect(store.read('github-copilot')).resolves.toBeUndefined()
    await expect(
      store.modify('github-copilot', async () => second),
    ).rejects.toThrow(/requires the credentials service/)
    await expect(store.delete('github-copilot')).resolves.toBeUndefined()
  })

  it('persists Models login and refreshes one expired credential once across concurrent reads', async () => {
    const secrets = new MemorySecrets()
    const store = new HarnessCredentialStore(
      () => secrets,
      () => ['github-copilot'],
    )
    const models = createModels({ credentials: store })
    let refreshCalls = 0
    const loggedIn = {
      type: 'oauth' as const,
      refresh: 'refresh-login',
      access: 'access-login',
      expires: Date.now() + 60_000,
    }
    models.setProvider(
      createProvider({
        id: 'github-copilot',
        auth: {
          oauth: {
            name: 'GitHub Copilot',
            login: () => Promise.resolve(loggedIn),
            refresh: () => {
              refreshCalls += 1
              return Promise.resolve({
                type: 'oauth',
                refresh: 'refresh-next',
                access: 'access-next',
                expires: Date.now() + 60_000,
              })
            },
            toAuth: credential =>
              Promise.resolve({
                headers: { Authorization: `Bearer ${credential.access}` },
              }),
          },
        },
        models: [],
        api: {
          stream: () => {
            throw new Error('not exercised')
          },
          streamSimple: () => {
            throw new Error('not exercised')
          },
        },
      }),
    )

    await expect(
      models.login('github-copilot', 'oauth', {
        prompt: () => Promise.reject(new Error('not exercised')),
        notify: () => undefined,
      }),
    ).resolves.toEqual(loggedIn)
    await expect(store.read('github-copilot')).resolves.toEqual(loggedIn)

    await store.modify('github-copilot', async () => ({
      ...loggedIn,
      expires: Date.now() - 1,
    }))
    const [left, right] = await Promise.all([
      models.getAuth('github-copilot'),
      models.getAuth('github-copilot'),
    ])

    expect(refreshCalls).toBe(1)
    expect(left?.auth.headers).toEqual({ Authorization: 'Bearer access-next' })
    expect(right?.auth.headers).toEqual({
      Authorization: 'Bearer access-next',
    })
    await expect(store.read('github-copilot')).resolves.toMatchObject({
      type: 'oauth',
      refresh: 'refresh-next',
      access: 'access-next',
    })
  })
})
