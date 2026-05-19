import type { Component } from 'solid-js'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { getDeckCountLabel, pluralizeCards } from '../deck-format'
import { getSummaryLowestPrice, getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { CoverCard } from './CoverCard'
import { DeckIndexToolbar } from './DeckIndexToolbar'
import {
  DEFAULT_DECK_INDEX_GROUP,
  DEFAULT_DECK_INDEX_SORT,
  type DeckIndexGroup,
  type DeckIndexSort,
  groupDecksByFormat,
  sortDecks,
} from './deck-index-filter'

type IndexTab = 'decks' | 'collections' | 'wanted'

interface IndexPageProps {
  decks: DeckSummary[]
  collections: CollectionSummary[]
  wantedLists: WantedListSummary[]
  useScryfallImgUrls: boolean
  activeTab: IndexTab
  currency: PriceCurrency
}

interface DeckCoverLinkProps {
  deck: DeckSummary
  currency: PriceCurrency
}

const DeckCoverLink: Component<DeckCoverLinkProps> = (props) => {
  const total = createMemo(() => getSummaryTotalPrice(props.deck, props.currency))
  const lowest = createMemo(() => getSummaryLowestPrice(props.deck, props.currency))
  const missing = createMemo(() => getSummaryMissingPriceCount(props.deck, props.currency))
  const countLabel = createMemo(() => getDeckCountLabel(props.deck.format, props.deck.cardCount))
  return (
    <a href={`#/deck/${props.deck.slug}`} class="card-grid-link">
      <CoverCard
        name={props.deck.name}
        image={props.deck.featuredCardImage || null}
        subtitle={props.deck.commander ? `Commander: ${props.deck.commander}` : undefined}
        label={countLabel().primary}
        labelSuffix={countLabel().suffix}
        priceLabel={formatPriceWithMissing(total(), props.currency, missing())}
        secondaryPriceLabel={
          lowest() > 0 ? formatPriceWithMissing(lowest(), props.currency, missing()) : undefined
        }
      />
    </a>
  )
}

export const IndexPage: Component<IndexPageProps> = (props) => {
  const [deckSort, setDeckSort] = createSignal<DeckIndexSort>(DEFAULT_DECK_INDEX_SORT)
  const [deckGroup, setDeckGroup] = createSignal<DeckIndexGroup>(DEFAULT_DECK_INDEX_GROUP)
  const [deckReverse, setDeckReverse] = createSignal(false)

  const sortedDecks = createMemo(() =>
    sortDecks(props.decks, deckSort(), props.currency, deckReverse()),
  )
  const deckGroups = createMemo(() =>
    deckGroup() === 'format' ? groupDecksByFormat(sortedDecks()) : [],
  )

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
                      const total = (): number => getSummaryTotalPrice(wl, props.currency)
                      const missing = (): number => getSummaryMissingPriceCount(wl, props.currency)
                      return (
                        <a href={link} class="card-grid-link">
                          <CoverCard
                            name={wl.name}
                            image={wl.featuredCardImage || null}
                            label={pluralizeCards(wl.cardCount)}
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
                    const total = (): number => getSummaryTotalPrice(col, props.currency)
                    const missing = (): number => getSummaryMissingPriceCount(col, props.currency)
                    return (
                      <a href={link} class="card-grid-link">
                        <CoverCard
                          name={col.name}
                          image={col.featuredCardImage || null}
                          label={pluralizeCards(col.cardCount)}
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
          <DeckIndexToolbar
            sort={deckSort()}
            onSortChange={setDeckSort}
            group={deckGroup()}
            onGroupChange={setDeckGroup}
            reverse={deckReverse()}
            onReverseToggle={() => setDeckReverse((v) => !v)}
          />
          <Show
            when={deckGroup() === 'format'}
            fallback={
              <div class="card-grid-responsive">
                <For each={sortedDecks()}>
                  {(deck) => <DeckCoverLink deck={deck} currency={props.currency} />}
                </For>
              </div>
            }
          >
            <For each={deckGroups()}>
              {(group) => (
                <section class="deck-index-group">
                  <h2 class="deck-index-group-title">{group.label}</h2>
                  <div class="card-grid-responsive">
                    <For each={group.decks}>
                      {(deck) => <DeckCoverLink deck={deck} currency={props.currency} />}
                    </For>
                  </div>
                </section>
              )}
            </For>
          </Show>
        </>
      </Show>
    </div>
  )
}
