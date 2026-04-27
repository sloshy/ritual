import { render } from 'solid-js/web'
import { createSignal, createEffect, createMemo, on, Show, Switch, Match } from 'solid-js'
import type { DeckDetail, CollectionDetail, WantedListDetail } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
import { TradePage } from './TradePage'
import { useRouting } from './useRouting'
import { useSiteData } from './useSiteData'
import { useFetchJson } from './useFetchJson'

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

  // Reset modal on route changes
  createEffect(on(route, () => setModalCard(null), { defer: true }))

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

function ErrorMessage(props: { message: string }) {
  return <div class="error-container">{props.message}</div>
}

render(() => <App />, document.getElementById('app')!)
