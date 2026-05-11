import { render } from 'solid-js/web'
import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
  Show,
  Switch,
  Match,
} from 'solid-js'
import type { DeckDetail, CollectionDetail, WantedListDetail } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
import { TradePage } from './TradePage'
import { QuickSwitch, useQuickSwitchShortcut } from './QuickSwitch'
import { useRouting } from './useRouting'
import { useSiteData } from './useSiteData'
import { useFetchJson } from './useFetchJson'
import { tradeToast } from './useTradeState'
import { createThemeStore, ThemeProvider, useTheme } from './useTheme'
import { ThemeEditor } from './ThemeEditor'
import { ThemePicker } from './ThemePicker'

function App() {
  const { route, visible } = useRouting()
  const {
    deckList,
    collectionList,
    wantedListList,
    useScryfallImgUrls,
    currency,
    setCurrency,
    availableCurrencies,
    pricesDate,
  } = useSiteData()

  // Card modal state
  const [modalCard, setModalCard] = createSignal<string | null>(null)

  // Quick switch dialog state
  const [quickSwitchOpen, setQuickSwitchOpen] = createSignal(false)

  useQuickSwitchShortcut(() => setQuickSwitchOpen((v) => !v))

  // Reset modal and quick switch on route changes
  createEffect(
    on(
      route,
      () => {
        setModalCard(null)
        setQuickSwitchOpen(false)
      },
      { defer: true },
    ),
  )

  const activeTab = createMemo(() => {
    const r = route()
    return r.page === 'index' ? (r.tab ?? 'decks') : undefined
  })

  const deckSlug = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? r.slug : null
  })
  const deckPrimerOpen = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? (r.primerOpen ?? false) : false
  })
  const deckSectionId = createMemo(() => {
    const r = route()
    return r.page === 'deck' ? r.sectionId : undefined
  })
  const collectionSlug = createMemo(() => {
    const r = route()
    return r.page === 'collection' ? r.slug : null
  })
  const wantedListSlug = createMemo(() => {
    const r = route()
    return r.page === 'wanted' ? r.slug : null
  })

  // Fetch deck/collection data (auto-cleared when navigating away)
  const {
    data: deckDetail,
    loading: deckLoading,
    error: deckError,
  } = useFetchJson<DeckDetail>(() => (deckSlug() ? `decks/${deckSlug()}.json` : null))
  const {
    data: collectionDetail,
    loading: collectionLoading,
    error: collectionError,
  } = useFetchJson<CollectionDetail>(() =>
    collectionSlug() ? `collections/${collectionSlug()}.json` : null,
  )
  const {
    data: wantedListDetail,
    loading: wantedListLoading,
    error: wantedListError,
  } = useFetchJson<WantedListDetail>(() =>
    wantedListSlug() ? `wanted/${wantedListSlug()}.json` : null,
  )

  const openModal = (cardName: string) => {
    setModalCard(cardName)
  }

  const closeModal = () => {
    setModalCard(null)
  }

  return (
    <div class="site-app app-padding">
      <header class="site-header">
        <a href="#/" class="site-logo">
          <img src="app.svg" alt="Ritual logo" class="site-logo-icon" />
          <span class="site-logo-text">Ritual</span>
        </a>
        <span class="site-nav-sep">|</span>
        <nav class="site-nav">
          <a
            href="#/"
            class="site-nav-link"
            classList={{
              'site-nav-link-active':
                (route().page === 'index' && (!activeTab() || activeTab() === 'decks')) ||
                route().page === 'deck',
              'site-nav-link-inactive': !(
                (route().page === 'index' && (!activeTab() || activeTab() === 'decks')) ||
                route().page === 'deck'
              ),
            }}
          >
            Decks
          </a>
          <a
            href="#/collections"
            class="site-nav-link"
            classList={{
              'site-nav-link-active':
                (route().page === 'index' && activeTab() === 'collections') ||
                route().page === 'collection',
              'site-nav-link-inactive': !(
                (route().page === 'index' && activeTab() === 'collections') ||
                route().page === 'collection'
              ),
            }}
          >
            Collections
          </a>
          <a
            href="#/wanted"
            class="site-nav-link"
            classList={{
              'site-nav-link-active':
                (route().page === 'index' && activeTab() === 'wanted') || route().page === 'wanted',
              'site-nav-link-inactive': !(
                (route().page === 'index' && activeTab() === 'wanted') ||
                route().page === 'wanted'
              ),
            }}
          >
            Wanted Lists
          </a>
          <a
            href="#/trade"
            class="site-nav-link"
            classList={{
              'site-nav-link-active': route().page === 'trade',
              'site-nav-link-inactive': route().page !== 'trade',
            }}
          >
            Trade
          </a>
        </nav>
        <button
          type="button"
          class="quick-switch-trigger"
          aria-label="Open quick switch (Ctrl+K)"
          title="Quick switch (Ctrl+K)"
          onClick={() => setQuickSwitchOpen(true)}
        >
          <span class="quick-switch-trigger-icon" aria-hidden="true">
            ⌕
          </span>
          <span class="quick-switch-trigger-label">Quick switch</span>
          <span class="quick-switch-trigger-kbd" aria-hidden="true">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <ThemeHeaderControls />
        <div class="currency-selector">
          <label class="currency-label">Prices:</label>
          <select
            class="currency-select"
            value={currency()}
            onChange={(e) => setCurrency((e.target as HTMLSelectElement).value as PriceCurrency)}
          >
            <Show when={availableCurrencies().includes('usd')}>
              <option value="usd">USD ($)</option>
            </Show>
            <Show when={availableCurrencies().includes('eur')}>
              <option value="eur">EUR (€)</option>
            </Show>
            <Show when={availableCurrencies().includes('tix')}>
              <option value="tix">TIX</option>
            </Show>
          </select>
        </div>
      </header>

      <Show when={pricesDate()}>
        <div class="prices-date">
          Prices accurate as of{' '}
          {new Date(pricesDate()!).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      </Show>

      <main class="site-main">
        <div
          class="page-transition"
          classList={{ 'page-visible': visible(), 'page-hidden': !visible() }}
        >
          <Switch>
            <Match when={route().page === 'index'}>
              <Show when={deckList()} fallback={<LoadingSpinner />}>
                <IndexPage
                  decks={deckList()!}
                  collections={collectionList() || []}
                  wantedLists={wantedListList() || []}
                  useScryfallImgUrls={useScryfallImgUrls()}
                  activeTab={activeTab() ?? 'decks'}
                  currency={currency()}
                />
              </Show>
            </Match>
            <Match when={route().page === 'wanted'}>
              <Show
                when={!wantedListError()}
                fallback={<ErrorMessage message={wantedListError()!} />}
              >
                <Show
                  when={!wantedListLoading() && wantedListDetail()}
                  fallback={<LoadingSpinner />}
                >
                  <WantedListPage
                    name={wantedListDetail()!.name}
                    entries={wantedListDetail()!.entries}
                    cards={wantedListDetail()!.cards}
                    printings={wantedListDetail()!.printings ?? {}}
                    symbolMap={wantedListDetail()!.symbolMap}
                    useScryfallImgUrls={wantedListDetail()!.useScryfallImgUrls}
                    totalPrice={wantedListDetail()!.totalPrice}
                    exportMdPath={wantedListDetail()!.exportMdPath}
                    modalCardKey={modalCard()}
                    onOpenModal={openModal}
                    onCloseModal={closeModal}
                    currency={currency()}
                    changelog={wantedListDetail()!.changelog}
                  />
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'collection'}>
              <Show
                when={!collectionError()}
                fallback={<ErrorMessage message={collectionError()!} />}
              >
                <Show
                  when={!collectionLoading() && collectionDetail()}
                  fallback={<LoadingSpinner />}
                >
                  <CollectionPage
                    name={collectionDetail()!.name}
                    entries={collectionDetail()!.entries}
                    cards={collectionDetail()!.cards}
                    printings={collectionDetail()!.printings ?? {}}
                    symbolMap={collectionDetail()!.symbolMap}
                    useScryfallImgUrls={collectionDetail()!.useScryfallImgUrls}
                    totalPrice={collectionDetail()!.totalPrice}
                    exportMdPath={collectionDetail()!.exportMdPath}
                    exportCsvPath={collectionDetail()!.exportCsvPath}
                    modalCardKey={modalCard()}
                    onOpenModal={openModal}
                    onCloseModal={closeModal}
                    currency={currency()}
                    changelog={collectionDetail()!.changelog}
                  />
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'deck'}>
              <Show when={!deckError()} fallback={<ErrorMessage message={deckError()!} />}>
                <Show when={!deckLoading() && deckDetail()} fallback={<LoadingSpinner />}>
                  <DeckPage
                    deck={deckDetail()!.deck}
                    cards={deckDetail()!.cards}
                    printings={deckDetail()!.printings ?? {}}
                    lowestPriceCards={deckDetail()!.lowestPriceCards}
                    lowestPriceCardsEur={deckDetail()!.lowestPriceCardsEur}
                    lowestPriceCardsTix={deckDetail()!.lowestPriceCardsTix}
                    symbolMap={deckDetail()!.symbolMap}
                    exportPath={deckDetail()!.exportPath}
                    useScryfallImgUrls={deckDetail()!.useScryfallImgUrls}
                    modalCardName={modalCard()}
                    onOpenModal={openModal}
                    onCloseModal={closeModal}
                    currency={currency()}
                    missingCards={deckDetail()!.missingCards}
                    slug={deckSlug() ?? ''}
                    primerOpen={deckPrimerOpen()}
                    sectionId={deckSectionId()}
                    changelog={deckDetail()!.changelog}
                  />
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'trade'}>
              <TradePage
                useScryfallImgUrls={useScryfallImgUrls()}
                currency={currency()}
                collections={collectionList}
                decks={deckList}
                wantedLists={wantedListList}
              />
            </Match>
          </Switch>
        </div>
      </main>

      <footer class="site-footer">
        <p>
          Generated by <a href="https://github.com/sloshy/ritual">ritual</a>
        </p>
      </footer>

      <QuickSwitch
        open={quickSwitchOpen()}
        onClose={() => setQuickSwitchOpen(false)}
        decks={deckList}
        collections={collectionList}
        wantedLists={wantedListList}
        currency={currency}
        useScryfallImgUrls={useScryfallImgUrls}
      />

      <Show when={tradeToast()}>
        {(t) => (
          <div class="trade-add-toast" aria-live="polite">
            <Show when={t().imageUrl}>
              {(url) => <img class="trade-add-toast-thumb" src={url()} alt="" />}
            </Show>
            {t().name} added to Trade
          </div>
        )}
      </Show>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div class="loading-container">
      <div class="loading-spinner" />
    </div>
  )
}

