import { type JSX, createSignal } from 'solid-js'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'

export function ArchidektLogin(): JSX.Element {
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const { status, error, loading, run } = useApiAction()

  const handleLogin = async (e: Event) => {
    e.preventDefault()
    if (!username() || !password()) return
    const ok = await run(
      '/api/login/archidekt',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username(), password: password() }),
      },
      'Login failed',
    )
    if (ok) setPassword('')
  }

  return (
    <div>
      <h2 class="section-heading">🔑 Archidekt Login</h2>
      <p class="page-desc">
        Sign in to your Archidekt account. Credentials are sent securely to the server for
        authentication.
      </p>
      <StatusAlerts status={status()} error={error()} />
      <form onSubmit={(e) => void handleLogin(e)} class="form-container">
        <div>
          <label class="form-label">Username or Email</label>
          <input
            type="text"
            class="form-input"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="form-label">Password</label>
          <input
            type="password"
            class="form-input"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={loading() || !username() || !password()}
        >
          {loading() ? 'Logging in...' : 'Login to Archidekt'}
        </button>
      </form>
    </div>
  )
}
