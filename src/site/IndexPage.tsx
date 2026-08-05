import type { Component, JSX } from 'solid-js'
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
import { CARD_LABEL_DISPLAY_NAMES } from '../card-labels'
import { withLabelsParam } from './list-view-url'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
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
  /** Render the "view all" control; false when there are no lists to combine. */
  show: boolean
  /**
   * The header's "view all" control: a plain link, or a menu of destinations.
   * Read exactly once — each read of the prop getter mounts a fresh instance,
   * so rendering it in two places would give each its own open/closed state.
   */
  control: JSX.Element
}

const SectionHeader: Component<SectionHeaderProps> = (props) => (
  <div class="section-header">
    <h1 class="section-title">{props.title}</h1>
    <Show when={props.show}>{props.control}</Show>
  </div>
)

interface ViewAllLinkProps {
  type: ListType
  label: string
}

const ViewAllLink: Component<ViewAllLinkProps> = (props) => (
  <a href={combinedAllHref(props.type)} class="btn btn-secondary">
    {props.label}
  </a>
)

/**
 * A legal labels query for a menu entry. `keep` and `none` are exclusive
 * selections (see `toggleLabelFilterOption`), so spelling the combinations out
 * keeps an illegal entry a compile error rather than a link that quietly
 * applies no filter at all.
 */
type LabelQuery =
  | readonly []
  | readonly ['keep']
  | readonly ['none']
  | readonly ('sale' | 'trade')[]

/** One destination in the collections "View all..." menu. */
interface CollectionView {
  label: string
  query: LabelQuery
}

const COLLECTION_VIEWS = [
  { label: 'View all collections', query: [] },
  { label: `View all ${CARD_LABEL_DISPLAY_NAMES.sale.toLowerCase()}`, query: ['sale'] },
  { label: `View all ${CARD_LABEL_DISPLAY_NAMES.trade.toLowerCase()}`, query: ['trade'] },
  { label: 'View all for sale or trade', query: ['sale', 'trade'] },
  { label: `View all ${CARD_LABEL_DISPLAY_NAMES.keep.toLowerCase()}`, query: ['keep'] },
] as const satisfies readonly CollectionView[]

/**
 * The collections index "View all..." dropdown, consolidating the unfiltered
 * all-collections view with the label-filtered ones. Each filtered item opens
 * the combined all-collections view with the labels filter pre-set via the
 * shared hash-query params (`useListViewUrlSync` applies them on load, and the
 * combined view's own `all=collection` key survives — `writeListViewParams`
 * preserves foreign params).
 */
const CollectionViewAllMenu: Component = () => {
  const toggle = useAnchoredToggle()
  return (
    <div class="view-all-menu">
      <button
        type="button"
        ref={toggle.setButtonRef}
        class="btn btn-secondary"
        aria-haspopup="true"
        aria-expanded={toggle.open()}
        onClick={toggle.toggleOpen}
      >
        View all...
        <span aria-hidden="true">{toggle.open() ? ' ▴' : ' ▾'}</span>
      </button>
      <AdaptiveMenu
        toggle={toggle}
        width={230}
        panelClass="selection-menu-panel"
        title="View collections"
        role="menu"
        aria-label="View collections"
      >
        <For each={COLLECTION_VIEWS}>
          {(view) => (
            <a
              role="menuitem"
              class="selection-menu-item"
              href={withLabelsParam(combinedAllHref('collection'), view.query)}
              onClick={() => toggle.close()}
            >
              {view.label}
            </a>
          )}
        </For>
      </AdaptiveMenu>
    </div>
  )
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
              show={props.decks.length > 0}
              control={<ViewAllLink type="deck" label="View all decks" />}
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
            show={props.collections.length > 0}
            control={<CollectionViewAllMenu />}
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
            show={props.wantedLists.length > 0}
            control={<ViewAllLink type="wanted" label="View all wanted lists" />}
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
