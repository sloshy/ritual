import { render } from 'solid-js/web'
import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
  Match,
} from 'solid-js'
import type { DeckDetail, CollectionDetail, WantedListDetail } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { DeckEditView } from './editor/DeckEditView'
import { CollectionEditView } from './editor/CollectionEditView'
import { WantedEditView } from './editor/WantedEditView'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
import { TradePage } from './TradePage'
import { EditChromeProvider, useEditChrome } from './editor/edit-chrome'
import { EditControlsRow } from './editor/EditControlsRow'
import { QuickSwitch, useQuickSwitchShortcut } from './QuickSwitch'
import { useRouting } from './useRouting'
import { useSiteData } from './useSiteData'
import { useFetchJson } from './useFetchJson'
import { tradeToast } from './useTradeState'
import { createThemeStore, ThemeProvider, useTheme } from './useTheme'
import { syncFaviconToTheme } from './useFavicon'
import { FlameIcon } from './FlameIcon'
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

  // Public list editors: ephemeral, opt-in. Reset whenever the route changes.
  const [editingDeck, setEditingDeck] = createSignal(false)
  const [editingCollection, setEditingCollection] = createSignal(false)
  const [editingWanted, setEditingWanted] = createSignal(false)

  // The editor publishes its controls here while editing; the navbar renders them.
  const editChrome = useEditChrome()

  useQuickSwitchShortcut(() => setQuickSwitchOpen((v) => !v))

  // Reset modal, quick switch, and edit mode on route changes
  createEffect(
    on(
      route,
      () => {
        setModalCard(null)
        setQuickSwitchOpen(false)
        setEditingDeck(false)
        setEditingCollection(false)
        setEditingWanted(false)
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

  // The currently-editable list for the navbar Edit toggle: which page is in view,
  // whether its data is loaded (so editing is possible), and how to enter edit mode.
  type EditTarget = {
    editing: () => boolean
    canEdit: () => boolean
    enter: () => void
  }
  const editTarget = createMemo<EditTarget | null>(() => {
    switch (route().page) {
      case 'deck':
        return {
          editing: editingDeck,
          canEdit: () => !deckLoading() && deckDetail() !== undefined,
          enter: () => setEditingDeck(true),
        }
      case 'collection':
        return {
          editing: editingCollection,
          canEdit: () => !collectionLoading() && collectionDetail() !== undefined,
          enter: () => setEditingCollection(true),
        }
      case 'wanted':
        return {
          editing: editingWanted,
          canEdit: () => !wantedListLoading() && wantedListDetail() !== undefined,
          enter: () => setEditingWanted(true),
        }
      default:
        return null
    }
  })

  const toggleEdit = () => {
    const target = editTarget()
    if (!target) return
    if (target.editing()) editChrome.current()?.onExit()
    else target.enter()
  }

  const openModal = (cardName: string) => {
    setModalCard(cardName)
  }

  const closeModal = () => {
    setModalCard(null)
  }

  let headerRef: HTMLElement | undefined
  onMount(() => {
    if (!headerRef) return
    const el = headerRef
    const update = () => {
      document.documentElement.style.setProperty('--site-header-h', `${el.offsetHeight}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })

  return (
    <div class="site-app app-padding">
      <header ref={headerRef} class="site-header">
        <div class="site-header-main">
          <a href="#/" class="site-logo">
            <FlameIcon class="site-logo-icon" />
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
                  (route().page === 'index' && activeTab() === 'wanted') ||
                  route().page === 'wanted',
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
          <div class="currency-selector">
            <label class="currency-label">Prices:</label>
            <select
              class="currency-select"
              value={currency()}
              onChange={(e) => setCurrency(e.target.value as PriceCurrency)}
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
          <button
            type="button"
            class="site-btn site-btn-secondary btn-edit"
            classList={{ 'btn-edit--active': editTarget()?.editing() ?? false }}
            disabled={!editTarget() || !editTarget()!.canEdit()}
            title={
              editTarget()
                ? editTarget()!.editing()
                  ? 'Leave edit mode'
                  : 'Edit this list locally'
                : 'Open a deck, collection, or wanted list to edit'
            }
            onClick={toggleEdit}
          >
            <span class="btn-edit-icon" aria-hidden="true">
              {editTarget()?.editing() ? '✓' : '✏️'}
            </span>
            <span class="btn-edit-label">{editTarget()?.editing() ? 'Done' : 'Edit'}</span>
          </button>
          <ThemeHeaderControls />
        </div>

        <Show when={editChrome.current()}>
          {(chrome) => (
            <div class="site-header-edit-row">
              <EditControlsRow chrome={chrome()} />
            </div>
          )}
        </Show>
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
                  <Show
                    when={editingWanted()}
                    fallback={
                      <WantedListPage
                        name={wantedListDetail()!.name}
                        entries={wantedListDetail()!.entries}
                        sectionOrder={wantedListDetail()!.sectionOrder}
                        cards={wantedListDetail()!.cards}
                        printings={wantedListDetail()!.printings ?? {}}
                        symbolMap={wantedListDetail()!.symbolMap}
                        useScryfallImgUrls={wantedListDetail()!.useScryfallImgUrls}
                        totalPrice={wantedListDetail()!.totalPrice}
                        exportMdPath={wantedListDetail()!.exportMdPath}
                        pricesDate={wantedListDetail()!.pricesDate}
                        modalCardKey={modalCard()}
                        onOpenModal={openModal}
                        onCloseModal={closeModal}
                        currency={currency()}
                        changelog={wantedListDetail()!.changelog}
                        enablePriceRefresh={true}
                      />
                    }
                  >
                    <WantedEditView
                      detail={wantedListDetail()!}
                      slug={wantedListSlug() ?? ''}
                      currency={currency()}
                      onExit={() => setEditingWanted(false)}
                    />
                  </Show>
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
                  <Show
                    when={editingCollection()}
                    fallback={
                      <CollectionPage
                        name={collectionDetail()!.name}
                        entries={collectionDetail()!.entries}
                        sectionOrder={collectionDetail()!.sectionOrder}
                        cards={collectionDetail()!.cards}
                        printings={collectionDetail()!.printings ?? {}}
                        symbolMap={collectionDetail()!.symbolMap}
                        useScryfallImgUrls={collectionDetail()!.useScryfallImgUrls}
                        totalPrice={collectionDetail()!.totalPrice}
                        exportMdPath={collectionDetail()!.exportMdPath}
                        exportCsvPath={collectionDetail()!.exportCsvPath}
                        pricesDate={collectionDetail()!.pricesDate}
                        modalCardKey={modalCard()}
                        onOpenModal={openModal}
                        onCloseModal={closeModal}
                        currency={currency()}
                        changelog={collectionDetail()!.changelog}
                        enablePriceRefresh={true}
                      />
                    }
                  >
                    <CollectionEditView
                      detail={collectionDetail()!}
                      slug={collectionSlug() ?? ''}
                      currency={currency()}
                      onExit={() => setEditingCollection(false)}
                    />
                  </Show>
                </Show>
              </Show>
            </Match>
            <Match when={route().page === 'deck'}>
              <Show when={!deckError()} fallback={<ErrorMessage message={deckError()!} />}>
                <Show when={!deckLoading() && deckDetail()} fallback={<LoadingSpinner />}>
                  <Show
                    when={editingDeck()}
                    fallback={
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
                        pricesDate={deckDetail()!.pricesDate}
                        slug={deckSlug() ?? ''}
                        primerOpen={deckPrimerOpen()}
                        sectionId={deckSectionId()}
                        changelog={deckDetail()!.changelog}
                        enablePriceRefresh={true}
                      />
                    }
                  >
                    <DeckEditView
                      detail={deckDetail()!}
                      slug={deckSlug() ?? ''}
                      currency={currency()}
                      onExit={() => setEditingDeck(false)}
                    />
                  </Show>
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
  syncFaviconToTheme(themeStore)
  return (
    <ThemeProvider store={themeStore}>
      <EditChromeProvider>
        <Show when={themeStore.editorOpen()}>
          <ThemeEditor />
        </Show>
        <App />
      </EditChromeProvider>
    </ThemeProvider>
  )
}

render(() => <Root />, document.getElementById('app')!)
