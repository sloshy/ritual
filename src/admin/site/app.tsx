import { render } from 'solid-js/web'
import { createSignal, onMount, onCleanup, batch, Switch, Match } from 'solid-js'
import type { Page, NavigateFn } from './types'
import type { ListType } from '../../list-type'
import { Layout } from './components/Layout'
import { AuthGuard } from './components/AuthGuard'
import { NavigationGuardProvider, createNavigationGuard } from './navigation-guard'
import { Dashboard } from './pages/Dashboard'
import { ImportDeck } from './pages/ImportDeck'
import { BuildSite } from './pages/BuildSite'
import { CacheRefresh } from './pages/CacheRefresh'
import { ArchidektLogin } from './pages/ArchidektLogin'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'
import { ListEditor } from './pages/ListEditor'
import { ListManager } from './pages/ListManager'
import { MoveCards } from './pages/MoveCards'

type StatusResponse = { setupRequired: boolean; totpEnabled?: boolean }

function App() {
  const [page, setPage] = createSignal<Page>('dashboard')
  // List type + slug to pre-select when navigating into the editor page; both
  // cleared on any navigation that doesn't supply them (e.g. sidebar / dashboard
  // clicks).
  const [editorSlug, setEditorSlug] = createSignal<string | null>(null)
  const [editorListType, setEditorListType] = createSignal<ListType | null>(null)
  const [setupRequired, setSetupRequired] = createSignal<boolean | null>(null)
  const [totpEnabled, setTotpEnabled] = createSignal(false)
  const [loggedIn, setLoggedIn] = createSignal(false)

  const navigationGuard = createNavigationGuard()

  const navigate: NavigateFn = (next, options) => {
    // Leaving the editor page (or any nav) confirms discarding unsaved changes
    // first; the guard runs this immediately when there is nothing to discard.
    navigationGuard.attempt(() => {
      // One logical navigation event — batch so the editor page mounts once with
      // both the target list type and slug already in place.
      batch(() => {
        setEditorSlug(options?.slug ?? null)
        setEditorListType(options?.listType ?? null)
        setPage(next)
      })
    })
  }

  const checkStatus = async () => {
    try {
      const resp = await fetch('/api/status')
      const data = (await resp.json()) as StatusResponse
      setSetupRequired(data.setupRequired)
      setTotpEnabled(data.totpEnabled === true)

      // Check if we have an active session by probing an authenticated endpoint
      if (!data.setupRequired) {
        const probe = await fetch('/api/decks', { credentials: 'same-origin' })
        if (probe.ok) {
          setLoggedIn(true)
        }
      }
    } catch {
      setSetupRequired(true)
    }
  }

  onMount(() => {
    void checkStatus()

    // Warn before a full-page reload or tab close while an editor has unsaved
    // changes; in-app navigation is handled by the guard's confirm dialog.
    const warnOnUnload = (e: BeforeUnloadEvent) => {
      if (!navigationGuard.isDirty()) return
      e.preventDefault()
      // Legacy browsers require a returnValue to trigger the native prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warnOnUnload)
    onCleanup(() => window.removeEventListener('beforeunload', warnOnUnload))
  })

  const onSetupComplete = () => {
    setSetupRequired(false)
    setLoggedIn(true)
  }

  const onLogin = () => {
    setLoggedIn(true)
  }

  const onLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // ignore
    }
    setLoggedIn(false)
  }

  return (
    <Switch>
      <Match when={setupRequired() === null}>
        <div class="flex-center-vh">
          <p class="text-muted">Loading...</p>
        </div>
      </Match>
      <Match when={setupRequired()}>
        <AuthGuard onSetupComplete={onSetupComplete} />
      </Match>
      <Match when={!loggedIn()}>
        <AuthGuard onLogin={onLogin} isLogin totpEnabled={totpEnabled()} />
      </Match>
      <Match when={loggedIn()}>
        <NavigationGuardProvider value={navigationGuard}>
          <Layout
            currentPage={page()}
            onNavigate={navigate}
            onLogout={() => navigationGuard.attempt(() => void onLogout())}
            fullWidth={page() === 'list-editor' || page() === 'move-cards'}
          >
            <Switch>
              <Match when={page() === 'dashboard'}>
                <Dashboard onNavigate={navigate} />
              </Match>
              <Match when={page() === 'list-editor'}>
                <ListEditor initialType={editorListType()} initialSlug={editorSlug()} />
              </Match>
              <Match when={page() === 'list-manager'}>
                <ListManager onNavigate={navigate} />
              </Match>
              <Match when={page() === 'move-cards'}>
                <MoveCards />
              </Match>
              <Match when={page() === 'import-deck'}>
                <ImportDeck />
              </Match>
              <Match when={page() === 'build-site'}>
                <BuildSite />
              </Match>
              <Match when={page() === 'cache-refresh'}>
                <CacheRefresh />
              </Match>
              <Match when={page() === 'archidekt-login'}>
                <ArchidektLogin />
              </Match>
              <Match when={page() === 'settings'}>
                <Settings />
              </Match>
              <Match when={page() === 'audit-log'}>
                <AuditLog />
              </Match>
            </Switch>
          </Layout>
        </NavigationGuardProvider>
      </Match>
    </Switch>
  )
}

const root = document.getElementById('app')
if (root) {
  render(() => <App />, root)
}
