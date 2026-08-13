import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  IApiClient,
  ResponseValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

type AuthOperation = NonNullable<ResponseValue<'llm.authStatus'>['operation']>
type AuthStatus = ResponseValue<'llm.authStatus'>['status']

export interface ProviderAuthControlProps {
  provider: string
  initialStatus: AuthStatus
  initialOperation: AuthOperation | undefined
  api: Pick<IApiClient, 'llm'>
  t: (key: keyof typeof en) => string
  onChanged: () => void
}

/** Provider-owned OAuth login rendered inside one Models provider row. */
export function ProviderAuthControl(
  props: ProviderAuthControlProps,
): ReactNode {
  const { llm } = props.api
  const [status, setStatus] = useState(props.initialStatus)
  const [operation, setOperation] = useState(props.initialOperation)
  const [promptValue, setPromptValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (operation?.status !== 'running') return
    let disposed = false
    const timer = window.setInterval(() => {
      void llm.authOperation({ id: operation.id }).then(
        (response) => {
          if (disposed || !response.result.ok) return
          const next = response.result.value.operation
          setOperation(next)
          if (next.status === 'succeeded') {
            void llm
              .authStatus({ provider: props.provider })
              .then((statusResponse) => {
                if (disposed || !statusResponse.result.ok) return
                setStatus(statusResponse.result.value.status)
                props.onChanged()
              })
          }
        },
        () => undefined,
      )
    }, 750)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [llm, operation?.id, operation?.status, props.onChanged, props.provider])

  const start = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await llm.startAuth({
        provider: props.provider,
        type: 'oauth',
      })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setOperation(response.result.value.operation)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    if (operation === undefined) return
    setBusy(true)
    try {
      const response = await llm.cancelAuth({ id: operation.id })
      if (response.result.ok) setOperation(response.result.value.operation)
      else setFailure(response.result.error.message)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const respond = async (): Promise<void> => {
    if (operation?.prompt === undefined) return
    setBusy(true)
    try {
      const response = await llm.respondAuth({
        id: operation.id,
        promptId: operation.prompt.id,
        value: promptValue,
      })
      if (response.result.ok) {
        setOperation(response.result.value.operation)
        setPromptValue('')
      } else {
        setFailure(response.result.error.message)
      }
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const response = await llm.logout({ provider: props.provider })
      if (!response.result.ok) {
        setFailure(response.result.error.message)
        return
      }
      setStatus(undefined)
      setOperation(undefined)
      props.onChanged()
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const device = operation?.events
    .slice()
    .reverse()
    .find(event => event.type === 'device_code')
  const authUrl = operation?.events
    .slice()
    .reverse()
    .find(event => event.type === 'auth_url')
  const latest = operation?.events.at(-1)
  const authenticated = status?.type === 'oauth'
  const promptNeedsValue = operation?.prompt !== undefined && operation.prompt.type !== 'text'

  return (
    <div className={styles['authControl']}>
      <div className={styles['authSummary']}>
        <span
          className={
            authenticated ? styles['authConnected'] : styles['authDisconnected']
          }
        >
          {authenticated
            ? props.t('oauthConnected')
            : props.t('oauthNotConnected')}
        </span>
        {authenticated ? (
          <button
            type="button"
            className={styles['linkButton']}
            disabled={busy}
            onClick={() => {
              void logout()
            }}
          >
            {props.t('oauthLogout')}
          </button>
        ) : operation?.status === 'running' ? (
          <button
            type="button"
            className={styles['linkButton']}
            disabled={busy}
            onClick={() => {
              void cancel()
            }}
          >
            {props.t('oauthCancel')}
          </button>
        ) : (
          <button
            type="button"
            className={styles['secondaryButton']}
            disabled={busy}
            onClick={() => {
              void start()
            }}
          >
            {busy ? props.t('oauthStarting') : props.t('oauthLogin')}
          </button>
        )}
      </div>
      {operation?.status === 'running' ? (
        <div className={styles['authFlow']} role="status">
          {device?.type === 'device_code' ? (
            <>
              <span className={styles['authInstruction']}>
                {props.t('oauthDeviceInstruction')}
              </span>
              <code className={styles['deviceCode']}>{device.userCode}</code>
              <a
                className={styles['authLink']}
                href={device.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                {props.t('oauthOpenGitHub')}
              </a>
            </>
          ) : authUrl?.type === 'auth_url' ? (
            <a
              className={styles['authLink']}
              href={authUrl.url}
              target="_blank"
              rel="noreferrer"
            >
              {props.t('oauthContinue')}
            </a>
          ) : null}
          {latest?.type === 'progress' || latest?.type === 'info' ? (
            <span className={styles['authProgress']}>{latest.message}</span>
          ) : (
            <span className={styles['authProgress']}>
              {props.t('oauthWaiting')}
            </span>
          )}
          {operation.prompt === undefined ? null : (
            <div className={styles['authPrompt']}>
              <label
                className={styles['fieldLabel']}
                htmlFor={`auth-${operation.prompt.id}`}
              >
                {operation.prompt.message}
              </label>
              {operation.prompt.type === 'select' ? (
                <select
                  id={`auth-${operation.prompt.id}`}
                  className={`${styles['input']} ${styles['selectInput']}`}
                  value={promptValue}
                  onChange={(event) => {
                    setPromptValue(event.target.value)
                  }}
                >
                  <option value="">
                    {operation.prompt.placeholder ?? props.t('oauthSelect')}
                  </option>
                  {operation.prompt.options?.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`auth-${operation.prompt.id}`}
                  className={styles['input']}
                  type={
                    operation.prompt.type === 'secret' ? 'password' : 'text'
                  }
                  value={promptValue}
                  placeholder={operation.prompt.placeholder}
                  onChange={(event) => {
                    setPromptValue(event.target.value)
                  }}
                />
              )}
              <button
                type="button"
                className={styles['primaryButton']}
                disabled={busy || (promptNeedsValue && promptValue.length === 0)}
                onClick={() => {
                  void respond()
                }}
              >
                {props.t('oauthSubmit')}
              </button>
            </div>
          )}
        </div>
      ) : null}
      {operation?.status === 'failed' ? (
        <p className={styles['error']}>
          {operation.error ?? props.t('oauthFailed')}
        </p>
      ) : null}
      {operation?.status === 'cancelled' ? (
        <p className={styles['authProgress']}>{props.t('oauthCancelled')}</p>
      ) : null}
      {failure === undefined ? null : (
        <p className={styles['error']}>{failure}</p>
      )}
    </div>
  )
}
