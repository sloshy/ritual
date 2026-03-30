import type { Component } from 'solid-js'
import { createSignal, Show } from 'solid-js'

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

export const AuthGuard: Component<AuthGuardProps> = (props) => {
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [totpCode, setTotpCode] = createSignal('')
  const [showTotp, setShowTotp] = createSignal(props.totpEnabled === true)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)

    if (!username() || !password()) {
      setError('Username and password are required')
      return
    }

    if (!props.isLogin && password().length < 4) {
      setError('Password must be at least 4 characters')
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
            const data = (await resp.json()) as { totpRequired?: boolean; message?: string }
            if (data.totpRequired && !showTotp()) {
              setShowTotp(true)
              setError('Two-factor authentication code required')
            } else if (data.totpRequired) {
              setError('Invalid TOTP code')
            } else {
              setError(data.message ?? 'Invalid username or password')
            }
          } catch {
            setError('Invalid username or password')
          }
        } else if (resp.status === 429) {
          try {
            const data = (await resp.json()) as { retryAfterSeconds?: number }
            const secs = data.retryAfterSeconds ?? 300
            setError(`Too many failed attempts. Try again in ${Math.ceil(secs / 60)} minute(s).`)
          } catch {
            setError('Too many failed attempts. Try again later.')
          }
        } else {
          setError('Invalid username or password')
        }
      } else {
        const resp = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username(), password: password() }),
          credentials: 'same-origin',
        })
        const data = (await resp.json()) as { success: boolean; message: string }
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
            setError('Account created but login failed. Try signing in.')
          }
        } else {
          setError(data.message)
        }
      }
    } catch {
      setError('Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div class="login-page">
      <div class="login-card">
        <h1 class="login-title">⚗️ Ritual Admin</h1>
        <p class="login-subtitle">
          {props.isLogin ? 'Sign in to continue' : 'Create your admin account'}
        </p>
        <Show when={error()}>
          <div class="alert alert-error">{error()}</div>
        </Show>
        <form onSubmit={handleSubmit}>
          <div class="form-group">
            <label class="form-label">Username</label>
            <input
              type="text"
              class="form-input"
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autofocus
            />
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input
              type="password"
              class="form-input"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </div>
          <Show when={showTotp()}>
            <div class="form-group">
              <label class="form-label">Two-Factor Code</label>
              <input
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
          <Show when={!props.isLogin}>
            <p class="form-hint auth-hint">Password must be at least 4 characters.</p>
          </Show>
          <button type="submit" class="btn btn-primary btn-full" disabled={loading()}>
            {loading() ? 'Please wait...' : props.isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
