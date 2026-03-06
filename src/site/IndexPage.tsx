import type { FunctionalComponent } from 'preact'
import type { DeckSummary, CollectionSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { getCurrencyValue } from './utils'
import { CoverCard } from './CoverCard'

type IndexTab = 'decks' | 'collections'

interface IndexPageProps {
  decks: DeckSummary[]
  collections: CollectionSummary[]
  useScryfallImgUrls: boolean
  activeTab: IndexTab
  currency: PriceCurrency
}

export const IndexPage: FunctionalComponent<IndexPageProps> = ({
  decks,
  collections,
  activeTab,
  currency,
}) => {
  return (
    <div className="container mx-auto">
      {activeTab === 'decks' ? (
        <>
          <h1 className="text-3xl font-bold mb-6 text-white">My Decks</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {decks.map((deck) => {
              const link = `#/deck/${deck.slug}`
              const total = getCurrencyValue(
                deck.totalPrice,
                deck.totalPriceEur,
                deck.totalPriceTix,
                currency,
              )
              const lowest = getCurrencyValue(
                deck.lowestPrice,
                deck.lowestPriceEur,
                deck.lowestPriceTix,
                currency,
              )
              const missing = getCurrencyValue(
                deck.missingPriceCount,
                deck.missingPriceCountEur,
                deck.missingPriceCountTix,
                currency,
              )
              return (
                <a href={link} key={deck.slug} className="block">
                  <CoverCard
                    name={deck.name}
                    image={deck.featuredCardImage || null}
                    subtitle={deck.commander ? `Commander: ${deck.commander}` : undefined}
                    cardCount={deck.cardCount}
                    priceLabel={formatPriceWithMissing(total, currency, missing)}
                    secondaryPriceLabel={
                      lowest > 0 ? formatPriceWithMissing(lowest, currency, missing) : undefined
                    }
                  />
                </a>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-6 text-white">My Collections</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {collections.map((col) => {
              const link = `#/collection/${col.slug}`
              const total = getCurrencyValue(
                col.totalPrice,
                col.totalPriceEur,
                col.totalPriceTix,
                currency,
              )
              const missing = getCurrencyValue(
                col.missingPriceCount,
                col.missingPriceCountEur,
                col.missingPriceCountTix,
                currency,
              )
              return (
                <a href={link} key={col.slug} className="block">
                  <CoverCard
                    name={col.name}
                    image={col.featuredCardImage || null}
                    cardCount={col.cardCount}
                    priceLabel={formatPriceWithMissing(total, currency, missing)}
                  />
                </a>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
