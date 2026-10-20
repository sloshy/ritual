import type { Component } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { FlameIcon } from '../../../site/FlameIcon'
import { useT } from '../../../ui/i18n'
import { apiMessage } from '../../../api/result'
import { readSyncMessage } from '../../../sync/message'
import { isRecord } from '../../../util/json'
import { useApiText } from '../hooks/useApiAction'
import type { ApiActionMessage } from '../../../api/result'
import { MIN_PASSWORD_LENGTH, SETUP_TOKEN_PARAM } from '../../validation'
import { COMMAND, commandLine } from '../../../util/cli-tokens'

interface AuthGuardSetupProps {
  onSetupComplete: () => void
  onLogin?: undefined
  isLogin?: undefined
  totpEnabled?: undefined
}

interface AuthGuardLoginProps {
  onSetupComplete?: undefined
  onLogin: () => void
  isLogin: true
  totpEnabled?: boolean
}

type AuthGuardProps = AuthGuardSetupProps | AuthGuardLoginProps

type RateLimitResponse = { retryAfterSeconds?: number }
/**
 * The setup token from the link `ritual admin` printed, removed from the address
 * bar once read so it does not linger in history or get shared with a
 * screenshot of the URL.
 */
function takeSetupTokenFromUrl(): string {
  const url = new URL(window.location.href)
  const token = url.searchParams.get(SETUP_TOKEN_PARAM) ?? ''
  if (token) {
    url.searchParams.delete(SETUP_TOKEN_PARAM)
    window.history.replaceState(window.history.state, '', url.toString())
  }
  return token
}

/** A refused response's own message, or `fallback` when its body says nothing usable. */
async function refusalOf(resp: Response, fallback: ApiActionMessage): Promise<ApiActionMessage> {
  try {
    return readSyncMessage(await resp.json()) ?? fallback
  } catch {
    return fallback
  }
}

