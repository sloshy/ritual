import type { Component } from 'solid-js'
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js'
import type { DeckSummary, CollectionSummary, WantedListSummary } from './data-types'
import type { PriceCurrency } from '../price-currency'
import { formatPriceWithMissing } from '../price-currency'
import { getDeckCountLabel, pluralizeCards } from '../deck-format'
import { getSummaryLowestPrice, getSummaryMissingPriceCount, getSummaryTotalPrice } from './utils'
import { CoverCard } from './CoverCard'
import { IndexToolbar } from './IndexToolbar'
import type { ListType } from '../list-type'
import { combinedAllHref } from './combined-list'
import {
  DEFAULT_INDEX_GROUP,
  DEFAULT_INDEX_SORT,
  INDEX_SORT_OPTIONS,
  LIST_SORT_OPTIONS,
  type IndexGroup,
  type IndexSort,
  groupDecksByFormat,
  sortSummaries,
} from './index-filter'

type IndexTab = 'decks' | 'collections' | 'wanted'

interface IndexPageProps {
  decks: DeckSummary[]
  collections: CollectionSummary[]
  wantedLists: WantedListSummary[]
  useScryfallImgUrls: boolean
  activeTab: IndexTab
  currency: PriceCurrency
}

interface SectionHeaderProps {
  title: string
  viewAllType: ListType
  viewAllLabel: string
  /** Hide the "view all" link when there are no lists to combine. */
  show: boolean
}

const SectionHeader: Component<SectionHeaderProps> = (props) => (
  <div class="section-header">
    <h1 class="section-title">{props.title}</h1>
    <Show when={props.show}>
      <a href={combinedAllHref(props.viewAllType)} class="site-btn site-btn-secondary">
        {props.viewAllLabel}
      </a>
    </Show>
  </div>
)

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

interface ListCoverLinkProps {
  item: CollectionSummary | WantedListSummary
  basePath: 'collection' | 'wanted'
  currency: PriceCurrency
}

const ListCoverLink: Component<ListCoverLinkProps> = (props) => {
  const total = createMemo(() => getSummaryTotalPrice(props.item, props.currency))
  const missing = createMemo(() => getSummaryMissingPriceCount(props.item, props.currency))
  return (
    <a href={`#/${props.basePath}/${props.item.slug}`} class="card-grid-link">
      <CoverCard
        name={props.item.name}
        image={props.item.featuredCardImage || null}
        label={pluralizeCards(props.item.cardCount)}
        priceLabel={formatPriceWithMissing(total(), props.currency, missing())}
      />
    </a>
  )
}

export const IndexPage: Component<IndexPageProps> = (props) => {
  // Decks support both sorting and grouping by format.
  const [deckSort, setDeckSort] = createSignal<IndexSort>(DEFAULT_INDEX_SORT)
  const [deckGroup, setDeckGroup] = createSignal<IndexGroup>(DEFAULT_INDEX_GROUP)
  const [deckReverse, setDeckReverse] = createSignal(false)
  const sortedDecks = createMemo(() =>
    sortSummaries(props.decks, deckSort(), props.currency, deckReverse()),
  )
  const deckGroups = createMemo(() =>
    deckGroup() === 'format' ? groupDecksByFormat(sortedDecks()) : [],
  )

  // Collections and wanted lists share sorting but have no grouping concept.
  const [collectionSort, setCollectionSort] = createSignal<IndexSort>(DEFAULT_INDEX_SORT)
  const [collectionReverse, setCollectionReverse] = createSignal(false)
  const sortedCollections = createMemo(() =>
    sortSummaries(props.collections, collectionSort(), props.currency, collectionReverse()),
  )

  const [wantedSort, setWantedSort] = createSignal<IndexSort>(DEFAULT_INDEX_SORT)
  const [wantedReverse, setWantedReverse] = createSignal(false)
  const sortedWanted = createMemo(() =>
    sortSummaries(props.wantedLists, wantedSort(), props.currency, wantedReverse()),
  )

  return (
    <div class="page-container">
      <Switch
        fallback={
          <>
            <SectionHeader
              title="My Decks"
              viewAllType="deck"
              viewAllLabel="View all decks"
              show={props.decks.length > 0}
            />
            <IndexToolbar
              sort={deckSort()}
              onSortChange={setDeckSort}
              sortOptions={INDEX_SORT_OPTIONS}
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
        }
      >
        <Match when={props.activeTab === 'collections'}>
          <SectionHeader
            title="My Collections"
            viewAllType="collection"
            viewAllLabel="View all collections"
            show={props.collections.length > 0}
          />
          <IndexToolbar
            sort={collectionSort()}
            onSortChange={setCollectionSort}
            sortOptions={LIST_SORT_OPTIONS}
            reverse={collectionReverse()}
            onReverseToggle={() => setCollectionReverse((v) => !v)}
          />
          <div class="card-grid-responsive">
            <For each={sortedCollections()}>
              {(col) => (
                <ListCoverLink item={col} basePath="collection" currency={props.currency} />
              )}
            </For>
          </div>
        </Match>
        <Match when={props.activeTab === 'wanted'}>
          <SectionHeader
            title="My Wanted Lists"
            viewAllType="wanted"
            viewAllLabel="View all wanted lists"
            show={props.wantedLists.length > 0}
          />
          <IndexToolbar
            sort={wantedSort()}
            onSortChange={setWantedSort}
            sortOptions={LIST_SORT_OPTIONS}
            reverse={wantedReverse()}
            onReverseToggle={() => setWantedReverse((v) => !v)}
          />
          <div class="card-grid-responsive">
            <For each={sortedWanted()}>
              {(wl) => <ListCoverLink item={wl} basePath="wanted" currency={props.currency} />}
            </For>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
