import type { Component, JSX } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import type { PriceCurrency } from '../pricing/price-currency'
import { cardPriceText, cardPricelessReason } from '../list-view/priceless'
import {
  type GroupBy,
  type SortBy,
  type CardGroup,
  type SelectOption,
  groupAndSortCards,
  groupTotalPrice,
  sortByOptions,
  CARD_SIZE_WIDTHS,
  sortByValuesFor,
} from '../list-view/card-sorting'
import { CardModal } from '../list-view/CardModal'
import { ListPageStats, PageCountAndTotal, SellModeNotice } from './PageStats'
import { createSellSummary, useSellMode, type QuoteSource } from './useSellMode'
import { sellableFromCardData } from './sell-value'
import type { SellModeProps } from '../list-view/sell-mode'
import { finishName, rarityName } from '../list-view/printing-display'
import { TooltipOverlay } from '../ui/TooltipOverlay'
import { useTooltip } from '../ui/useTooltip'
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
import {
  useCombinedSelection,
  type SelectionListId,
  type SelectionSourceKind,
} from '../list-view/useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import { addSelectedCardToTrade, canAddSelectedCardToTrade } from './useSelectionTrade'
import type { MetaEntry } from '../list-view/meta-entry'
import type { CombinedCardData, NamedListRef } from '../list-view/combined-list'
import { useShareFilterContext } from './list-shares'
import { combinedGroupByOptions, type GroupByOption } from './list-page-options'
import {
  CARD_LABEL_SELECTIONS,
  cardLabelName,
  labelFiltersFor,
  type CardLabelSelection,
} from '../card/card-labels'
import { useT } from '../ui/i18n'

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

/**
 * The label chips a combined view offers — and the `labels=` values a shared
 * URL may name here: the union of what its lists' kinds accept (collections
 * take the whole vocabulary, decks `proxy` alone, wanted lists nothing), plus
 * the "unlabeled" chip, in canonical order. Empty when no selected list can
 * carry a label at all, which is what hides the row.
 *
 * Derived per kind from {@link labelFiltersFor} — the same derivation the
 * single-list pages use — and from the list *kinds* rather than the loaded
 * cards, since it must answer before any detail has arrived.
 */
export function combinedLabelFilters(
  kinds: readonly SelectionSourceKind[],
): readonly CardLabelSelection[] {
  const available = new Set<CardLabelSelection>()
  for (const kind of kinds) for (const value of labelFiltersFor(kind)) available.add(value)
  if (available.size === 0) return []
  return CARD_LABEL_SELECTIONS.filter((value) => available.has(value))
}

interface CombinedCardsViewProps extends SellModeProps {
  /** The already-built combined cards to display (flattened across source lists). */
  cards: CombinedCardData[]
  /** Merged mana-symbol lookup for the displayed cards. */
  symbolMap: Record<string, string>
  /** The source lists the cards belong to, scoping the multi-select menu. */
  selectionLists: SelectionListId[]
  currency: PriceCurrency
  useScryfallImgUrls: boolean
  /** Offer "Add to Trade" on each tile and in the multi-select menu (public site only). */
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
  /**
   * Every list, for the share filters. The view's own member lists stay
   * offered — a card trivially "shares" with its own source list.
   */
  shareLists?: readonly NamedListRef[]
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
  const shareContext = useShareFilterContext(cardFilters)
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

  /** The label chips this view offers; empty hides the row entirely. */
  const labelFilters = createMemo(() =>
    combinedLabelFilters(props.selectionLists.map((l) => l.kind)),
  )

  // `sellMode` is a parameter rather than a read of the toolbar signal so the URL
  // sync can ask for the *full* option set (what a shared link may legally name)
  // while the dropdown shows only what is currently offered.
  const groupByOptionsFor = (sellMode: boolean): readonly GroupByOption[] =>
    combinedGroupByOptions(sellMode, sectionOrder().length >= 2, hasCollections())
  // A plain accessor, not a memo: `createMemo` evaluates eagerly, and `sell` is
  // declared below. Rebuilding a small array on read costs nothing.
  const groupByOptions = (): SelectOption[] =>
    groupByOptionsFor(sell.active()).map((o) => ({ value: o.value, label: t(o.label) }))
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
    // Decks count too — they carry the `proxy` label — and a chip no selected
    // kind offers is dropped from the incoming param rather than hiding
    // everything behind a filter this row cannot show.
    availableLabels: labelFilters(),
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
    filterCards(props.cards, cardFilters.filters, shareContext()),
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
      { label: 'price', value: cardPriceText(t, card, card.price, props.currency) },
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

  /**
   * Per-tile "Add to Trade" — one copy, off the tile's own selection payload, so
   * the keep-guard and the name-only printing prompt behave exactly as they do
   * from the multi-select menu. Independent of the current selection: clicking
   * "+" on a tile neither requires nor disturbs one.
   */
  const addTileToTrade = (c: CombinedCardData): Promise<number> =>
    addSelectedCardToTrade(c.selectedTile, {
      currency: props.currency,
      useScryfallImgUrls: props.useScryfallImgUrls,
    })

  /** The modal's "Add to Trade" action, or undefined where the modal offers none. */
  type ModalTradeAction = { add: () => void; disabled: boolean }

  // One memo rather than a pair: the handler and its disabled flag answer the
  // same question about the same card, and split memos could disagree.
  const modalTrade = createMemo((): ModalTradeAction | undefined => {
    const card = modalTile()
    if (!card || !props.enableTrade) return undefined
    return {
      add: () => void addTileToTrade(card),
      disabled: !canAddSelectedCardToTrade(card.selectedTile),
    }
  })

  const renderTile = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      customArt={c.customArt}
      priceless={cardPricelessReason(c)}
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
      onAddToTrade={props.enableTrade ? () => void addTileToTrade(c) : undefined}
      // Unconditional: CardItem reads this only inside the `onAddToTrade`
      // guard, so it is never evaluated while the button is hidden.
      addToTradeDisabled={!canAddSelectedCardToTrade(c.selectedTile)}
    />
  )

  return (
    <div class="page-container">
      {/* Header */}
      <div class="page-header">
        <div>
          <h1 class="page-title">{props.title}</h1>
          <p class="page-stats">
            <PageCountAndTotal count={cardCount()} total={totalPrice()} currency={props.currency} />
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
        showLabelsFilter={labelFilters().length > 0}
        availableLabels={labelFilters()}
        shareLists={props.shareLists}
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
              renderCard={renderTile}
            />
          )}
        </For>
      </div>

      {/* List-view hover tooltip */}
      <TooltipOverlay tooltip={tooltip()} pos={tooltipPos()} tooltipRef={tooltipRef} />

      {/* Card detail modal */}
      <CardModal
        open={Boolean(modalTile())}
        card={modalTile()?.card ?? null}
        customArt={modalTile()?.customArt}
        hasCustomArt={modalTile()?.hasCustomArt}
        cardName={modalTile()?.name ?? null}
        symbolMap={props.symbolMap}
        useScryfallImgUrls={props.useScryfallImgUrls}
        currency={props.currency}
        printings={modalTile()?.printings ?? []}
        onClose={() => setModalTile(null)}
        meta={modalMeta()}
        onAddToTrade={modalTrade()?.add}
        addToTradeDisabled={modalTrade()?.disabled}
        note={modalTile()?.selectedTile.note}
      />
    </div>
  )
}