interface ErrorMessageProps {
  message: string
}

function ErrorMessage(props: ErrorMessageProps) {
  return <div class="error-container">{props.message}</div>
}

function ThemeHeaderControls() {
  const theme = useTheme()
  const [pickerOpen, setPickerOpen] = createSignal(false)
  let wrapperRef: HTMLDivElement | undefined

  // Click-outside dismisses the popover. Use mousedown (not click) so a
  // press on the trigger's toggling its own state doesn't get followed by a
  // close fired from the bubbled click — Solid's click handler runs after
  // mousedown.
  createEffect(() => {
    if (!pickerOpen()) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    onCleanup(() => document.removeEventListener('mousedown', onMouseDown))
  })

  return (
    <div ref={wrapperRef} class="theme-picker-wrapper">
      <button
        type="button"
        class="theme-customize-btn"
        classList={{ 'theme-customize-btn-active': pickerOpen() || theme.editorOpen() }}
        onClick={() => setPickerOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen()}
        title={theme.editorOpen() ? 'Theme menu (editor open)' : 'Theme menu'}
      >
        <span class="theme-customize-btn-icon" aria-hidden="true">
          🎨
        </span>
        <span class="theme-customize-btn-label">
          {theme.editorOpen() ? 'Editing theme' : 'Theme'}
        </span>
      </button>
      <ThemePicker open={pickerOpen()} onClose={() => setPickerOpen(false)} />
    </div>
  )
}

function Root() {
  const themeStore = createThemeStore()
  return (
    <ThemeProvider store={themeStore}>
      <Show when={themeStore.editorOpen()}>
        <ThemeEditor />
      </Show>
      <App />
    </ThemeProvider>
  )
}

render(() => <Root />, document.getElementById('app')!)