export const AuthGuard: Component<AuthGuardProps> = (props) => {
  const t = useT()
  const heldText = useApiText()
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [totpCode, setTotpCode] = createSignal('')
  // Taken in either mode, so the link opened after an account exists does not
  // leave the (now useless) token sitting in the address bar either.
  const urlSetupToken = takeSetupTokenFromUrl()
  const [setupToken, setSetupToken] = createSignal(props.isLogin ? '' : urlSetupToken)
  const [showTotp, setShowTotp] = createSignal(props.totpEnabled === true)
  // Held unrendered and rendered in the JSX, so a language switch relabels an
  // error already on screen — the server's (keyed) refusal and the form's own.
  const [error, setError] = createSignal<ApiActionMessage | null>(null)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)

    if (!username() || !password()) {
      setError(apiMessage('admin.auth.credentialsRequired'))
      return
    }

    if (!props.isLogin && !setupToken().trim()) {
      setError(apiMessage('admin.auth.setupTokenRequired'))
      return
    }

    if (!props.isLogin && password().length < MIN_PASSWORD_LENGTH) {
      setError(apiMessage('admin.auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH }))
      return
    }

    setLoading(true)

    try {
      if (props.isLogin) {
        const body: Record<string, string> = { username: username(), password: password() }
        if (totpCode()) {
          body.totpCode = totpCode()
        }

        const resp = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
        })

        if (resp.ok) {
          props.onLogin()
        } else if (resp.status === 401) {
          try {
            const raw: unknown = await resp.json()
            const totpRequired = isRecord(raw) && raw.totpRequired === true
            if (totpRequired && !showTotp()) {
              setShowTotp(true)
              setError(apiMessage('admin.auth.totpRequired'))
            } else if (totpRequired) {
              setError(apiMessage('admin.auth.totpInvalid'))
            } else {
              setError(readSyncMessage(raw) ?? apiMessage('admin.auth.invalidCredentials'))
            }
          } catch {
            setError(apiMessage('admin.auth.invalidCredentials'))
          }
        } else if (resp.status === 429) {
          try {
            const data = (await resp.json()) as RateLimitResponse
            const secs = data.retryAfterSeconds ?? 300
            setError(apiMessage('admin.auth.rateLimited', { count: Math.ceil(secs / 60) }))
          } catch {
            setError(apiMessage('admin.auth.rateLimitedLater'))
          }
        } else {
          // A refusal the server words itself — a missing field (400), an
          // address its allow/deny lists turn away (403) — says so in its own
          // words rather than as a credentials failure.
          setError(await refusalOf(resp, apiMessage('admin.auth.invalidCredentials')))
        }
      } else {
        const resp = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username(),
            password: password(),
            setupToken: setupToken().trim(),
          }),
          credentials: 'same-origin',
        })
        // Keyed by the server (a wrong token, an account that already exists),
        // so it renders in the UI locale.
        const raw: unknown = await resp.json()
        if (isRecord(raw) && raw.success === true) {
          // After setup, log in to create a session
          const loginResp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username(), password: password() }),
            credentials: 'same-origin',
          })
          if (loginResp.ok) {
            props.onSetupComplete()
          } else {
            setError(apiMessage('admin.auth.setupLoginFailed'))
          }
        } else {
          setError(readSyncMessage(raw) ?? apiMessage('admin.app.requestFailed'))
        }
      }
    } catch {
      setError(apiMessage('admin.auth.connectionFailed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="login-page">
      <div class="login-card">
        <h1 class="login-title">
          <FlameIcon class="login-title-icon" />
          {t('admin.layout.title')}
        </h1>
        <p class="login-subtitle">
          {props.isLogin ? t('admin.auth.signInSubtitle') : t('admin.auth.createSubtitle')}
        </p>
        <Show when={error()}>
          {(current) => (
            <div class="alert alert-error" role="alert">
              {heldText(current())}
            </div>
          )}
        </Show>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div class="form-group">
            <label class="form-label" for="auth-username">
              {t('admin.auth.username')}
            </label>
            <input
              id="auth-username"
              type="text"
              class="form-input"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autocomplete="username"
              autofocus
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="auth-password">
              {t('admin.auth.password')}
            </label>
            <input
              id="auth-password"
              type="password"
              class="form-input"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete={props.isLogin ? 'current-password' : 'new-password'}
              aria-describedby={props.isLogin ? undefined : 'auth-password-hint'}
            />
            <Show when={!props.isLogin}>
              <p id="auth-password-hint" class="form-hint auth-hint">
                {t('admin.auth.passwordHint', { count: MIN_PASSWORD_LENGTH })}
              </p>
            </Show>
          </div>
          <Show when={!props.isLogin}>
            <div class="form-group">
              <label class="form-label" for="setup-token">
                {t('admin.auth.setupToken')}
              </label>
              <input
                id="setup-token"
                type="text"
                class="form-input"
                value={setupToken()}
                onInput={(e) => setSetupToken(e.currentTarget.value)}
                aria-describedby="setup-token-hint"
                autocomplete="off"
                autocapitalize="off"
                autocorrect="off"
                spellcheck={false}
              />
              <p id="setup-token-hint" class="form-hint">
                {t('admin.auth.setupTokenHint', { command: commandLine(COMMAND.admin) })}
              </p>
            </div>
          </Show>
          <Show when={showTotp()}>
            <div class="form-group">
              <label class="form-label" for="auth-totp">
                {t('admin.auth.totpCode')}
              </label>
              <input
                id="auth-totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                class="form-input input-code"
                value={totpCode()}
                onInput={(e) => setTotpCode(e.currentTarget.value)}
                placeholder="000000"
                autocomplete="one-time-code"
              />
            </div>
          </Show>
          <button type="submit" class="btn btn-primary btn-full" disabled={loading()}>
            {loading()
              ? t('admin.auth.pleaseWait')
              : props.isLogin
                ? t('admin.auth.signIn')
                : t('admin.auth.createAccount')}
          </button>
        </form>
      </div>
    </div>
  )
}
