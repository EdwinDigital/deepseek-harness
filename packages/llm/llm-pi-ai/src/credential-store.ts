/**
 * pi-ai OAuth credential persistence over the Harness credential-reference
 * service. The store accepts OAuth credentials only: API keys keep their
 * existing profile-owned `apiKeyEnv` path.
 * @module dsh-llm-pi-ai/credential-store
 */

import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  OAuthCredential,
} from '@earendil-works/pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  CredentialProvider,
  CredentialRef,
} from '@deepseek-ai/dsh-credentials'

/** Versioned secret document stored behind one Harness credential reference. */
interface StoredOAuthDocument {
  version: 1
  credential: OAuthCredential
}

/** Credential operations the adapter needs from the configured provider. */
type SecretStore = Pick<CredentialProvider, 'resolve' | 'set' | 'unset'>

/** Return whether `value` is a non-null JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse one complete stored OAuth document or reject the corrupt secret. */
function parseDocument(providerId: string, source: string): OAuthCredential {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `llm-pi-ai: stored OAuth credential for "${providerId}" is not valid JSON`,
      { cause: error },
    )
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !isRecord(parsed.credential)
  ) {
    throw new Error(
      `llm-pi-ai: stored OAuth credential for "${providerId}" has an unsupported document format`,
    )
  }
  const credential = parsed.credential
  if (
    credential.type !== 'oauth' ||
    typeof credential.refresh !== 'string' ||
    credential.refresh.length === 0 ||
    typeof credential.access !== 'string' ||
    credential.access.length === 0 ||
    typeof credential.expires !== 'number' ||
    !Number.isFinite(credential.expires)
  ) {
    throw new Error(
      `llm-pi-ai: stored OAuth credential for "${providerId}" is incomplete`,
    )
  }
  return credential as OAuthCredential
}

/** Require pi-ai writes to remain in the OAuth credential plane. */
function requireOAuth(
  providerId: string,
  credential: Credential,
): OAuthCredential {
  if (credential.type !== 'oauth') {
    throw new Error(
      `llm-pi-ai: credential store for "${providerId}" accepts OAuth credentials only`,
    )
  }
  if (
    credential.refresh.length === 0 ||
    credential.access.length === 0 ||
    !Number.isFinite(credential.expires)
  ) {
    throw new Error(
      `llm-pi-ai: OAuth credential for "${providerId}" is incomplete`,
    )
  }
  return credential
}

/**
 * Deterministic, collision-free Harness reference for one pi-ai provider route.
 * Encoding Unicode code points keeps arbitrary route ids inside the credential
 * service's POSIX-identifier vocabulary without lossy punctuation replacement.
 * @param providerId - provider route key.
 * @returns the private reference used for its OAuth document.
 */
export function oauthCredentialRef(providerId: string): CredentialRef {
  if (providerId.length === 0)
    throw new Error(
      'llm-pi-ai: OAuth credential provider id must be non-empty',
    )
  const encoded = Array.from(providerId, char =>
    char.codePointAt(0)?.toString(16),
  ).join('_')
  return credentialRef(`DSH_PI_AI_OAUTH_${encoded}`)
}

/**
 * pi-ai credential store backed by the active Harness credential provider.
 * `modify` and `delete` serialize per route in this process; the backing
 * provider remains responsible for persistence and any cross-process locking.
 */
export class HarnessCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<void>>()

  /**
   * @param resolveStore - resolves the current credential provider per operation.
   * @param providerIds - routes visible to `list()` without secret enumeration.
   */
  constructor(
    private readonly resolveStore: () => SecretStore | undefined,
    private readonly providerIds: () => readonly string[],
  ) {}

  /** Read and validate one stored OAuth credential. */
  async read(providerId: string): Promise<Credential | undefined> {
    const store = this.resolveStore()
    if (store === undefined) return undefined
    const resolved = await store.resolve(oauthCredentialRef(providerId))
    return resolved === undefined
      ? undefined
      : parseDocument(providerId, resolved.value)
  }

  /** List non-secret metadata for configured routes known to this adapter. */
  async list(): Promise<readonly CredentialInfo[]> {
    const entries: CredentialInfo[] = []
    for (const providerId of this.providerIds()) {
      if ((await this.read(providerId)) !== undefined)
        entries.push({ providerId, type: 'oauth' })
    }
    return entries
  }

  /** Serialize one read-modify-write and return the value held after it. */
  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.exclusive(providerId, async () => {
      const store = this.resolveStore()
      if (store === undefined) {
        throw new Error(
          `llm-pi-ai: OAuth for "${providerId}" requires the credentials service`,
        )
      }
      const current = await this.read(providerId)
      const proposed = await fn(current)
      if (proposed === undefined) return current
      const credential = requireOAuth(providerId, proposed)
      const document: StoredOAuthDocument = { version: 1, credential }
      await store.set(oauthCredentialRef(providerId), JSON.stringify(document))
      return credential
    })
  }

  /** Remove one route's OAuth document after earlier modifications settle. */
  delete(providerId: string): Promise<void> {
    return this.exclusive(providerId, async () => {
      const store = this.resolveStore()
      if (store === undefined) return
      await store.unset(oauthCredentialRef(providerId))
    })
  }

  /** Run one operation after the previous operation for the same route settles. */
  private exclusive<T>(
    providerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.chains.set(providerId, settled)
    void settled.then(() => {
      if (this.chains.get(providerId) === settled)
        this.chains.delete(providerId)
    })
    return result
  }
}
