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
    <div className="min-h-screen flex flex-col" style="padding: 1.5rem 2rem;">
      <header className="mb-6 flex items-center gap-4">
        <a
          href="#/"
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <img src="app.svg" alt="Ritual logo" className="h-6 w-6" />
          <span className="font-semibold text-sm">Ritual</span>
        </a>
        <span className="text-gray-700">|</span>
        <nav className="flex gap-3">
          <a
            href="#/"
            className={`text-sm font-medium transition-colors ${
              (route.page === 'index' && (!route.tab || route.tab === 'decks')) ||
              route.page === 'deck'
                ? 'text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Decks
          </a>
          <a
            href="#/collections"
            className={`text-sm font-medium transition-colors ${
              (route.page === 'index' && route.tab === 'collections') || route.page === 'collection'
                ? 'text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Collections
          </a>
          <a
            href="#/wanted"
            className={`text-sm font-medium transition-colors ${
              (route.page === 'index' && route.tab === 'wanted') || route.page === 'wanted'
                ? 'text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Wanted Lists
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Prices:</label>
          <select
            className="bg-gray-800 text-gray-200 rounded px-2 py-1 border border-gray-700 focus:border-blue-500 outline-none text-xs"
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
        <div className="mb-4 text-center text-xs text-gray-500">
          Prices accurate as of{' '}
          {new Date(pricesDate).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      )}

      <main className="grow">
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

      <footer className="mt-12 border-t border-gray-800 pt-6 text-center text-xs text-gray-500">
        <p>
          Generated by{' '}
          <a href="https://github.com/sloshy/ritual" className="text-gray-400 hover:text-white">
            ritual
          </a>
        </p>
      </footer>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center" style="min-height: 40vh;">
      <div className="loading-spinner" />
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      className="flex items-center justify-center text-red-400 text-sm"
      style="min-height: 40vh;"
    >
      {message}
    </div>
  )
}

render(<App />, document.getElementById('app')!)
