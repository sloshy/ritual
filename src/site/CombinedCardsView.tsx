import type { Component, JSX } from 'solid-js'
import { createSignal, createMemo, For, Show } from 'solid-js'
import { CardItem } from './CardItem'
import type { PriceCurrency } from '../price-currency'
import { formatPrice, formatPriceOrNA } from '../price-currency'
import {
  type GroupBy,
  type CardGroup,
  groupAndSortCards,
  groupTotalPrice,
  CARD_SIZE_WIDTHS,
} from './card-sorting'
import { CardModal } from './CardModal'
import { capitalize } from './utils'
import { useTooltip } from './useTooltip'
import { Toolbar } from './Toolbar'
import { CardSection } from './CardSection'
import { useToolbarState } from './useToolbarState'
import { useCardFilters } from './useCardFilters'
import { collectSetCodes, filterCards } from './card-filters'
import { useCombinedSelection, type SelectionListId } from './useCardSelection'
import { SelectionMenu } from './SelectionMenu'
import type { MetaEntry } from './meta-entry'
import type { CombinedCardData } from './combined-list'

type SelectOption = { value: string; label: string }

interface CombinedCardsViewProps {
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
}

/**
 * The shared rendering surface for a flattened, multi-source card list: the
 * toolbar (group/sort/filter), source-aware grouping, multi-select menu, hover
 * tooltip, and card detail modal. Backs both the combined-list view and the
 * Find page's "Search Results" view — callers build {@link CombinedCardData}
 * themselves and hand it in, along with the title and header.
 */
export const CombinedCardsView: Component<CombinedCardsViewProps> = (props) => {
  const {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortBy,
    setSortBy,
    reverse,
    setReverse,
    reverseGroups,
    setReverseGroups,
    priceGroupStrategy,
    setPriceGroupStrategy,
  } = useToolbarState<GroupBy>({ groupBy: 'source', sortBy: 'name' })
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
  const groupByOptions = createMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'source', label: 'Source List' }]
    if (sectionOrder().length >= 2) opts.push({ value: 'section', label: 'Section' })
    opts.push(
      { value: 'type', label: 'Type' },
      { value: 'cmc', label: 'Mana Value' },
      { value: 'color-identity', label: 'Color Identity' },
      { value: 'price', label: 'Price' },
    )
    if (!hasCollections()) opts.push({ value: 'printing', label: 'Printing' })
    opts.push({ value: 'none', label: 'None' })
    return opts
  })

  const selection = useCombinedSelection(() => props.selectionLists)

  const setCodeOptions = createMemo(() => collectSetCodes(props.cards))

  const cardGroups = createMemo((): CardGroup<CombinedCardData>[] => {
    const working = filterCards(props.cards, cardFilters.filters)
    return groupAndSortCards(
      working,
      groupBy(),
      sortBy(),
      reverse(),
      sectionOrder(),
      priceGroupStrategy(),
      props.currency,
      reverseGroups(),
    )
  })

  const totalPrice = createMemo(() => groupTotalPrice(props.cards))
  const cardCount = createMemo(() => props.cards.reduce((sum, c) => sum + c.quantity, 0))

  const modalMeta = createMemo((): MetaEntry[] | undefined => {
    const t = modalTile()
    if (!t) return undefined
    const tile = t.selectedTile
    const parts: MetaEntry[] = [
      { label: 'price', value: formatPriceOrNA(t.price, props.currency) },
      { label: 'list', value: t.sourceName },
    ]
    if (t.hasPrinting && tile.set) {
      parts.push({ label: 'set', value: `${tile.set.toUpperCase()}:${tile.collectorNumber}` })
    }
    if (tile.finish) parts.push({ label: 'finish', value: capitalize(tile.finish) })
    if (tile.condition) parts.push({ label: 'condition', value: tile.condition })
    if (t.card) parts.push({ label: 'rarity', value: capitalize(t.card.rarity) })
    return parts
  })

  const renderTile = (c: CombinedCardData) => (
    <CardItem
      name={c.name}
      quantity={c.quantity}
      card={c.card}
      symbolMap={props.symbolMap}
      viewMode={viewMode()}
      hideCount={c.quantity <= 1}
      useScryfallImgUrls={props.useScryfallImgUrls}
      onCardClick={() => setModalTile(c)}
      onTooltipEnter={(src, sideways) => setTooltip({ src, sideways })}
      onTooltipLeave={() => setTooltip(null)}
      collectionFinish={c.selectedTile.finish}
      collectionCondition={c.selectedTile.condition}
      collectionSetCN={
        c.hasPrinting && c.selectedTile.set
          ? `${c.selectedTile.set.toUpperCase()}:${c.selectedTile.collectorNumber}`
          : undefined
      }
      collectionPrice={c.price}
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
            {cardCount()} cards · Total: {formatPrice(totalPrice(), props.currency)}
          </p>
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
        sortBy={sortBy()}
        sortByOptions={[
          { value: 'name', label: 'Name' },
          { value: 'cmc', label: 'Mana Value' },
          { value: 'price', label: 'Price' },
          { value: 'color-identity', label: 'Color Identity' },
          { value: 'set-code', label: 'Set Code' },
          { value: 'edhrec', label: 'EDHRec Rank' },
          { value: 'file-order', label: 'List Order' },
        ]}
        onSortByChange={setSortBy}
        priceGroupStrategy={priceGroupStrategy()}
        onPriceGroupStrategyChange={setPriceGroupStrategy}
        reverse={reverse()}
        onReverseChange={() => setReverse((prev) => !prev)}
        reverseGroups={reverseGroups()}
        onReverseGroupsChange={() => setReverseGroups((prev) => !prev)}
        filters={cardFilters}
        symbolMap={props.symbolMap}
        setCodeOptions={setCodeOptions()}
        selectionMenu={
          <SelectionMenu
            selection={selection}
            currency={props.currency}
            enableTrade={props.enableTrade}
            useScryfallImgUrls={props.useScryfallImgUrls}
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
        <div class="combined-empty">{props.emptyMessage ?? 'No cards to show.'}</div>
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
