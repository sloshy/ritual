import type { Component } from 'solid-js'
import { createSignal, Show } from 'solid-js'
import { FlameIcon } from '../../../site/FlameIcon'
import { useT, useTDynamic } from '../../../ui/i18n'
import { renderApiMessage, type ApiResult } from '../../../api/result'
import { MIN_PASSWORD_LENGTH, SETUP_TOKEN_PARAM } from '../../validation'

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

type LoginErrorResponse = { totpRequired?: boolean; message?: string }
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

export const AuthGuard: Component<AuthGuardProps> = (props) => {
  const t = useT()
  const tDynamic = useTDynamic()
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [totpCode, setTotpCode] = createSignal('')
  // Taken in either mode, so the link opened after an account exists does not
  // leave the (now useless) token sitting in the address bar either.
  const urlSetupToken = takeSetupTokenFromUrl()
  const [setupToken, setSetupToken] = createSignal(props.isLogin ? '' : urlSetupToken)
  const [showTotp, setShowTotp] = createSignal(props.totpEnabled === true)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)

    if (!username() || !password()) {
      setError(t('admin.auth.credentialsRequired'))
      return
    }

    if (!props.isLogin && !setupToken().trim()) {
      setError(t('admin.auth.setupTokenRequired'))
      return
    }

    if (!props.isLogin && password().length < MIN_PASSWORD_LENGTH) {
      setError(t('admin.auth.passwordTooShort', { count: MIN_PASSWORD_LENGTH }))
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
            const data = (await resp.json()) as LoginErrorResponse
            if (data.totpRequired && !showTotp()) {
              setShowTotp(true)
              setError(t('admin.auth.totpRequired'))
            } else if (data.totpRequired) {
              setError(t('admin.auth.totpInvalid'))
            } else {
              setError(data.message ?? t('admin.auth.invalidCredentials'))
            }
          } catch {
            setError(t('admin.auth.invalidCredentials'))
          }
        } else if (resp.status === 429) {
          try {
            const data = (await resp.json()) as RateLimitResponse
            const secs = data.retryAfterSeconds ?? 300
            setError(t('admin.auth.rateLimited', { count: Math.ceil(secs / 60) }))
          } catch {
            setError(t('admin.auth.rateLimitedLater'))
          }
        } else {
          setError(t('admin.auth.invalidCredentials'))
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
        // Keyed by the server (a wrong token), so it renders in the UI locale.
        // A 403 from the IP/User-Agent lists is plain text and lands in `catch`.
        const data = (await resp.json()) as ApiResult
        if (data.success) {
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
            setError(t('admin.auth.setupLoginFailed'))
          }
        } else {
          setError(renderApiMessage(tDynamic, data))
        }
      }
    } catch {
      setError(t('admin.auth.connectionFailed'))
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
          <div class="alert alert-error" role="alert">
            {error()}
          </div>
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
                {t('admin.auth.setupTokenHint')}
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
