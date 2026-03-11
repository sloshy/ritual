import { useState } from 'preact/hooks'

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

export function AuthGuard(props: AuthGuardProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [showTotp, setShowTotp] = useState(props.totpEnabled === true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isLogin = props.isLogin === true

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError(null)

    if (!username || !password) {
      setError('Username and password are required')
      return
    }

    if (!isLogin && password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }

    setLoading(true)

    try {
      if (isLogin) {
        const body: Record<string, string> = { username, password }
        if (totpCode) {
          body.totpCode = totpCode
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
            if (data.totpRequired && !showTotp) {
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
          body: JSON.stringify({ username, password }),
          credentials: 'same-origin',
        })
        const data = (await resp.json()) as { success: boolean; message: string }
        if (data.success) {
          // After setup, log in to create a session
          const loginResp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
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
    <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: var(--bg-body);">
      <div style="background: var(--bg-panel); padding: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border); width: 100%; max-width: 24rem; margin: 0 1rem;">
        <h1 style="font-size: 1.25rem; font-weight: 700; color: var(--text-accent); margin-bottom: 0.25rem; text-align: center;">
          ⚗️ Ritual Admin
        </h1>
        <p style="color: var(--text-muted); font-size: 0.8125rem; text-align: center; margin-bottom: 1rem;">
          {isLogin ? 'Sign in to continue' : 'Create your admin account'}
        </p>
        {error && <div class="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style="margin-bottom: 0.75rem;">
            <label class="form-label">Username</label>
            <input
              type="text"
              class="form-input"
              value={username}
              onInput={(e) => setUsername(e.currentTarget.value)}
              autoFocus
            />
          </div>
          <div style="margin-bottom: 0.75rem;">
            <label class="form-label">Password</label>
            <input
              type="password"
              class="form-input"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </div>
          {showTotp && (
            <div style="margin-bottom: 0.75rem;">
              <label class="form-label">Two-Factor Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                class="form-input"
                style="letter-spacing: 0.15em; text-align: center; font-family: monospace;"
                value={totpCode}
                onInput={(e) => setTotpCode(e.currentTarget.value)}
                placeholder="000000"
                autoComplete="one-time-code"
              />
            </div>
          )}
          {!isLogin && (
            <p class="form-hint" style="margin-bottom: 0.75rem;">
              Password must be at least 4 characters.
            </p>
          )}
          <button type="submit" class="btn btn-primary" style="width: 100%;" disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
