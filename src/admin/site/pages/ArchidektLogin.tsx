import { type JSX, createSignal, onMount, Show, Switch, Match } from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from '../components/StatusAlerts'

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return 'less than a minute'
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  // Only bother with minute precision when the total is under a day.
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.join(', ')
}

function describeExpiry(expiration: string | null, valid: boolean): string {
  if (!expiration) return valid ? 'valid' : 'expiration unknown'
  const when = new Date(expiration).toLocaleString()
  const diff = new Date(expiration).getTime() - Date.now()
  if (diff > 0) {
    return `valid for ${formatDuration(diff)} (until ${when})`
  }
  return `expired ${formatDuration(-diff)} ago (on ${when})`
}

export function ArchidektLogin(): JSX.Element {
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const [status, setStatus] = createSignal<ArchidektLoginStatus | null>(null)
  const [statusLoading, setStatusLoading] = createSignal(true)
  const { status: actionStatus, error, loading, run } = useApiAction()

  const loadStatus = async () => {
    setStatusLoading(true)
    try {
      const resp = await fetch('/api/login/archidekt', { credentials: 'same-origin' })
      if (resp.ok) {
        setStatus((await resp.json()) as ArchidektLoginStatus)
      }
    } catch {
      // Leave the previous status in place; the login form still works.
    } finally {
      setStatusLoading(false)
    }
  }

  onMount(() => {
    void loadStatus()
  })

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
    if (ok) {
      setPassword('')
      await loadStatus()
    }
  }

  return (
    <div>
      <h2 class="section-heading">🔑 Archidekt Login</h2>
      <p class="page-desc">
        Sign in to your Archidekt account. Credentials are sent securely to the server for
        authentication.
      </p>

      <Show
        when={!statusLoading()}
        fallback={<p class="text-muted">Checking Archidekt login status…</p>}
      >
        <Show
          when={status()}
          fallback={<p class="text-muted">Could not load Archidekt login status.</p>}
        >
          {(s) => (
            <div class="archidekt-status">
              <Switch>
                <Match when={!s().loggedIn}>
                  <p class="text-muted">
                    Not signed in to Archidekt. Sign in below to use Archidekt account features.
                  </p>
                </Match>
                <Match when={s().loginRequired}>
                  <div class="alert alert-error">
                    Your Archidekt session has expired. A login is required to use Archidekt account
                    features.
                  </div>
                </Match>
                <Match when={!s().loginRequired}>
                  <div class="alert alert-success">
                    Signed in as {s().username ?? 'your Archidekt account'}.
                  </div>
                </Match>
              </Switch>
              <Show when={s().loggedIn}>
                <dl class="archidekt-status-list">
                  <div class="archidekt-status-row">
                    <dt>Current login (access token)</dt>
                    <dd class={s().accessTokenValid ? 'text-secondary' : 'text-muted'}>
                      {describeExpiry(s().accessTokenExpiration, s().accessTokenValid)}
                    </dd>
                  </div>
                  <div class="archidekt-status-row">
                    <dt>Refresh token</dt>
                    <dd class={s().refreshTokenValid ? 'text-secondary' : 'text-muted'}>
                      {describeExpiry(s().refreshTokenExpiration, s().refreshTokenValid)}
                    </dd>
                  </div>
                </dl>
                <Show when={!s().accessTokenValid && s().refreshTokenValid}>
                  <p class="text-muted">
                    The access token has expired but will refresh automatically using the refresh
                    token.
                  </p>
                </Show>
              </Show>
            </div>
          )}
        </Show>
      </Show>

      <StatusAlerts status={actionStatus()} error={error()} />
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
