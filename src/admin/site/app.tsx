import { Dynamic, render } from 'solid-js/web'
import {
  type Component,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
  Show,
  Switch,
  Match,
} from 'solid-js'
import { type Page, RoutingProvider, createRouting } from './routing'
import { pendingPrintingPrompt } from '../../site/printing-prompt'
import { TradePrintingPicker } from '../../site/TradePrintingPicker'
import { pendingMovePrompt, closeMovePrompt } from '../../site/move-prompt'
import { MoveTargetPicker } from '../../site/MoveTargetPicker'
import { Layout } from './components/Layout'
import { AuthGuard } from './components/AuthGuard'
import { NavigationGuardProvider, createNavigationGuard } from '../../editor/navigation-guard'
import { Dashboard } from './pages/Dashboard'
import { ImportDeck } from './pages/ImportDeck'
import { ImportCsv } from './pages/ImportCsv'
import { ImportChanges } from './pages/ImportChanges'
import { BuildSite } from './pages/BuildSite'
import { CacheRefresh } from './pages/CacheRefresh'
import { DeckSync } from './pages/DeckSync'
import { CollectionSync } from './pages/CollectionSync'
import { ArchidektLogin } from './pages/ArchidektLogin'
import { Settings } from './pages/Settings'
import { AuditLog } from './pages/AuditLog'
import { ListEditor } from './pages/ListEditor'
import { ListManager } from './pages/ListManager'
import { MoveCards } from './pages/MoveCards'
import { History } from './pages/History'

type StatusResponse = { setupRequired: boolean; totpEnabled?: boolean }

/** The component each page renders. Typed by {@link Page}, so a new page cannot be forgotten. */
const PAGE_COMPONENTS: Record<Page, Component> = {
  dashboard: Dashboard,
  'list-editor': ListEditor,
  'list-manager': ListManager,
  'move-cards': MoveCards,
  history: History,
  'import-deck': ImportDeck,
  'import-csv': ImportCsv,
  'import-changes': ImportChanges,
  'build-site': BuildSite,
  'cache-refresh': CacheRefresh,
  'deck-sync': DeckSync,
  'collection-sync': CollectionSync,
  'archidekt-login': ArchidektLogin,
  settings: Settings,
  'audit-log': AuditLog,
}

function App() {
  const [setupRequired, setSetupRequired] = createSignal<boolean | null>(null)
  const [totpEnabled, setTotpEnabled] = createSignal(false)
  const [loggedIn, setLoggedIn] = createSignal(false)

  const navigationGuard = createNavigationGuard()
  // Every navigation — link, dashboard card, or the browser's Back/Forward —
  // runs through the guard, so leaving an editor with unsaved changes still
  // confirms first.
  const routing = createRouting(navigationGuard.attempt)
  // Memoized: the route also changes when the editor tracks its list selection
  // in the URL, which must not disturb the page or the nav's active states.
  const page = createMemo(() => routing.route().page)

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
          <RoutingProvider value={routing}>
            <Layout onLogout={() => navigationGuard.attempt(() => void onLogout())}>
              {/* Keyed on the navigation, so arriving at a page — including the
                  one already open, at a different list — always starts it fresh,
                  while the page's own URL updates leave it mounted. */}
              <Show when={routing.navKey()} keyed>
                <Dynamic component={PAGE_COMPONENTS[page()]} />
              </Show>
              {/* Shared picker for choosing a move destination (section or list). */}
              <Show when={pendingMovePrompt()}>
                {(prompt) => <MoveTargetPicker prompt={prompt()} onClose={closeMovePrompt} />}
              </Show>

              {/* Shared printing picker for moving a printing-less card into a collection. */}
              <Show when={pendingPrintingPrompt()}>
                {(prompt) => (
                  <TradePrintingPicker
                    cardName={prompt().cardName}
                    printings={prompt().printings}
                    loading={false}
                    currency="usd"
                    onSelect={(printing, finish) => prompt().onSelect(printing, finish)}
                    onClose={() => prompt().onSkip()}
                  />
                )}
              </Show>
            </Layout>
          </RoutingProvider>
        </NavigationGuardProvider>
      </Match>
    </Switch>
  )
}

const root = document.getElementById('app')
if (root) {
  render(() => <App />, root)
}
