import { Dynamic, render } from 'solid-js/web'
import {
  type Component,
  createEffect,
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
import { CardArtModal } from './components/CardArtModal'
import { pendingCardArtPrompt, closeCardArtPrompt } from './card-art-prompt'
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
import { setBuylistFetcher } from '../../site/buylist-quotes'
import { adminBuylistFetcher } from './editor-backend'
import { setSellModeEnabled } from './sell-enabled'
import { fetchStatus } from './status-api'
import { createI18nStore, I18nProvider, useI18n } from '../../ui/i18n'
import { registerAdminMessages } from '../../i18n/register/admin'
import { bootAdminLocale, useAdminLocale } from './hooks/useAdminLocale'

// The English catalog is registered per surface, not imported by the runtime
// (plan §4.2): this is what keeps the CLI's `cli.*` / `help.*` inventory —
// half the catalog — out of this bundle. Module scope, before anything renders.
registerAdminMessages()

// The shared list pages fetch buylist quotes through a module-level transport;
// on admin that transport must carry the session cookie. Installed once, at
// module load, before any page mounts.
setBuylistFetcher(adminBuylistFetcher)

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
  const { t, setLocale: publishLocale } = useI18n()
  const uiLocale = useAdminLocale()
  // `useAdminLocale` owns resolution and dictionary loading (plain module state,
  // which Solid cannot observe); mirroring what it applied into the i18n store is
  // what makes every `t()` in the tree re-render on a switch.
  createEffect(() => publishLocale(uiLocale()))

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

  const checkStatus = async (): Promise<void> => {
    // Shared with `refreshSellModeEnabled`, which re-asks the same endpoint
    // after a Settings save; a server that gives no well-formed status answers
    // null, and every field below is validated by the time we get here.
    const data = await fetchStatus()
    if (!data) {
      setSetupRequired(true)
      return
    }
    setSetupRequired(data.setupRequired)
    setTotpEnabled(data.totpEnabled)
    // Whether this server offers sell mode at all; its sell/buylist routes
    // 404 otherwise, so every sell surface in the UI hides itself on this.
    setSellModeEnabled(data.sellMode)

    // Check if we have an active session by probing an authenticated endpoint.
    // A probe that cannot reach the server means "no session", not "no account":
    // the status above already answered whether setup is required.
    if (!data.setupRequired) {
      const probe = await fetch('/api/decks', { credentials: 'same-origin' }).catch(() => null)
      if (probe?.ok) {
        setLoggedIn(true)
      }
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
          <p class="text-muted">{t('admin.app.loading')}</p>
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

              {/* Custom-art dialog, opened from any editor's card context menu.
                  Keyed: the form seeds its mode and value from the prompt at
                  construction, so opening it for a second card has to remount
                  it or the first card's reference would still be in the field. */}
              <Show when={pendingCardArtPrompt()} keyed>
                {(prompt) => <CardArtModal prompt={prompt} onClose={closeCardArtPrompt} />}
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

/**
 * The i18n store wraps the whole app: `useT()` reads its locale signal on every
 * call, so a language switch re-renders every translated string in one pass.
 * The boot resolution runs before the first render so the sign-in screen — which
 * mounts long before `/api/config` can be read — already speaks the remembered
 * language.
 */
function Root() {
  bootAdminLocale()
  const i18nStore = createI18nStore()
  return (
    <I18nProvider store={i18nStore}>
      <App />
    </I18nProvider>
  )
}

const root = document.getElementById('app')
if (root) {
  render(() => <Root />, root)
}
