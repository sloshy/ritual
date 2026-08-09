import type { Component, JSX } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import type { PriceCurrency } from '../price-currency'
import { formatPrice, formatPriceOrNA } from '../price-currency'
import {
  type GroupBy,
  type SortBy,
  type CardGroup,
  type SelectOption,
  groupAndSortCards,
  groupTotalPrice,
  sortByOptions,
  CARD_SIZE_WIDTHS,
  SELL_GROUP_BY_OPTIONS,
  sortByValuesFor,
} from './card-sorting'
import { CardModal } from './CardModal'
import { ListPageStats, SellModeNotice } from './PageStats'
import { createSellSummary, useSellMode, type QuoteSource } from './useSellMode'
import { sellableFromCardData } from './sell-value'
import type { SellModeProps } from './sell-mode'
import { finishName, rarityName } from './printing-display'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'
import { useListViewUrlSync } from './useListViewUrlSync'
import { useCardFilters } from './useCardFilters'
import {
  collectArtTags,
  collectCardTypes,
  collectOracleTags,
  collectSetCodes,
  filterCards,
} from './card-filters'
import { useCombinedSelection, type SelectionListId } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import type { MetaEntry } from './meta-entry'
import type { CombinedCardData } from './combined-list'
import { cardLabelName } from '../card-labels'
import { useT } from '../ui/i18n'
import type { MessageKey } from '../i18n/messages/en'

/**
 * Every key a group-by dropdown label may name. Narrower than `MessageKey` so
 * `t()` can render one without params, and `Extract` turns a key that no longer
 * exists in the catalog into `never` — a compile error at the table below.
 */
type GroupByMessageKey = Extract<MessageKey, `site.groupBy.${string}` | `domain.groupBy.${string}`>

/**
 * A group-by choice before its label is rendered. The `value` half is a
 * persisted URL token and stays locale-independent.
 */
type CombinedGroupByOption = { value: GroupBy; label: GroupByMessageKey }

// The sort fields the combined view offers, in order — shared by the toolbar's
// dropdown options and the URL sync's validation of incoming sort layers.
const COMBINED_SORT_BYS: readonly SortBy[] = [
  'name',
  'cmc',
  'price',
  'color-identity',
  'set-code',
  'edhrec',
  'file-order',
]

interface CombinedCardsViewProps extends SellModeProps {
  /** The already-built combined cards to display (flattened across source lists). */
  cards: CombinedCardData[]
  /** Merged mana-symbol lookup for the displayed cards. */
  symbolMap: Record<string, string>
  /** The source lists the cards belong to, scoping the multi-select menu. */
  selectionLists: SelectionListId[]
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Offer "Add to Trade" in the multi-select menu (public site only). */
  enableTrade?: boolean
  /** Page heading. */
  title: string
  /** Optional content rendered under the stats line (e.g. the source-list list). */
  header?: JSX.Element
  /** While true, a spinner replaces the (empty) card grid. */
  loading?: boolean
  /** When set, an error banner replaces the card grid. */
  error?: JSX.Element | string
  /** Message shown when there are no cards and we are neither loading nor errored. */
  emptyMessage?: string
  /** Mirror the toolbar/filter state into the URL query so the view is shareable (combined-list view only). */
  enableUrlState?: boolean
}

/**
 * The shared rendering surface for a flattened, multi-source card list: the
 * toolbar (group/sort/filter), source-aware grouping, multi-select menu, hover
 * tooltip, and card detail modal. Backs both the combined-list view and the
 * Find page's "Search Results" view — callers build {@link CombinedCardData}
 * themselves and hand it in, along with the title and header.
 */
