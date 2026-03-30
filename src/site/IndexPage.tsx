import type { Component } from 'solid-js'
import { For, Show } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { getCurrencyValue } from './utils'
import { CoverCard } from './CoverCard'

type IndexTab = 'decks' | 'collections' | 'wanted'

interface IndexPageProps {
  decks: DeckSummary[]
  collections: CollectionSummary[]
  wantedLists: WantedListSummary[]
  useScryfallImgUrls: boolean
  activeTab: IndexTab
  currency: PriceCurrency
}

export const IndexPage: Component<IndexPageProps> = (props) => {
  return (
    <div class="page-container">
      <Show
        when={props.activeTab === 'decks'}
        fallback={
          <Show
            when={props.activeTab === 'collections'}
            fallback={
              <>
                <h1 class="section-title">My Wanted Lists</h1>
                <div class="card-grid-responsive">
                  <For each={props.wantedLists}>
                    {(wl) => {
                      const link = `#/wanted/${wl.slug}`
                      const total = () =>
                        getCurrencyValue(
                          wl.totalPrice,
                          wl.totalPriceEur,
                          wl.totalPriceTix,
                          props.currency,
                        )
                      const missing = () =>
                        getCurrencyValue(
                          wl.missingPriceCount,
                          wl.missingPriceCountEur,
                          wl.missingPriceCountTix,
                          props.currency,
                        )
                      return (
                        <a href={link} class="card-grid-link">
                          <CoverCard
                            name={wl.name}
                            image={wl.featuredCardImage || null}
                            cardCount={wl.cardCount}
                            priceLabel={formatPriceWithMissing(total(), props.currency, missing())}
                          />
                        </a>
                      )
                    }}
                  </For>
                </div>
              </>
            }
          >
            <>
              <h1 class="section-title">My Collections</h1>
              <div class="card-grid-responsive">
                <For each={props.collections}>
                  {(col) => {
                    const link = `#/collection/${col.slug}`
                    const total = () =>
                      getCurrencyValue(
                        col.totalPrice,
                        col.totalPriceEur,
                        col.totalPriceTix,
                        props.currency,
                      )
                    const missing = () =>
                      getCurrencyValue(
                        col.missingPriceCount,
                        col.missingPriceCountEur,
                        col.missingPriceCountTix,
                        props.currency,
                      )
                    return (
                      <a href={link} class="card-grid-link">
                        <CoverCard
                          name={col.name}
                          image={col.featuredCardImage || null}
                          cardCount={col.cardCount}
                          priceLabel={formatPriceWithMissing(total(), props.currency, missing())}
                        />
                      </a>
                    )
                  }}
                </For>
              </div>
            </>
          </Show>
        }
      >
        <>
          <h1 class="section-title">My Decks</h1>
          <div class="card-grid-responsive">
            <For each={props.decks}>
              {(deck) => {
                const link = `#/deck/${deck.slug}`
                const total = () =>
                  getCurrencyValue(
                    deck.totalPrice,
                    deck.totalPriceEur,
                    deck.totalPriceTix,
                    props.currency,
                  )
                const lowest = () =>
                  getCurrencyValue(
                    deck.lowestPrice,
                    deck.lowestPriceEur,
                    deck.lowestPriceTix,
                    props.currency,
                  )
                const missing = () =>
                  getCurrencyValue(
                    deck.missingPriceCount,
                    deck.missingPriceCountEur,
                    deck.missingPriceCountTix,
                    props.currency,
                  )
                return (
                  <a href={link} class="card-grid-link">
                    <CoverCard
                      name={deck.name}
                      image={deck.featuredCardImage || null}
                      subtitle={deck.commander ? `Commander: ${deck.commander}` : undefined}
                      cardCount={deck.cardCount}
                      priceLabel={formatPriceWithMissing(total(), props.currency, missing())}
                      secondaryPriceLabel={
                        lowest() > 0
                          ? formatPriceWithMissing(lowest(), props.currency, missing())
                          : undefined
                      }
                    />
                  </a>
                )
              }}
            </For>
          </div>
        </>
      </Show>
    </div>
  )
}
