import { type JSX, createSignal, Match, Switch } from 'solid-js'
import type { ArchidektLoginStatus } from '../../../auth/interfaces'
import { useT } from '../../../ui/i18n'
import { apiMessage } from '../../api/result'
import { useApiAction } from '../hooks/useApiAction'
import { StatusAlerts } from './StatusAlerts'

interface SessionAlertProps {
  status: ArchidektLoginStatus
}

/**
 * The one-line verdict on the stored Archidekt session, shared by the Archidekt
 * Login page and any page that needs an account before it can act (Sync Decks).
 */
export function ArchidektSessionAlert(props: SessionAlertProps): JSX.Element {
  const t = useT()
  return (
    <Switch
      fallback={
        <div class="alert alert-success">
          {t('admin.archidekt.signedIn', {
            username: props.status.username ?? t('admin.archidekt.yourAccount'),
          })}
        </div>
      }
    >
      <Match when={!props.status.loggedIn}>
        <p class="text-muted">{t('admin.archidekt.notSignedIn')}</p>
      </Match>
      <Match when={props.status.loginRequired}>
        <div class="alert alert-error">{t('admin.archidekt.expired')}</div>
      </Match>
    </Switch>
  )
}

interface LoginFormProps {
  /** Called after a successful sign-in, so the host page can reload its status. */
  onLoggedIn: () => void
}

/**
 * Archidekt credential form. Credentials are posted to the admin server, which
 * performs the login and stores the token the CLI uses too.
 */
export function ArchidektLoginForm(props: LoginFormProps): JSX.Element {
  const t = useT()
  const [username, setUsername] = createSignal('')
  const [password, setPassword] = createSignal('')
  const { status, error, loading, run } = useApiAction()

  const handleLogin = async (e: Event): Promise<void> => {
    e.preventDefault()
    if (!username() || !password()) return
    const ok = await run(
      '/api/login/archidekt',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username(), password: password() }),
      },
      apiMessage('admin.archidekt.loginFailed'),
    )
    if (ok) {
      setPassword('')
      props.onLoggedIn()
    }
  }

  return (
    <>
      <StatusAlerts status={status()} error={error()} />
      <form onSubmit={(e) => void handleLogin(e)} class="form-container">
        <div>
          <label class="form-label">{t('admin.archidekt.usernameLabel')}</label>
          <input
            type="text"
            class="form-input"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
        </div>
        <div>
          <label class="form-label">{t('admin.archidekt.passwordLabel')}</label>
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
          {loading() ? t('admin.archidekt.loggingIn') : t('admin.archidekt.login')}
        </button>
      </form>
    </>
  )
}
