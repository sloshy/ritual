import { type JSX, createSignal, onMount, Show } from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import { ArchidektLoginForm, ArchidektSessionAlert } from '../components/ArchidektSession'
import { formatDuration } from '../../../util/duration'
import { formatDateTime } from '../../../ui/format'
import { useT } from '../../../ui/i18n'
import type { TranslateFn } from '../../../i18n/t'
import { PageHeading } from '../components/PageHeading'

/**
 * How a stored token's lifetime reads. Takes the translator rather than calling
 * `t` module-side, so the sentence is rebuilt when the locale changes.
 */
function describeExpiry(t: TranslateFn, expiration: string | null, valid: boolean): string {
  if (!expiration) {
    return valid ? t('admin.archidektPage.expiryValid') : t('admin.archidektPage.expiryUnknown')
  }
  const expiresAt = new Date(expiration)
  const when = formatDateTime(expiresAt)
  const diff = expiresAt.getTime() - Date.now()
  if (diff > 0) {
    return t('admin.archidektPage.expiresIn', { duration: formatDuration(diff), when })
  }
  return t('admin.archidektPage.expiredAgo', { duration: formatDuration(-diff), when })
}

export function ArchidektLogin(): JSX.Element {
  const t = useT()
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
      <PageHeading page="archidekt-login" />
      <p class="page-desc">{t('admin.archidektPage.desc')}</p>

      <Show
        when={!statusLoading()}
        fallback={<p class="text-muted">{t('admin.archidektPage.checking')}</p>}
      >
        <Show
          when={status()}
          fallback={<p class="text-muted">{t('admin.archidektPage.statusUnavailable')}</p>}
        >
          {(s) => (
            <div class="archidekt-status">
              <ArchidektSessionAlert status={s()} />
              <Show when={s().loggedIn}>
                <dl class="archidekt-status-list">
                  <div class="archidekt-status-row">
                    <dt>{t('admin.archidektPage.accessToken')}</dt>
                    <dd class={s().accessTokenValid ? 'text-secondary' : 'text-muted'}>
                      {describeExpiry(t, s().accessTokenExpiration, s().accessTokenValid)}
                    </dd>
                  </div>
                  <div class="archidekt-status-row">
                    <dt>{t('admin.archidektPage.refreshToken')}</dt>
                    <dd class={s().refreshTokenValid ? 'text-secondary' : 'text-muted'}>
                      {describeExpiry(t, s().refreshTokenExpiration, s().refreshTokenValid)}
                    </dd>
                  </div>
                </dl>
                <Show when={!s().accessTokenValid && s().refreshTokenValid}>
                  <p class="text-muted">{t('admin.archidektPage.willRefresh')}</p>
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
