import { render } from 'preact'
import { useState, useEffect, useCallback } from 'preact/hooks'
import type { DeckDetail, CollectionDetail, WantedListDetail } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { IndexPage } from './IndexPage'
import { DeckPage } from './DeckPage'
import { CollectionPage } from './CollectionPage'
import { WantedListPage } from './WantedListPage'
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
  const [modalCard, setModalCard] = useState<string | null>(null)

  // Reset modal on route changes
  useEffect(() => {
    setModalCard(null)
  }, [route])

  const deckSlug = route.page === 'deck' ? route.slug : null
  const deckPrimerOpen = route.page === 'deck' ? (route.primerOpen ?? false) : false
  const deckSectionId = route.page === 'deck' ? route.sectionId : undefined
  const collectionSlug = route.page === 'collection' ? route.slug : null
  const wantedListSlug = route.page === 'wanted' ? route.slug : null

  // Fetch deck/collection data (auto-cleared when navigating away)
  const {
    data: deckDetail,
    loading: deckLoading,
    error: deckError,
  } = useFetchJson<DeckDetail>(deckSlug ? `decks/${deckSlug}.json` : null)
  const {
    data: collectionDetail,
    loading: collectionLoading,
    error: collectionError,
  } = useFetchJson<CollectionDetail>(collectionSlug ? `collections/${collectionSlug}.json` : null)
  const {
    data: wantedListDetail,
    loading: wantedListLoading,
    error: wantedListError,
  } = useFetchJson<WantedListDetail>(wantedListSlug ? `wanted/${wantedListSlug}.json` : null)

  const openModal = useCallback((cardName: string) => {
    setModalCard(cardName)
  }, [])

  const closeModal = useCallback(() => {
    setModalCard(null)
  }, [])

  return (
    <div className="site-app app-padding">
      <header className="site-header">
        <a href="#/" className="site-logo">
          <img src="app.svg" alt="Ritual logo" className="site-logo-icon" />
          <span className="site-logo-text">Ritual</span>
        </a>
        <span className="site-nav-sep">|</span>
        <nav className="site-nav">
          <a
            href="#/"
            className={`site-nav-link ${
              (route.page === 'index' && (!route.tab || route.tab === 'decks')) ||
              route.page === 'deck'
                ? 'site-nav-link-active'
                : 'site-nav-link-inactive'
            }`}
          >
            Decks
          </a>
          <a
            href="#/collections"
            className={`site-nav-link ${
              (route.page === 'index' && route.tab === 'collections') || route.page === 'collection'
                ? 'site-nav-link-active'
                : 'site-nav-link-inactive'
            }`}
          >
            Collections
          </a>
          <a
            href="#/wanted"
            className={`site-nav-link ${
              (route.page === 'index' && route.tab === 'wanted') || route.page === 'wanted'
                ? 'site-nav-link-active'
                : 'site-nav-link-inactive'
            }`}
          >
            Wanted Lists
          </a>
        </nav>
        <div className="currency-selector">
          <label className="currency-label">Prices:</label>
          <select
            className="currency-select"
            value={currency}
            onChange={(e) => setCurrency((e.target as HTMLSelectElement).value as PriceCurrency)}
          >
            {availableCurrencies.includes('usd') && <option value="usd">USD ($)</option>}
            {availableCurrencies.includes('eur') && <option value="eur">EUR (€)</option>}
            {availableCurrencies.includes('tix') && <option value="tix">TIX</option>}
          </select>
        </div>
      </header>

      {pricesDate && (
        <div className="prices-date">
          Prices accurate as of{' '}
          {new Date(pricesDate).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      )}

      <main className="site-main">
        <div className={`page-transition ${visible ? 'page-visible' : 'page-hidden'}`}>
          {route.page === 'index' ? (
            deckList ? (
              <IndexPage
                decks={deckList}
                collections={collectionList || []}
                wantedLists={wantedListList || []}
                useScryfallImgUrls={useScryfallImgUrls}
                activeTab={route.tab ?? 'decks'}
                currency={currency}
              />
            ) : (
              <LoadingSpinner />
            )
          ) : route.page === 'wanted' ? (
            wantedListError ? (
              <ErrorMessage message={wantedListError} />
            ) : wantedListLoading || !wantedListDetail ? (
              <LoadingSpinner />
            ) : (
              <WantedListPage
                name={wantedListDetail.name}
                entries={wantedListDetail.entries}
                cards={wantedListDetail.cards}
                printings={wantedListDetail.printings ?? {}}
                symbolMap={wantedListDetail.symbolMap}
                useScryfallImgUrls={wantedListDetail.useScryfallImgUrls}
                totalPrice={wantedListDetail.totalPrice}
                exportMdPath={wantedListDetail.exportMdPath}
                modalCardKey={modalCard}
                onOpenModal={openModal}
                onCloseModal={closeModal}
                currency={currency}
                changelog={wantedListDetail.changelog}
              />
            )
          ) : route.page === 'collection' ? (
            collectionError ? (
              <ErrorMessage message={collectionError} />
            ) : collectionLoading || !collectionDetail ? (
              <LoadingSpinner />
            ) : (
              <CollectionPage
                name={collectionDetail.name}
                entries={collectionDetail.entries}
                cards={collectionDetail.cards}
                printings={collectionDetail.printings ?? {}}
                symbolMap={collectionDetail.symbolMap}
                useScryfallImgUrls={collectionDetail.useScryfallImgUrls}
                totalPrice={collectionDetail.totalPrice}
                exportMdPath={collectionDetail.exportMdPath}
                exportCsvPath={collectionDetail.exportCsvPath}
                modalCardKey={modalCard}
                onOpenModal={openModal}
                onCloseModal={closeModal}
                currency={currency}
                changelog={collectionDetail.changelog}
              />
            )
          ) : deckError ? (
            <ErrorMessage message={deckError} />
          ) : deckLoading || !deckDetail ? (
            <LoadingSpinner />
          ) : (
            <DeckPage
              deck={deckDetail.deck}
              cards={deckDetail.cards}
              printings={deckDetail.printings ?? {}}
              lowestPriceCards={deckDetail.lowestPriceCards}
              lowestPriceCardsEur={deckDetail.lowestPriceCardsEur}
              lowestPriceCardsTix={deckDetail.lowestPriceCardsTix}
              symbolMap={deckDetail.symbolMap}
              exportPath={deckDetail.exportPath}
              useScryfallImgUrls={deckDetail.useScryfallImgUrls}
              modalCardName={modalCard}
              onOpenModal={openModal}
              onCloseModal={closeModal}
              currency={currency}
              missingCards={deckDetail.missingCards}
              slug={deckSlug ?? ''}
              primerOpen={deckPrimerOpen}
              sectionId={deckSectionId}
              changelog={deckDetail.changelog}
            />
          )}
        </div>
      </main>

      <footer className="site-footer">
        <p>
          Generated by <a href="https://github.com/sloshy/ritual">ritual</a>
        </p>
      </footer>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="loading-container">
      <div className="loading-spinner" />
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="error-container">{message}</div>
}

render(<App />, document.getElementById('app')!)