export const CombinedCardsView: Component<CombinedCardsViewProps> = (props) => {
  const t = useT()
  const toolbar = useToolbarState<GroupBy>({ groupBy: 'source', sortBy: 'name' })
  const {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortLayers,
    setSortLayers,
    reverseGroups,
    setReverseGroups,
    priceGroupStrategy,
    setPriceGroupStrategy,
  } = toolbar
  const cardFilters = useCardFilters()
  const { tooltip, tooltipPos, tooltipRef, setTooltip } = useTooltip()
  const [modalTile, setModalTile] = createSignal<CombinedCardData | null>(null)

  const sectionOrder = createMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const c of props.cards) {
      if (!seen.has(c.section)) {
        seen.add(c.section)
        order.push(c.section)
      }
    }
    return order
  })

  const hasCollections = createMemo(() => props.cards.some((c) => c.sourceKind === 'collection'))

  // Group-by options are the lowest common denominator of the combined list types,
  // plus "Source List". "Printing" only applies when no collection is present (every
  // collection card is pinned, so the distinction is meaningless once one is mixed in).
  // `sellMode` is a parameter rather than a read of the toolbar signal so the URL
  // sync can ask for the *full* option set (what a shared link may legally name)
  // while the dropdown shows only what is currently offered.
  const groupByOptionsFor = (sellMode: boolean): CombinedGroupByOption[] => {
    const opts: CombinedGroupByOption[] = [{ value: 'source', label: 'site.groupBy.source' }]
    if (sectionOrder().length >= 2) opts.push({ value: 'section', label: 'site.groupBy.section' })
    opts.push(
      { value: 'type', label: 'site.groupBy.type' },
      { value: 'cmc', label: 'site.groupBy.cmc' },
      { value: 'color-identity', label: 'site.groupBy.colorIdentity' },
      { value: 'price', label: 'site.groupBy.price' },
    )
    if (!hasCollections()) opts.push({ value: 'printing', label: 'site.groupBy.printing' })
    if (sellMode) opts.push(...SELL_GROUP_BY_OPTIONS)
    opts.push({ value: 'none', label: 'site.groupBy.none' })
    return opts
  }
  // A plain accessor, not a memo: `createMemo` evaluates eagerly, and `sell` is
  // declared below. Rebuilding a small array on read costs nothing.
  const groupByOptions = (): SelectOption[] =>
    groupByOptionsFor(sell.active()).map((option) => ({
      value: option.value,
      label: t(option.label),
    }))
  // A parameter, not a read of the live mode, for the same reason as the
  // group-by options: the URL sync validates against the full set a shared
  // link may name, while the dropdown offers only what is currently on.
  const sortValuesFor = (sellMode: boolean): readonly SortBy[] =>
    sortByValuesFor(COMBINED_SORT_BYS, sellMode)

  useListViewUrlSync({
    toolbar,
    filters: cardFilters,
    defaults: { groupBy: 'source', sortBy: 'name' },
    groupByValues: groupByOptionsFor(Boolean(props.enableSellMode)).map((o) => o.value),
    sortByValues: sortValuesFor(Boolean(props.enableSellMode)),
    enabled: props.enableUrlState,
    // From the selection's list *kinds*, not the loaded cards: the URL params
    // are applied once at construction, before any card data has arrived.
    supportsLabels: props.selectionLists.some((l) => l.kind === 'collection'),
    supportsSellMode: Boolean(props.enableSellMode),
  })

  const selection = useCombinedSelection(() => props.selectionLists)

  // Declared once, at setup: a page handed a baked payload never calls the quote
  // API (the public site and the public editor), and one without it quotes live
  // against a credentialed API (the admin editors). Making the choice explicit
  // keeps a call site from silently landing on the path it did not mean.
  const quoteSource: QuoteSource = props.bakedBuylist
    ? { kind: 'baked', quotes: props.bakedBuylist }
    : { kind: 'live' }
  const sell = useSellMode({
    toolbar,
    supported: () => Boolean(props.enableSellMode),
    quotes: quoteSource,
    cards: () => props.cards,
    selected: selection.selected,
    filters: cardFilters,
    defaults: { groupBy: 'source', sortBy: 'name' },
  })

  const setCodeOptions = createMemo(() => collectSetCodes(props.cards))
  const cardTypeOptions = createMemo(() => collectCardTypes(props.cards))
  const oracleTagOptions = createMemo(() => collectOracleTags(props.cards))
  const artTagOptions = createMemo(() => collectArtTags(props.cards))

  const filteredCards = createMemo((): CombinedCardData[] =>
    filterCards(props.cards, cardFilters.filters),
  )

  const cardGroups = createMemo((): CardGroup<CombinedCardData>[] => {
    return groupAndSortCards(
      filteredCards(),
      groupBy(),
      sortLayers(),
      sectionOrder(),
      priceGroupStrategy(),
      props.currency,
      reverseGroups(),
    )
  })

  const totalPrice = createMemo(() => groupTotalPrice(props.cards))
  const filteredTotalPrice = createMemo(() => groupTotalPrice(filteredCards()))
  const filteredSellSummary = createSellSummary(sell.active, () =>
    filteredCards().map(sellableFromCardData),
  )
  const cardCount = createMemo(() => props.cards.reduce((sum, c) => sum + c.quantity, 0))

  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const card = modalTile()
    if (!card) return undefined
    const tile = card.selectedTile
    const parts: MetaEntry[] = [
      { label: 'price', value: formatPriceOrNA(card.price, props.currency) },
      { label: 'list', value: card.sourceName },
    ]
    if (card.hasPrinting && tile.set) {
      parts.push({ label: 'set', value: `${tile.set.toUpperCase()}:${tile.collectorNumber}` })
    }
    if (tile.finish) parts.push({ label: 'finish', value: finishName(t, tile.finish) })
    if (tile.condition) parts.push({ label: 'condition', value: tile.condition })
    if (card.labels.length > 0) {
      parts.push({
        label: 'labels',
        value: card.labels.map(cardLabelName).join(' · '),
      })
    }
    if (card.card) parts.push({ label: 'rarity', value: rarityName(t, card.card.rarity) })
    return parts
  })

  const renderTile = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      symbolMap={props.symbolMap}
      buylistPrice={c.buylistPrice}
      viewMode={viewMode()}
      hideCount={c.quantity <= 1}
      useScryfallImgUrls={props.useScryfallImgUrls}
      onCardClick={() => setModalTile(c)}
      onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
      onTooltipLeave={() => setTooltip(null)}
      collectionFinish={c.selectedTile.finish}
      collectionCondition={c.selectedTile.condition}
      collectionLanguage={c.selectedTile.language}
      collectionSetCN={
        c.hasPrinting && c.selectedTile.set
          ? `${c.selectedTile.set.toUpperCase()}:${c.selectedTile.collectorNumber}`
          : undefined
      }
      collectionPrice={c.price}
      labelBadges={c.labels.length > 0 ? c.labels : undefined}
      currency={props.currency}
      selectable
      selectState={selection.state(c.selectKey)}
      onToggleSelect={() => selection.toggle(c.selectedTile)}
    />
  )

  return (
    <div class="page-container">
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">{props.title}</h1>
          <p class="page-stats">
            {t('site.stats.cardsAndTotal', {
              count: cardCount(),
              amount: formatPrice(totalPrice(), props.currency),
            })}
            <ListPageStats
              filters={cardFilters}
              currency={props.currency}
              filteredAmount={filteredTotalPrice()}
              selectedCount={selection.count()}
              selectedAmount={selection.value(props.currency)}
              sellMode={sell.active()}
              buylistSummary={filteredSellSummary()}
              selectionSummary={sell.summary()}
            />
          </p>
          <SellModeNotice sellMode={sell.active()} />
          {props.header}
        </div>
      </div>

      <Toolbar
        viewMode={viewMode()}
        onViewModeChange={setViewMode}
        cardSize={cardSize()}
        onCardSizeChange={setCardSize}
        groupBy={groupBy()}
        groupByOptions={groupByOptions()}
        onGroupByChange={(v) => setGroupBy(v as GroupBy)}
        sortLayers={sortLayers()}
        sortByOptions={sortByOptions(sortValuesFor(sell.active()), {
          'file-order': 'domain.sortBy.listOrder',
        })}
        onSortLayersChange={setSortLayers}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        sell={sell.control()}
        filters={cardFilters}
        symbolMap={props.symbolMap}
        currency={props.currency}
        setCodeOptions={setCodeOptions()}
        cardTypeOptions={cardTypeOptions()}
        oracleTagOptions={oracleTagOptions()}
        artTagOptions={artTagOptions()}
        showLabelsFilter={hasCollections()}
        selectionMenu={
          <SelectionMenu
            selection={selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
            dockOnTouch
          />
        }
      />

      <Show when={props.error}>
        <div class="error-container">{props.error}</div>
      </Show>

      <Show when={props.loading}>
        <div class="loading-container">
          <div class="loading-spinner" />
        </div>
      </Show>

      <Show when={!props.loading && props.cards.length === 0 && !props.error}>
        <div class="combined-empty">{props.emptyMessage ?? t('site.combined.empty')}</div>
      </Show>

      {/* Card sections */}
      <div
        class={`card-sections view-${viewMode()}`}
        style={`--card-width:${CARD_SIZE_WIDTHS[cardSize()]}px`}
      >
        <For each={cardGroups()}>
          {(group) => (
            <CardSection
              label={group.key}
              cards={group.cards}
              currency={props.currency}
              renderCard={(c) => renderTile(c)}
            />
          )}
        </For>
      </div>

      {/* List-view hover tooltip */}
      <div
        ref={tooltipRef}
        class={`list-tooltip ${tooltip() ? 'visible' : ''} ${tooltip()?.sideways ? 'list-tooltip-sideways' : ''}`}
        style={`left:${tooltipPos().left}px;top:${tooltipPos().top}px;`}
      >
        <Show when={tooltip()}>
          <img src={tooltip()!.src} alt="" class={tooltip()!.sideways ? 'tooltip-rotated' : ''} />
        </Show>
      </div>

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalTile())}
        card={modalTile()?.card ?? null}
        cardName={modalTile()?.name ?? null}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalTile()?.printings ?? []}
        onClose={() => setModalTile(null)}
        meta={modalMeta()}
        note={modalTile()?.selectedTile.note}
      />
    </div>
  )
}
