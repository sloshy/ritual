import { render } from 'solid-js/web'
import { createSignal, onMount, Switch, Match } from 'solid-js'
import type { Page } from './types'
import { Layout } from './components/Layout'
import { AuthGuard } from './components/AuthGuard'
import { Dashboard } from './pages/Dashboard'
import { ImportDeck } from './pages/ImportDeck'
import { BuildSite } from './pages/BuildSite'
import { CacheRefresh } from './pages/CacheRefresh'
import { ArchidektLogin } from './pages/ArchidektLogin'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'
import { DeckEditor } from './pages/DeckEditor'
import { ListManager } from './pages/ListManager'
import { CollectionEditor } from './pages/CollectionEditor'
import { WantedListEditor } from './pages/WantedListEditor'

type StatusResponse = { setupRequired: boolean; totpEnabled?: boolean }

function App() {
  const [page, setPage] = createSignal<Page>('dashboard')
  const [setupRequired, setSetupRequired] = createSignal<boolean | null>(null)
  const [totpEnabled, setTotpEnabled] = createSignal(false)
  const [loggedIn, setLoggedIn] = createSignal(false)

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
        <Layout
          currentPage={page()}
          onNavigate={setPage}
          onLogout={() => void onLogout()}
          fullWidth={
            page() === 'deck-editor' ||
            page() === 'collection-editor' ||
            page() === 'wanted-list-editor'
          }
        >
          <Switch>
            <Match when={page() === 'dashboard'}>
              <Dashboard onNavigate={setPage} />
            </Match>
            <Match when={page() === 'deck-editor'}>
              <DeckEditor />
            </Match>
            <Match when={page() === 'list-manager'}>
              <ListManager />
            </Match>
            <Match when={page() === 'collection-editor'}>
              <CollectionEditor />
            </Match>
            <Match when={page() === 'wanted-list-editor'}>
              <WantedListEditor />
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
      </Match>
    </Switch>
  )
}

const root = document.getElementById('app')
if (root) {
  render(() => <App />, root)
}
