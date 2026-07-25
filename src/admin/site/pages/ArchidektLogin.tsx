import { type JSX, createSignal, onMount, Show } from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import { ArchidektLoginForm, ArchidektSessionAlert } from '../components/ArchidektSession'
import { formatDuration } from '../../../utils'

function describeExpiry(expiration: string | null, valid: boolean): string {
  if (!expiration) return valid ? 'valid' : 'expiration unknown'
  const expiresAt = new Date(expiration)
  const when = expiresAt.toLocaleString()
  const diff = expiresAt.getTime() - Date.now()
  if (diff > 0) {
    return `valid for ${formatDuration(diff)} (until ${when})`
  }
  return `expired ${formatDuration(-diff)} ago (on ${when})`
}

export function ArchidektLogin(): JSX.Element {
  const [status, setStatus] = createSignal<ArchidektLoginStatus | null>(null)
  const [statusLoading, setStatusLoading] = createSignal(true)

  const loadStatus = async (): Promise<void> => {
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
              <ArchidektSessionAlert status={s()} />
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

      <ArchidektLoginForm onLoggedIn={() => void loadStatus()} />
    </div>
  )
}
